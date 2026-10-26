import { accounts, sessions, users, verifications, type Db } from '@reb/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

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
 *   created by the owner (`create-owner` command now, firm invitations in
 *   Phase 6).
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
