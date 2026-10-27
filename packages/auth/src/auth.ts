import { accounts, sessions, users, verifications, type Db } from '@reb/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { accessProblem } from './access.ts';

export interface AuthOptions {
  /** Signs session cookies (AUTH_SECRET). */
  secret: string;
  /** The address people open in the browser (PUBLIC_URL). */
  baseUrl: string;
}

/**
 * Login and sessions (build plan: Better Auth, session-based).
 *
 * - E-mail and password only. **Public sign-up is off**: accounts are
 *   created by the owner (`create-owner`) or by invitation (Phase 6).
 * - A removed user, or anyone in a suspended firm or after its contract
 *   ended, can't sign in (and the API checks again on every request).
 * - Sessions last 7 days, renewed daily while in use, in an HTTP-only cookie.
 * - Sign-in is rate-limited (5 attempts per minute per IP), on top of
 *   Better Auth's general limit.
 */
export function createAuth(db: Db, options: AuthOptions) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    secret: options.secret,
    baseURL: options.baseUrl,
    basePath: '/api/auth',
    trustedOrigins: [options.baseUrl],
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10 },
    user: {
      additionalFields: {
        role: { type: 'string', required: false, defaultValue: 'agent', input: false },
        phone: { type: 'string', required: false, input: false },
        firmId: { type: 'number', required: false, input: false },
        locale: { type: 'string', required: false, defaultValue: 'en', input: false },
        disabled: { type: 'boolean', required: false, defaultValue: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const problem = await accessProblem(db, session.userId);
            if (problem) throw new APIError('FORBIDDEN', { message: problem });
          },
        },
      },
    },
    session: { expiresIn: 7 * 24 * 3600, updateAge: 24 * 3600 },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 5 } },
    },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
