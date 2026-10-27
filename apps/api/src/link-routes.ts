import type { Db } from '@reb/db';
import { accessLinkInfo, redeemAccessLink } from '@reb/firms';
import type { FastifyPluginCallback } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { fromOtherSite, sendError } from './http.ts';

const token = z.string().regex(/^[A-Za-z0-9_-]{40,60}$/);

/**
 * The "set your password" page behind invitation and reset links. No session
 * needed: the token is the proof. Tokens are 256-bit random, so they can't be
 * guessed, and work once.
 */
export const linkRoutes: FastifyPluginCallback<{ db: Db; publicUrl: string }> = (
  parent,
  options,
  done,
) => {
  const api = parent.withTypeProvider<ZodTypeProvider>();
  const publicOrigin = new URL(options.publicUrl).origin;
  api.setErrorHandler(sendError);

  api.post(
    '/info',
    {
      schema: {
        tags: ['Account'],
        summary: 'Who a set-password link is for (name, e-mail, firm), or 404 if expired or used',
        body: z.object({ token }),
      },
    },
    async (request, reply) =>
      (await accessLinkInfo(options.db, request.body.token)) ??
      reply.code(404).send({ error: 'This link has expired or was already used' }),
  );

  api.post(
    '/redeem',
    {
      schema: {
        tags: ['Account'],
        summary: 'Set the password (at least 10 characters) through a link, once',
        body: z.object({ token, password: z.string().min(10).max(200) }),
      },
    },
    async (request, reply) => {
      if (fromOtherSite(request, publicOrigin))
        return reply.code(403).send({ error: 'Request from another site refused' });
      return redeemAccessLink(options.db, request.body.token, request.body.password);
    },
  );
  done();
};
