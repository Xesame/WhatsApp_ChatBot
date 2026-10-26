# @reb/auth

Login for the admin console, built on [Better Auth](https://www.better-auth.com) with its tables (`users`, `sessions`, `accounts`, `verifications`) in our own Postgres through the Drizzle adapter.

| Export                                       | What it does                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `createAuth(db, { secret, baseUrl })`        | The Better Auth instance the API mounts at `/api/auth/*`                                              |
| `upsertOwner(db, { name, email, password })` | Creates the owner, or resets the password of an existing one (used by `apps/api/src/create-owner.ts`) |

**Settings, and why**

- E-mail and password only; **sign-up is disabled**. The owner is created on the server, so nobody can register from the internet. Firm users (Phase 6) will be invited the same way.
- Passwords of at least 10 characters, hashed with Better Auth's scrypt (never stored or logged as text).
- Sessions last 7 days and are extended once a day while used; the cookie is http-only and SameSite=Lax, Secure on an https `PUBLIC_URL`.
- At most 5 sign-in attempts per minute per IP address (100 requests per minute for other auth routes).
- Every user has a `role`: `owner` now; `firm_admin` and `agent` arrive with firms in Phase 6. Roles can't be set through the auth API (`input: false`).
- Telemetry is off.

Tests (`test/owner.integration.test.ts`, real Postgres and real Better Auth): owner created with a hashed password, sign-in returns an http-only session cookie, wrong password refused, sign-up refused, re-running `upsertOwner` resets the password and keeps one account.
