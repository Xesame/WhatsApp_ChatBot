# @reb/runtime

The shared startup, logging and health-check code every service uses.

| Export                                  | What it does                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createLogger(service, level)`          | pino JSON logger. Every line carries `service`. Personal-data fields (`phone`, `pushName`, `senderName`, ...) are replaced with `[redacted]`.                       |
| `runService(name, start)`               | Loads config, creates the logger and database pool, starts `/health`, calls `start`, and shuts down cleanly on SIGTERM/SIGINT. Used by capture, worker and chatbot. |
| `startHealthServer` / `runHealthChecks` | `GET /health` returns 200 with `{"status":"ok"}` when every check passes, 503 with the failing check's message otherwise.                                           |

**Why it is designed this way.**

- **Every service starts, fails and stops the same way**, so logs and Docker behaviour are predictable.
- **Health checks test real dependencies.** Each service pings the database. Later phases add more checks (for example "WhatsApp connected" in capture). Docker restarts a container whose health check keeps failing.
- **Redaction is a safety net**, not the main privacy control. Sender identity is hashed before it is stored (Phase 1), but if a raw field is ever logged by mistake, pino blanks it.
- **Database restarts don't crash services.** A lost idle connection is logged as a warning and the pool reconnects on the next query.
- This package is not in the build plan's layout. See the decision log in PROJECT.md.
