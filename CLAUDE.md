# Working on Real Estate Bot

Read `docs/HANDOFF.md` first: it is the story so far (what is built, every decision Hassan made, test findings, what is waiting, what is next). `PROJECT.md` is the full technical manual.

## Who and what

Hassan Karam Elshimy, a broker in Egypt, owns this. The system reads Egyptian developer and broker WhatsApp groups, turns every listing (text, flyers, PDFs, Excel) into clean, deduplicated units with price history, and sells access to brokerage firms as a subscription (firm dashboard in Arabic and English). Hassan is not a programmer: explain in plain words, avoid jargon in replies.

## How Hassan wants us to work

- Build one phase at a time (phases 0 to 8, PROJECT.md "Build status"). At each checkpoint report: what was built, how to run it, what the checks showed, any deviation and why. Don't start the next phase until he confirms.
- After each major update: commit (small commits labeled by phase, e.g. `phase-7: ...`), push to `main` on github.com/Xesame/WhatsApp_ChatBot, and give him a detailed explanation of what was done.
- Keep `PITCH.md` (plain-language pitch for investors and buyers) updated at the end of every phase. Only claim what is built and tested.
- Update `PROJECT.md` (and package READMEs) for everything built; `pnpm run docs` regenerates `docs/generated/*`.
- When the plan is silent or ambiguous, ask him before choosing. Don't add a service, database or paid API without asking.
- Never ask him to paste an API key, token or password into the chat. Keys go in `.env` (never committed) or the environment's settings. Never print secret values.

## Binding rules (build plan, section 12)

1. Never hardcode listing fields outside `packages/schema`.
2. Never put extraction, matching or business logic in `apps/`; it belongs in `packages/` with tests.
3. Never send sender names or phone numbers to any model, log or firm-facing response.
4. Never let the LLM do arithmetic, currency conversion or confidence scoring.
5. Never skip firm scoping on a query that touches firm data (`@reb/firms` takes the signed-in person on every call).
6. Every pipeline job must be idempotent and safe to retry.
7. Every schema change goes through a Drizzle migration; never edit the database by hand.
8. Before each checkpoint: lint, type check, tests, `pnpm run docs`, and the eval set.
9. Small commits labeled by phase.
10. No new service, database or paid API without asking.
11. Explain non-obvious decisions in code comments and module READMEs, in plain English.

## Checks

```sh
pnpm install
pnpm check                      # lint, format, types, tests, generated-docs check
TEST_DATABASE_URL=postgres://reb:<password>@localhost:5432/reb pnpm test   # with database integration tests
```

Changing an LLM prompt: bump its `VERSION`, then run `pnpm eval` and compare before deploying.
