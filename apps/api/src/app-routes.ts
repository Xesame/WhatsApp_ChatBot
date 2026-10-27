import { audit, usdToEgpRate } from '@reb/admin';
import type { Auth } from '@reb/auth';
import { cities, developers, firms, projects, type Database } from '@reb/db';
import {
  addNote,
  createSavedSearch,
  deleteNote,
  deleteSavedSearch,
  firmOf,
  inviteUser,
  listNotes,
  listSavedSearches,
  listTeam,
  newAccessLink,
  noteSchema,
  recordUsage,
  savedSearchSchema,
  setLocale,
  setRemoved,
  updateSavedSearch,
  usageByDay,
} from '@reb/firms';
import { exportUnits } from '@reb/pipeline';
import {
  filtersFromQuery,
  isEmptySearch,
  listingDetail,
  matchingIds,
  searchListings,
  visibleMedia,
} from '@reb/search';
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  fromOtherSite,
  passwordLink,
  sendError,
  sendMediaFile,
  sessionUser,
  type SignedInUser,
} from './http.ts';

export interface AppRoutesOptions {
  auth: Auth;
  database: Database;
  mediaDir: string;
  publicUrl: string;
  usdEgpRateFallback: number | undefined;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SignedInUser | null;
  }
}

/** Exports stop at this many listings. */
const EXPORT_LIMIT = 5000;
const id = z.coerce.number().int().positive();
const filtersQuery = z.record(z.string(), z.string());

/**
 * The firm dashboard API, under /api/app. Any signed-in user may search
 * listings (the owner too); notes, saved searches, the team and usage belong
 * to the caller's firm and every query is limited to it (build plan, rule 5).
 * Firm-scoping itself lives in @reb/firms, which takes the signed-in person
 * on every call.
 */
export const appRoutes: FastifyPluginCallback<AppRoutesOptions> = (parent, options, done) => {
  const { db } = options.database;
  const publicOrigin = new URL(options.publicUrl).origin;
  const api = parent.withTypeProvider<ZodTypeProvider>();
  api.decorateRequest('user', null);

  api.addHook('onRequest', async (request, reply) => {
    if (fromOtherSite(request, publicOrigin)) {
      return reply.code(403).send({ error: 'Request from another site refused' });
    }
    const result = await sessionUser(options.auth, db, request);
    if ('status' in result) return reply.code(result.status).send({ error: result.error });
    request.user = result.user;
  });
  api.setErrorHandler(sendError);

  const me = (request: FastifyRequest): SignedInUser => {
    if (!request.user) throw new Error('onRequest guard did not run');
    return request.user;
  };
  const log = (
    request: FastifyRequest,
    action: string,
    target: string | null,
    details?: Record<string, unknown>,
  ) => audit(db, { userId: me(request).userId, action, target, details, ipAddress: request.ip });
  const rate = () => usdToEgpRate(db, options.usdEgpRateFallback);
  const requireAdmin = (request: FastifyRequest) => {
    const user = me(request);
    if (user.role !== 'firm_admin')
      throw Object.assign(new Error('Firm admins only'), { name: 'ForbiddenError' });
    return firmOf(user);
  };

  // Account

  api.get(
    '/me',
    { schema: { tags: ['Dashboard'], summary: 'The signed-in person and their firm' } },
    async (request) => {
      const user = me(request);
      const [firm] = user.firmId
        ? await db
            .select({ id: firms.id, name: firms.name })
            .from(firms)
            .where(eq(firms.id, user.firmId))
        : [];
      return {
        id: user.userId,
        name: user.name,
        email: user.email,
        role: user.role,
        locale: user.locale,
        firm: firm ?? null,
      };
    },
  );

  api.put(
    '/me/locale',
    {
      schema: {
        tags: ['Dashboard'],
        summary: 'Dashboard language: en or ar',
        body: z.object({ locale: z.enum(['en', 'ar']) }),
      },
    },
    async (request) => {
      await setLocale(db, me(request), request.body.locale);
      return { locale: request.body.locale };
    },
  );

  // Listings

  api.get(
    '/options',
    {
      schema: {
        tags: ['Dashboard'],
        summary: 'Cities, developers and projects for the filters, in both languages',
      },
    },
    async () => {
      const [c, d, p] = await Promise.all([
        db
          .select({ id: cities.id, en: cities.nameEn, ar: cities.nameAr })
          .from(cities)
          .orderBy(asc(cities.nameEn)),
        db
          .select({ id: developers.id, en: developers.nameEn, ar: developers.nameAr })
          .from(developers)
          .orderBy(asc(developers.nameEn)),
        db
          .select({
            id: projects.id,
            en: projects.nameEn,
            ar: projects.nameAr,
            developerId: projects.developerId,
            cityId: projects.cityId,
          })
          .from(projects)
          .orderBy(asc(projects.nameEn)),
      ]);
      return { cities: c, developers: d, projects: p };
    },
  );

  api.get(
    '/listings',
    {
      schema: {
        tags: ['Dashboard'],
        summary:
          'Search listings. Filters as query parameters (lists comma-separated): q, cityIds, developerIds, projectIds, unitTypes, categories, finishing, bedroomsMin/Max, areaMin/Max (m²), priceMin/Max (EGP), deliveryYearMax, readyToMove, downPaymentMax, installmentYearsMin, priceDropped, statuses, sort; plus page and pageSize',
        querystring: filtersQuery,
      },
    },
    async (request) => {
      const filters = filtersFromQuery(request.query);
      const result = await searchListings(db, filters, {
        usdEgpRate: await rate(),
        page: Number(request.query.page ?? 1),
        pageSize: Number(request.query.pageSize ?? 25),
      });
      if (result.page === 1 && !isEmptySearch(filters)) {
        await recordUsage(db, me(request), 'search', { filters, total: result.total });
      }
      return result;
    },
  );

  api.get(
    '/listings/:id',
    {
      schema: {
        tags: ['Dashboard'],
        summary:
          'One listing: every field, price history, source messages (no sender or group), and your firm’s notes',
        params: z.object({ id }),
      },
    },
    async (request, reply) => {
      const detail = await listingDetail(db, request.params.id);
      if (!detail) return reply.code(404).send({ error: 'Listing not found' });
      const user = me(request);
      await recordUsage(db, user, 'listing_view', { unitId: request.params.id });
      return {
        ...detail,
        notes: user.firmId ? await listNotes(db, user, request.params.id) : [],
        usdEgpRate: (await rate()) ?? null,
      };
    },
  );

  api.get(
    '/media/:id',
    {
      schema: {
        tags: ['Dashboard'],
        summary: 'A flyer or document behind a listing',
        params: z.object({ id }),
      },
    },
    async (request, reply) =>
      sendMediaFile(reply, options.mediaDir, await visibleMedia(db, request.params.id)),
  );

  api.get(
    '/export',
    {
      schema: {
        tags: ['Dashboard'],
        summary: `Download the current search (same filters as /listings, up to ${EXPORT_LIMIT} listings) in the Primary Units template, as xlsx or csv`,
        querystring: filtersQuery,
      },
    },
    async (request, reply) => {
      const format = request.query.format === 'csv' ? 'csv' : 'xlsx';
      const filters = filtersFromQuery({ ...request.query, format: undefined });
      const usdToEgp = await rate();
      const unitIds = await matchingIds(db, filters, { usdEgpRate: usdToEgp, limit: EXPORT_LIMIT });
      let file: Buffer;
      try {
        file = (await exportUnits(options.database, { usdToEgp, unitIds, format })).file;
      } catch (error) {
        return reply
          .code(400)
          .send({ error: error instanceof Error ? error.message : String(error) });
      }
      await recordUsage(db, me(request), 'export', { filters, count: unitIds.length, format });
      await log(request, 'units.export', null, { count: unitIds.length, format });
      const day = new Date().toISOString().slice(0, 10);
      return reply
        .type(
          format === 'csv'
            ? 'text/csv; charset=utf-8'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        .header('content-disposition', `attachment; filename="listings-${day}.${format}"`)
        .send(file);
    },
  );

  // Notes (private to the firm)

  api.post(
    '/listings/:id/notes',
    {
      schema: {
        tags: ['Dashboard'],
        summary: 'Add a private note to a listing; only your firm sees it',
        params: z.object({ id }),
        body: noteSchema,
      },
    },
    async (request, reply) =>
      reply.code(201).send({ id: await addNote(db, me(request), request.params.id, request.body) }),
  );

  api.delete(
    '/notes/:id',
    {
      schema: {
        tags: ['Dashboard'],
        summary: 'Delete a note (its author or a firm admin)',
        params: z.object({ id }),
      },
    },
    async (request) => {
      await deleteNote(db, me(request), request.params.id);
      return { ok: true };
    },
  );

  // Saved searches

  api.get(
    '/saved-searches',
    {
      schema: {
        tags: ['Dashboard'],
        summary: 'Your saved searches (a firm admin sees the whole firm’s)',
      },
    },
    (request) => listSavedSearches(db, me(request)),
  );

  api.post(
    '/saved-searches',
    {
      schema: {
        tags: ['Dashboard'],
        summary: 'Save a search; alerts on it arrive with the chat bots (Phase 7)',
        body: savedSearchSchema,
      },
    },
    async (request, reply) =>
      reply.code(201).send({ id: await createSavedSearch(db, me(request), request.body) }),
  );

  api.patch(
    '/saved-searches/:id',
    {
      schema: {
        tags: ['Dashboard'],
        summary: 'Rename, change filters or alert channel, pause',
        params: z.object({ id }),
        body: savedSearchSchema.partial(),
      },
    },
    async (request) => {
      await updateSavedSearch(db, me(request), request.params.id, request.body);
      return { ok: true };
    },
  );

  api.delete(
    '/saved-searches/:id',
    { schema: { tags: ['Dashboard'], summary: 'Delete a saved search', params: z.object({ id }) } },
    async (request) => {
      await deleteSavedSearch(db, me(request), request.params.id);
      return { ok: true };
    },
  );

  // Team (firm admins)

  api.get(
    '/team',
    { schema: { tags: ['Team'], summary: 'Your firm’s users (firm admins)' } },
    (request) => listTeam(db, me(request), requireAdmin(request)),
  );

  api.post(
    '/team',
    {
      schema: {
        tags: ['Team'],
        summary:
          'Add an agent to your firm; returns the invitation link to send them (firm admins)',
        body: z.object({
          name: z.string().trim().min(1).max(120),
          email: z.email().max(200),
          locale: z.enum(['en', 'ar']).default('ar'),
          phone: z.string().trim().max(30).optional(),
        }),
      },
    },
    async (request, reply) => {
      const firmId = requireAdmin(request);
      const invited = await inviteUser(db, me(request), firmId, { ...request.body, role: 'agent' });
      await log(request, 'user.invite', `user:${invited.userId}`, {
        firmId,
        role: 'agent',
        email: request.body.email,
      });
      return reply.code(201).send({
        userId: invited.userId,
        link: passwordLink(options.publicUrl, invited.token),
        expiresAt: invited.expiresAt,
      });
    },
  );

  api.post(
    '/team/:userId/link',
    {
      schema: {
        tags: ['Team'],
        summary: 'A new invitation or password-reset link for a member (firm admins)',
        params: z.object({ userId: z.uuid() }),
      },
    },
    async (request) => {
      requireAdmin(request);
      const created = await newAccessLink(db, me(request), request.params.userId);
      await log(request, `user.link.${created.purpose}`, `user:${request.params.userId}`);
      return {
        purpose: created.purpose,
        link: passwordLink(options.publicUrl, created.token),
        expiresAt: created.expiresAt,
      };
    },
  );

  api.patch(
    '/team/:userId',
    {
      schema: {
        tags: ['Team'],
        summary: 'Remove or restore an agent (firm admins)',
        params: z.object({ userId: z.uuid() }),
        body: z.object({ removed: z.boolean() }),
      },
    },
    async (request) => {
      requireAdmin(request);
      await setRemoved(db, me(request), request.params.userId, request.body.removed);
      await log(
        request,
        request.body.removed ? 'user.remove' : 'user.restore',
        `user:${request.params.userId}`,
      );
      return { ok: true };
    },
  );

  api.get(
    '/usage',
    {
      schema: {
        tags: ['Team'],
        summary: 'Your firm’s searches, exports and listing views per day (firm admins)',
        querystring: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
      },
    },
    (request) => usageByDay(db, requireAdmin(request), request.query.days),
  );

  done();
};
