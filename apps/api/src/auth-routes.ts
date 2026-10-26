import { audit } from '@reb/admin';
import type { Auth } from '@reb/auth';
import type { Db } from '@reb/db';
import type { FastifyPluginCallback } from 'fastify';

/**
 * Mounts Better Auth at /api/auth/* (sign in, sign out, session).
 *
 * Fastify's request is turned into a standard `Request` for Better Auth, and
 * its `Response` back into a reply. The body is passed through as raw text,
 * so Better Auth sees exactly what the browser sent. Every sign-in attempt,
 * successful or not, is written to the audit log.
 */
export const authRoutes: FastifyPluginCallback<{ auth: Auth; db: Db; publicUrl: string }> = (
  instance,
  options,
  done,
) => {
  instance.removeAllContentTypeParsers();
  instance.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, next) => {
    next(null, body);
  });

  instance.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    schema: { hide: true }, // documented by Better Auth
    handler: async (request, reply) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      // Better Auth limits sign-in attempts per IP address. The web proxy
      // appends the caller's address last; earlier entries could be forged.
      const ip = clientIp(request.headers['x-forwarded-for'], request.ip);
      headers.set('x-forwarded-for', ip);
      const body =
        typeof request.body === 'string' && request.body.length > 0 ? request.body : undefined;
      const response = await options.auth.handler(
        new Request(new URL(request.url, options.publicUrl), {
          method: request.method,
          headers,
          body,
        }),
      );

      const path = request.url.split('?')[0] ?? '';
      if (path.endsWith('/sign-in/email')) {
        await auditSignIn(options.db, ip, body, response.clone());
      }

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie' && key !== 'content-length') void reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) void reply.header('set-cookie', cookies);
      return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
    },
  });
  done();
};

/** The last address in X-Forwarded-For (added by our own proxy), else the socket's. */
export function clientIp(forwarded: string | string[] | undefined, socketIp: string): string {
  const list = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.at(-1) ?? socketIp;
}

async function auditSignIn(
  db: Db,
  ipAddress: string,
  body: string | undefined,
  response: Response,
) {
  if (response.ok) {
    const json = (await response.json().catch(() => null)) as { user?: { id?: string } } | null;
    await audit(db, { userId: json?.user?.id ?? null, action: 'login', ipAddress });
    return;
  }
  let email: unknown;
  try {
    email = (JSON.parse(body ?? '{}') as { email?: unknown }).email;
  } catch {
    email = undefined;
  }
  await audit(db, {
    userId: null,
    action: 'login_failed',
    details: {
      email: typeof email === 'string' ? email.slice(0, 200) : null,
      status: response.status,
    },
    ipAddress,
  });
}
