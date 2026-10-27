import { NotFoundError as ReviewNotFound } from '@reb/admin';
import { accessProblem, type Auth } from '@reb/auth';
import type { Db } from '@reb/db';
import type { Actor } from '@reb/firms';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { z } from 'zod';

/** The signed-in person, as the API sees them. */
export interface SignedInUser extends Actor {
  name: string;
  email: string;
  locale: 'en' | 'ar';
}

/**
 * Who is signed in, or why not: 401 without a session, 403 when the person
 * was removed or their firm is suspended or past its contract (checked on
 * every request, so it takes effect at once).
 */
export async function sessionUser(
  auth: Auth,
  db: Db,
  request: FastifyRequest,
): Promise<{ user: SignedInUser } | { status: 401 | 403; error: string }> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session) return { status: 401, error: 'Sign in first' };
  const problem = await accessProblem(db, session.user.id);
  if (problem) return { status: 403, error: problem };
  const u = session.user as typeof session.user & {
    role?: SignedInUser['role'];
    firmId?: number | null;
    locale?: SignedInUser['locale'];
  };
  return {
    user: {
      userId: u.id,
      name: u.name,
      email: u.email,
      role: u.role ?? 'agent',
      firmId: u.firmId ?? null,
      locale: u.locale ?? 'en',
    },
  };
}

/**
 * Changes are accepted only from pages served at PUBLIC_URL: a second guard
 * behind the SameSite session cookie against cross-site requests.
 */
export function fromOtherSite(request: FastifyRequest, publicOrigin: string): boolean {
  const origin = request.headers.origin;
  return request.method !== 'GET' && origin !== undefined && origin !== publicOrigin;
}

/** Turns thrown errors into plain answers; unexpected ones are logged and hidden. */
export function sendError(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({
      error: 'Invalid value',
      issues: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
  if (error instanceof ReviewNotFound || error.name === 'NotFoundError') {
    return reply.code(404).send({ error: error.message });
  }
  if (error.name === 'ForbiddenError') return reply.code(403).send({ error: error.message });
  if (error.name === 'ConflictError') return reply.code(409).send({ error: error.message });
  const e = error as {
    statusCode?: number;
    validation?: unknown;
    code?: string;
    cause?: { code?: string };
  };
  if (e.validation) return reply.code(400).send({ error: error.message });
  if (e.code === '23505' || e.cause?.code === '23505') {
    return reply.code(409).send({ error: 'That name is already used' });
  }
  if (e.statusCode && e.statusCode < 500)
    return reply.code(e.statusCode).send({ error: error.message });
  reply.log.error({ err: error }, 'Request failed');
  return reply.code(500).send({ error: 'Something went wrong; see the API log' });
}

/** Streams a stored media file, only from inside MEDIA_DIR. */
export async function sendMediaFile(
  reply: FastifyReply,
  mediaDir: string,
  file: { path: string | null; mimeType: string | null } | null | undefined,
) {
  const root = resolve(mediaDir);
  const path = file?.path ? resolve(root, file.path) : null;
  if (!path?.startsWith(root + sep)) return reply.code(404).send({ error: 'File not found' });
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return reply.code(404).send({ error: 'File not found' });
  return reply
    .type(file?.mimeType ?? 'application/octet-stream')
    .header('content-length', info.size)
    .header('cache-control', 'private, max-age=86400')
    .header('x-content-type-options', 'nosniff')
    .header(
      'content-security-policy',
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    )
    .send(createReadStream(path));
}

/** The link someone opens to set their password. The token travels after `#`, so it never reaches server logs. */
export const passwordLink = (publicUrl: string, token: string) =>
  `${publicUrl.replace(/\/$/, '')}/set-password#${token}`;
