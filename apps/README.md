# apps/

Each app connects code from `packages/` to the outside world. No business logic lives here (build plan, rule 2).

| App       | Phase 0 state                             | Fills in                                        |
| --------- | ----------------------------------------- | ----------------------------------------------- |
| `capture` | Starts, serves `/health` on `HEALTH_PORT` | Phase 1: Baileys listener on the scraper number |
| `worker`  | Starts, serves `/health`                  | Phases 1 to 4: pg-boss pipeline jobs            |
| `api`     | Fastify, `GET /health` on `API_PORT`      | Phase 5: owner admin; Phase 6: firm API         |
| `web`     | Vite + React placeholder page             | Phase 5: owner admin; Phase 6: firm dashboard   |
| `chatbot` | Starts, serves `/health`                  | Phase 7: WhatsApp query bot + Telegram          |

Run one locally with `pnpm dev:<name>` (Postgres must be running). Each Node app runs its TypeScript directly with Node: there is no build step.
