# apps/

Each app connects code from `packages/` to the outside world. No business logic lives here (build plan, rule 2).

| App       | Phase 0 state                                                                                                                                 | Fills in                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `capture` | **Phase 1 done:** scraper number connection, stores watched-group messages and media, queues jobs. See [capture/README.md](capture/README.md) | Phase 5: pairing and groups from the admin page |
| `worker`  | Supervises the pg-boss job queue                                                                                                              | Phases 2 to 4: pipeline jobs                    |
| `api`     | Fastify, `GET /health` on `API_PORT`                                                                                                          | Phase 5: owner admin; Phase 6: firm API         |
| `web`     | Vite + React placeholder page                                                                                                                 | Phase 5: owner admin; Phase 6: firm dashboard   |
| `chatbot` | Starts, serves `/health`                                                                                                                      | Phase 7: WhatsApp query bot + Telegram          |

Run one locally with `pnpm dev:<name>` (Postgres must be running). Each Node app runs its TypeScript directly with Node: there is no build step.
