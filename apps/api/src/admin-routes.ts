import {
  addAlias,
  audit,
  connectionStatus,
  createEntity,
  failedJobs,
  getSetting,
  listEntities,
  mergeEntities,
  removeAlias,
  renameEntity,
  retryJob,
  reviewQueue,
  reviewUnit,
  setSetting,
  stats,
  unitView,
  usdToEgpRate,
} from '@reb/admin';
import type { Auth } from '@reb/auth';
import { mediaFiles, messages, waGroups, GROUP_SOURCE_TYPES, type Database } from '@reb/db';
import { exportUnits } from '@reb/pipeline';
import type { PgBoss } from '@reb/queue';
import { asc, count, eq, sql } from 'drizzle-orm';
import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createFirm,
  firmInputSchema,
  inviteSchema,
  inviteUser,
  listFirms,
  listTeam,
  newAccessLink,
  setRemoved,
  updateFirm,
  usageByDay,
  type Actor,
} from '@reb/firms';
import { fromOtherSite, passwordLink, sendError, sendMediaFile, sessionUser } from './http.ts';

export interface AdminOptions {
  auth: Auth;
  /** Used to retry failed jobs. */
  boss: PgBoss;
  /** Where capture saved media files (MEDIA_DIR). */
  mediaDir: string;
  /** The web app's address; changes are only accepted from pages served there. */
  publicUrl: string;
  /** USD_EGP_RATE, used for exports until the owner sets a rate in Settings. */
  usdEgpRateFallback: number | undefined;
}

export interface Owner {
  id: string;
  name: string;
  email: string;
  role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    owner: Owner | null;
  }
}

const id = z.coerce.number().int().positive();
const kind = z.enum(['city', 'developer', 'project']);
const name = z.string().trim().min(1).max(200);

/**
 * The owner's admin API, under /api/admin. Every route needs a signed-in
 * owner; every change is written to the audit log. The logic lives in
 * @reb/admin; these routes only check input and call it.
 */
export const adminRoutes: FastifyPluginCallback<AdminOptions & { database: Database }> = (
  parent,
  options,
  done,
) => {
  const { database } = options;
  const { db } = database;
  const publicOrigin = new URL(options.publicUrl).origin;
  const api = parent.withTypeProvider<ZodTypeProvider>();
  api.decorateRequest('owner', null);

  api.addHook('onRequest', async (request, reply) => {
    if (fromOtherSite(request, publicOrigin)) {
      return reply.code(403).send({ error: 'Request from another site refused' });
    }
    const result = await sessionUser(options.auth, db, request);
    if ('status' in result) return reply.code(result.status).send({ error: result.error });
    const { user } = result;
    if (user.role !== 'owner') return reply.code(403).send({ error: 'Owner only' });
    request.owner = { id: user.userId, name: user.name, email: user.email, role: user.role };
  });
  const actorOf = (request: FastifyRequest): Actor => ({
    userId: request.owner?.id ?? '',
    role: 'owner',
    firmId: null,
  });

  const log = (
    request: FastifyRequest,
    action: string,
    target: string | null,
    details?: Record<string, unknown>,
  ) =>
    audit(db, {
      userId: request.owner?.id ?? null,
      action,
      target,
      details,
      ipAddress: request.ip,
    });

  api.get(
    '/me',
    { schema: { tags: ['Account'], summary: 'The signed-in owner' } },
    (request) => request.owner,
  );

  // WhatsApp pairing and groups

  api.get(
    '/whatsapp',
    {
      schema: {
        tags: ['WhatsApp'],
        summary:
          'Connection state of each WhatsApp account, with the pairing QR code while waiting',
      },
    },
    () => connectionStatus(db),
  );

  api.get(
    '/groups',
    { schema: { tags: ['WhatsApp'], summary: 'Groups the scraper number is in' } },
    async () => {
      const counts = db
        .select({ groupId: messages.groupId, messages: count().as('messages') })
        .from(messages)
        .groupBy(messages.groupId)
        .as('counts');
      return db
        .select({
          id: waGroups.id,
          name: waGroups.name,
          watched: waGroups.watched,
          sourceType: waGroups.sourceType,
          isMember: waGroups.isMember,
          lastMessageAt: waGroups.lastMessageAt,
          // groups with no messages have no row in `counts`
          messages: sql<number>`coalesce(${counts.messages}, 0)`.mapWith(Number),
        })
        .from(waGroups)
        .leftJoin(counts, eq(counts.groupId, waGroups.id))
        .orderBy(asc(waGroups.name));
    },
  );

  api.patch(
    '/groups/:id',
    {
      schema: {
        tags: ['WhatsApp'],
        summary:
          'Watch or stop watching a group, or set who posts in it (applies within 30 seconds)',
        params: z.object({ id }),
        body: z
          .object({
            watched: z.boolean().optional(),
            sourceType: z.enum(GROUP_SOURCE_TYPES).nullable().optional(),
          })
          .strict(),
      },
    },
    async (request, reply) => {
      const [row] = await db
        .update(waGroups)
        .set(request.body)
        .where(eq(waGroups.id, request.params.id))
        .returning();
      if (!row) return reply.code(404).send({ error: 'Group not found' });
      await log(request, 'group.update', `group:${row.id}`, request.body);
      return row;
    },
  );

  // Review

  api.get(
    '/review',
    {
      schema: {
        tags: ['Review'],
        summary: 'Units flagged for review, oldest first',
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(50).default(20),
          afterId: id.optional(),
        }),
      },
    },
    (request) => reviewQueue(db, request.query),
  );

  api.get(
    '/units/:id',
    {
      schema: {
        tags: ['Review'],
        summary: 'One unit with its source messages, media and price history',
        params: z.object({ id }),
      },
    },
    async (request, reply) =>
      (await unitView(db, request.params.id)) ?? reply.code(404).send({ error: 'Unit not found' }),
  );

  api.post(
    '/units/:id/review',
    {
      schema: {
        tags: ['Review'],
        summary:
          'Correct fields, approve, or reject a unit. Corrections are kept for the accuracy test set.',
        params: z.object({ id }),
        body: z.object({
          action: z.enum(['save', 'approve', 'reject']),
          changes: z.record(z.string(), z.unknown()).optional(),
        }),
      },
    },
    async (request) => {
      const unit = await reviewUnit(
        database,
        request.params.id,
        request.body,
        request.owner?.id ?? null,
      );
      await log(request, `unit.${request.body.action}`, `unit:${unit.id}`, {
        fields: Object.keys(request.body.changes ?? {}),
      });
      return unit;
    },
  );

  api.get(
    '/media/:id',
    {
      schema: {
        tags: ['Review'],
        summary: 'The original image, PDF or sheet a listing came from',
        params: z.object({ id }),
      },
    },
    async (request, reply) => {
      const [file] = await db.select().from(mediaFiles).where(eq(mediaFiles.id, request.params.id));
      return sendMediaFile(reply, options.mediaDir, file);
    },
  );

  // Cities, developers, projects and their spellings

  api.get(
    '/entities/:kind',
    {
      schema: {
        tags: ['Entities'],
        summary: 'Cities, developers or projects with their spellings',
        params: z.object({ kind }),
        querystring: z.object({ search: z.string().max(100).optional() }),
      },
    },
    (request) => listEntities(db, request.params.kind, request.query.search),
  );

  api.post(
    '/entities/:kind',
    {
      schema: {
        tags: ['Entities'],
        summary: 'Add a city, developer or project (a project needs its developer and city)',
        params: z.object({ kind }),
        body: z
          .object({
            nameEn: name,
            nameAr: name,
            developerId: id.optional(),
            cityId: id.optional(),
          })
          .strict(),
      },
    },
    async (request, reply) => {
      const { body, params } = request;
      if (params.kind === 'project' && (!body.developerId || !body.cityId)) {
        return reply.code(400).send({ error: 'A project needs a developer and a city' });
      }
      const created = await createEntity(db, params.kind, body);
      await log(request, `${params.kind}.create`, `${params.kind}:${created}`, body);
      return reply.code(201).send({ id: created });
    },
  );

  api.patch(
    '/entities/:kind/:id',
    {
      schema: {
        tags: ['Entities'],
        summary: 'Rename (the old names stay as spellings)',
        params: z.object({ kind, id }),
        body: z.object({ nameEn: name.optional(), nameAr: name.optional() }).strict(),
      },
    },
    async (request) => {
      const { kind: k, id: entityId } = request.params;
      await renameEntity(db, k, entityId, request.body);
      await log(request, `${k}.rename`, `${k}:${entityId}`, request.body);
      return { ok: true };
    },
  );

  api.post(
    '/entities/:kind/:id/aliases',
    {
      schema: {
        tags: ['Entities'],
        summary: 'Add a spelling that should be recognised as this entity',
        params: z.object({ kind, id }),
        body: z.object({ alias: name }),
      },
    },
    async (request) => {
      const { kind: k, id: entityId } = request.params;
      const added = await addAlias(db, k, entityId, request.body.alias);
      if (added) await log(request, 'alias.add', `${k}:${entityId}`, request.body);
      return { added };
    },
  );

  api.delete(
    '/aliases/:id',
    { schema: { tags: ['Entities'], summary: 'Remove a spelling', params: z.object({ id }) } },
    async (request) => {
      await removeAlias(db, request.params.id);
      await log(request, 'alias.remove', `alias:${request.params.id}`);
      return { ok: true };
    },
  );

  api.post(
    '/entities/:kind/:id/merge',
    {
      schema: {
        tags: ['Entities'],
        summary:
          'Merge this duplicate into another entity: its units, projects and spellings move over, then it is deleted',
        params: z.object({ kind, id }),
        body: z.object({ intoId: id }),
      },
    },
    async (request, reply) => {
      const { kind: k, id: fromId } = request.params;
      if (fromId === request.body.intoId)
        return reply.code(400).send({ error: 'Cannot merge an entity into itself' });
      await mergeEntities(database, k, fromId, request.body.intoId);
      await log(request, `${k}.merge`, `${k}:${fromId}`, { intoId: request.body.intoId });
      return { ok: true };
    },
  );

  // Health of the pipeline

  api.get(
    '/stats',
    {
      schema: {
        tags: ['Operations'],
        summary: 'Messages, outcomes, model calls and cost per day; review load',
        querystring: z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }),
      },
    },
    (request) => stats(database, request.query.days),
  );

  api.get(
    '/jobs/failed',
    { schema: { tags: ['Operations'], summary: 'Jobs that failed all their retries' } },
    () => failedJobs(database),
  );

  api.post(
    '/jobs/:queue/:jobId/retry',
    {
      schema: {
        tags: ['Operations'],
        summary: 'Run a failed job again',
        params: z.object({ queue: z.string().regex(/^[a-z_-]+$/), jobId: z.uuid() }),
      },
    },
    async (request) => {
      await retryJob(options.boss, request.params.queue, request.params.jobId);
      await log(request, 'job.retry', `job:${request.params.queue}:${request.params.jobId}`);
      return { ok: true };
    },
  );

  // Settings and export

  api.get('/settings', { schema: { tags: ['Settings'], summary: 'Owner settings' } }, async () => ({
    usdEgpRate: (await getSetting(db, 'usd_egp_rate')) ?? null,
    usdEgpRateFallback: options.usdEgpRateFallback ?? null,
  }));

  api.put(
    '/settings/usd-egp-rate',
    {
      schema: {
        tags: ['Settings'],
        summary: 'EGP per 1 USD, used to convert USD prices in exports',
        body: z.object({ value: z.number().positive().max(10_000) }),
      },
    },
    async (request) => {
      const before = await getSetting(db, 'usd_egp_rate');
      await setSetting(db, 'usd_egp_rate', request.body.value, request.owner?.id ?? null);
      await log(request, 'settings.update', 'setting:usd_egp_rate', {
        before: before ?? null,
        after: request.body.value,
      });
      return { usdEgpRate: request.body.value };
    },
  );

  api.get(
    '/export.xlsx',
    {
      schema: {
        tags: ['Settings'],
        summary: 'Download units in the Primary Units template (active only unless all=true)',
        querystring: z.object({ all: z.stringbool().default(false) }),
      },
    },
    async (request, reply) => {
      const usdToEgp = await usdToEgpRate(db, options.usdEgpRateFallback);
      let result: Awaited<ReturnType<typeof exportUnits>>;
      try {
        result = await exportUnits(database, { usdToEgp, includeInactive: request.query.all });
      } catch (error) {
        return reply
          .code(400)
          .send({ error: error instanceof Error ? error.message : String(error) });
      }
      await log(request, 'units.export', null, { count: result.count, all: request.query.all });
      const day = new Date().toISOString().slice(0, 10);
      return reply
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="primary-units-${day}.xlsx"`)
        .send(result.file);
    },
  );

  // Firms and their users (Phase 6)

  api.get(
    '/firms',
    {
      schema: {
        tags: ['Firms'],
        summary: 'Every firm with its plan, users and usage in the last 30 days',
      },
    },
    (request) => listFirms(db, actorOf(request)),
  );

  api.post(
    '/firms',
    {
      schema: {
        tags: ['Firms'],
        summary: 'Create a firm',
        body: firmInputSchema.required({ name: true }),
      },
    },
    async (request, reply) => {
      const firmId = await createFirm(db, actorOf(request), request.body);
      await log(request, 'firm.create', `firm:${firmId}`, request.body);
      return reply.code(201).send({ id: firmId });
    },
  );

  api.patch(
    '/firms/:id',
    {
      schema: {
        tags: ['Firms'],
        summary:
          'Change a firm: plan, user limit, contract dates, notes; suspend (signs its users out) or reactivate',
        params: z.object({ id }),
        body: firmInputSchema,
      },
    },
    async (request) => {
      await updateFirm(db, actorOf(request), request.params.id, request.body);
      await log(request, 'firm.update', `firm:${request.params.id}`, request.body);
      return { ok: true };
    },
  );

  api.get(
    '/firms/:id/team',
    {
      schema: {
        tags: ['Firms'],
        summary: "A firm's users: invited, active or removed",
        params: z.object({ id }),
      },
    },
    (request) => listTeam(db, actorOf(request), request.params.id),
  );

  api.get(
    '/firms/:id/usage',
    {
      schema: {
        tags: ['Firms'],
        summary: 'Searches, exports and listing views per day',
        params: z.object({ id }),
        querystring: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
      },
    },
    (request) => usageByDay(db, request.params.id, request.query.days),
  );

  api.post(
    '/firms/:id/invitations',
    {
      schema: {
        tags: ['Firms'],
        summary:
          'Add a firm admin or agent; returns the invitation link to send them (valid 7 days)',
        params: z.object({ id }),
        body: inviteSchema,
      },
    },
    async (request, reply) => {
      const invited = await inviteUser(db, actorOf(request), request.params.id, request.body);
      await log(request, 'user.invite', `user:${invited.userId}`, {
        firmId: request.params.id,
        role: request.body.role,
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
    '/users/:userId/link',
    {
      schema: {
        tags: ['Firms'],
        summary:
          'A new invitation (if they never signed in) or password-reset link for a firm user',
        params: z.object({ userId: z.uuid() }),
      },
    },
    async (request) => {
      const created = await newAccessLink(db, actorOf(request), request.params.userId);
      await log(request, `user.link.${created.purpose}`, `user:${request.params.userId}`);
      return {
        purpose: created.purpose,
        link: passwordLink(options.publicUrl, created.token),
        expiresAt: created.expiresAt,
      };
    },
  );

  api.patch(
    '/users/:userId',
    {
      schema: {
        tags: ['Firms'],
        summary: 'Remove a firm user (signs them out, blocks sign-in) or restore them',
        params: z.object({ userId: z.uuid() }),
        body: z.object({ removed: z.boolean() }),
      },
    },
    async (request) => {
      await setRemoved(db, actorOf(request), request.params.userId, request.body.removed);
      await log(
        request,
        request.body.removed ? 'user.remove' : 'user.restore',
        `user:${request.params.userId}`,
      );
      return { ok: true };
    },
  );

  api.setErrorHandler(sendError);
  done();
};
