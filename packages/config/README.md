# @reb/config

Typed loading of environment variables.

**What it does.** `loadConfig()` reads `process.env`, checks every value against a Zod schema, fills in defaults and returns a typed object. If anything is missing or invalid, the service stops at startup with a message naming the variable, instead of failing later in the middle of a job.

**Why it is designed this way.**

- **One schema, three uses.** `src/env.ts` is the only place a variable is defined. The same schema validates at runtime, gives TypeScript types (`config.API_PORT` is a `number`), and, through `pnpm run docs`, generates `docs/generated/env.md` and `.env.example`. Adding a variable without a description fails the docs build.
- **Compose-only variables** (`POSTGRES_*`) are in a separate `composeEnvSchema`. They are documented and appear in `.env.example`, but application code never reads them.
- **Empty means unset.** `LOG_LEVEL=` in `.env` uses the default rather than failing.

**Adding a variable:** add it to `envSchema` with `.meta({ description, usedBy, examples })` (and `secret: true` if it is a secret), run `pnpm run docs`, commit the regenerated files.
