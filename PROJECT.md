# Real Estate Bot: Project Manual

This is the full technical manual. Together with [README.md](README.md), someone who has never seen the project should be able to understand it, set it up from zero, run it and fix it. Each chapter says what exists **now**. Parts that later phases will build are marked _(Phase N)_.

Reference material that could drift from the code is generated, not hand-written:

- [docs/generated/env.md](docs/generated/env.md): environment variables (from `packages/config/src/env.ts`)
- [docs/generated/database.md](docs/generated/database.md): tables, columns, indexes and entity diagram (from `packages/db/src/schema/`)
- API reference _(Phase 5, generated from Fastify route schemas)_

Regenerate them with `pnpm run docs`. CI runs `pnpm docs:check` and fails if they are out of date.

## Build status

| Phase | Scope                                                         | Status                                                     |
| ----- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| 0     | Foundation: monorepo, config, logging, Docker, database, seed | **Done**                                                   |
| 1     | Capture (Baileys, raw messages, media)                        | **Done** (live WhatsApp test waits for the scraper number) |
| 2     | Text extraction and eval harness                              | Not started                                                |
| 3     | Media extraction (vision, PDF, speech-to-text)                | Not started                                                |
| 4     | Dedup, price history, lifecycle                               | Not started                                                |
| 5     | API and owner admin                                           | Not started                                                |
| 6     | Multi-tenant firm dashboard                                   | Not started                                                |
| 7     | Chat bots and alerts                                          | Not started                                                |
| 8     | Hardening and deploy                                          | Not started                                                |

---

## 1. Overview and glossary

Hassan, a broker, runs this as a service. A bot reads Egyptian developer and broker WhatsApp groups and turns every listing into structured, deduplicated records that stay current. Brokerage firms pay for access to that shared listing pool. They get fresher and cleaner data than they would by reading the groups themselves.

**Users.** The **owner** (Hassan) controls everything. Each **firm** has a **firm admin** who manages the firm's users, and **agents** who search, save searches, get alerts and export.

| Term                            | Meaning in the code                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Entity**                      | A canonical city, developer or project: one official row per real-world thing (`cities`, `developers`, `projects`).                            |
| **Alias**                       | Another spelling of an entity, in any script (`entity_aliases`). "التجمع", "5th Settlement" and "Tagamoa" are aliases of the city _New Cairo_. |
| **Normalized name**             | The output of `normalizeName()`: lowercase, unified Arabic letters, no diacritics or punctuation. Aliases are matched on this.                 |
| **Seed**                        | The starter list of entities and aliases in `packages/db/seed/`, loaded by `pnpm db:seed`.                                                     |
| **Migration**                   | A numbered SQL file in `packages/db/migrations/` that changes the database structure.                                                          |
| **Unit / offering** _(Phase 2)_ | One row in `units`: a unit type with area and price range in one project, or a single named unit when a Unit Code is given.                    |
| **Source** _(Phase 4)_          | A WhatsApp message that mentioned a unit. One unit can have many sources.                                                                      |
| **Run** _(Phase 2)_             | One LLM extraction attempt on one message (`extraction_runs`), with its prompt version and model.                                              |
| **Prompt version** _(Phase 2)_  | The version string of the extraction prompt, recorded on every run so results can be compared.                                                 |
| **Firm** _(Phase 6)_            | A paying brokerage. Owns its users, saved searches, alerts and notes. Listings are shared.                                                     |
| **Saved search** _(Phase 6)_    | A stored filter that can trigger alerts.                                                                                                       |
| **JID**                         | A WhatsApp address. Groups end in `@g.us`, people in `@s.whatsapp.net` (phone number) or `@lid` (private ID).                                  |
| **LID**                         | WhatsApp's private per-user ID, used in groups instead of the phone number. Preferred for sender hashing.                                      |
| **Sender hash**                 | `messages.sender_hash`: salted HMAC-SHA256 of the sender's ID. Same person → same hash; the number can't be recovered.                         |
| **Watched group**               | A group whose messages capture stores (`wa_groups.watched`). New groups start unwatched.                                                       |
| **Account**                     | A WhatsApp number the system uses: `scraper` (capture) or `query-bot` (Phase 7).                                                               |
| **Job / queue**                 | A unit of pipeline work in pg-boss (e.g. `preprocess` for one message), retried on failure.                                                    |

## 2. Architecture

```mermaid
flowchart TD
  WA[WhatsApp groups] -->|scraper number| capture
  capture -->|raw messages, media files| PG[(PostgreSQL 16)]
  capture -->|enqueue job| Q[[pg-boss queue in Postgres]]
  Q --> worker
  worker -->|preprocess media, extract, normalize, dedup, alerts| PG
  api --> PG
  web -->|HTTP| api
  chatbot -->|query bot number| Agents[Firm agents]
  chatbot --> PG
  chatbot -.->|fallback| TG[Telegram]
```

| Service | Responsibility                                                                                                 | Must never                         |
| ------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| capture | Stay connected to WhatsApp, save every message from watched groups with media and reply context, enqueue a job | Call an LLM or do heavy processing |
| worker  | Run all pipeline jobs with retries, backoff and rate limits                                                    | Talk to WhatsApp directly          |
| api     | Auth, firm scoping, search, review, admin actions, exports                                                     | Contain extraction logic           |
| web     | Firm dashboard and owner admin UI                                                                              | Query the database directly        |
| chatbot | Answer listing queries and deliver alerts, Telegram as fallback                                                | Use the scraper's WhatsApp number  |

**Why these choices**

- **Capture and worker are separate.** Capture only saves; it never waits for a model. If a model is slow, down or out of credit, messages still pile up safely in Postgres and are processed later. Old messages can be reprocessed after any prompt or model change.
- **The queue is in Postgres (pg-boss).** No Redis to run, back up or monitor. Jobs, retries and schedules live next to the data and are covered by the same backup.
- **Baileys** talks to WhatsApp over a WebSocket without a headless browser, so it is lighter and easier to deploy than whatsapp-web.js. It is unofficial, so the scraper and query bot use separate numbers and Telegram is the fallback.
- **One shared Zod schema** _(Phase 2)_ defines the listing fields once; database types, LLM JSON schema and API types come from it.
- **The LLM reads; code decides.** The model only pulls raw values out of messy text. All arithmetic, entity matching, currency handling, confidence scoring and merge decisions are deterministic code with tests.
- **Node runs TypeScript directly.** Node 24 strips type annotations at load time, so there is no compile step for the Node services: the code that runs is the code you read. `tsc` is used only as a type checker. The cost: TypeScript-only runtime features (`enum`, `namespace`) are not allowed, which `erasableSyntaxOnly` enforces. Use `as const` objects or Zod enums instead.
- **One Docker image for all services.** Each service is the same image with a different command, so they always share exact code and dependency versions.

**Runtime behaviour.** Every Node service starts through `runService` (`packages/runtime`): load config (refusing to start if a variable that service requires is missing), then logger, then database pool, then `/health`. On SIGTERM it shuts down cleanly. The API is the exception: it has its own Fastify server and serves `/health` on `API_PORT`.

**Capture in one picture (Phase 1)**

```mermaid
sequenceDiagram
  participant WA as WhatsApp
  participant C as WhatsAppConnection
  participant P as parseMessage
  participant I as Ingestor
  participant DB as Postgres
  WA->>C: messages.upsert (batch)
  C->>P: raw message + salt
  P-->>C: parsed (sender hashed) or ignore
  C->>I: handle(batch), in order, retried ~2 min on DB errors
  I->>DB: watched group? (30 s cache)
  alt text only
    I->>DB: one transaction: insert message + queue preprocess job
  else with media
    I->>DB: insert message + media_files(pending)
    I->>WA: download + decrypt file (background, 3 at a time)
    I->>DB: one transaction: media downloaded + queue job
  end
```

## 3. Repository map

```
realestate-bot/
  apps/
    capture/   src/main.ts (wiring), src/cli.ts (groups command)
    worker/    src/main.ts: supervises the job queue                    (jobs: Phases 2-4)
    api/       src/app.ts (Fastify routes), src/main.ts (startup)       (Phases 5-6)
    web/       Vite + React placeholder                                 (Phases 5-6)
    chatbot/   src/main.ts: skeleton service                          (Phase 7)
  packages/
    config/    env schema (Zod) and loadConfig()
    db/        Drizzle schema, migrations, client, migrate + seed scripts, seed data
    normalize/ normalizeName() and digit conversion
    runtime/   logger, health server, runService()
    queue/     pg-boss setup, job names and payloads, transactional enqueue
    whatsapp/  Baileys connection, Postgres auth store, message parsing, sender hashing
    ingest/    storing messages and media, groups, exactly-once queueing, crash recovery
  scripts/docs.ts           generates docs/generated/* and .env.example
  docs/generated/           generated reference docs (do not edit)
  docker-compose.yml        Postgres + migrate step + five services
  Dockerfile                one image for every service
  .github/workflows/ci.yml  lint, format, types, tests (with real Postgres), docs check, web build
```

| Package          | Owns                                                             | Main files                                               | Used by                            |
| ---------------- | ---------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------- |
| `@reb/config`    | Environment variables: schema, defaults, validation              | `src/env.ts`, `src/load.ts`                              | db, runtime, api, scripts          |
| `@reb/normalize` | Deterministic text normalization                                 | `src/text.ts`                                            | db (seed) and, later, the pipeline |
| `@reb/db`        | Tables, migrations, pool, seed                                   | `src/schema/*`, `migrations/*`, `src/seed.ts`, `seed/*`  | runtime, api, scripts              |
| `@reb/runtime`   | Logging, health checks, service lifecycle                        | `src/logger.ts`, `src/health.ts`, `src/service.ts`       | all Node apps                      |
| `@reb/queue`     | Job queue (pg-boss): queues, payload schemas, retries            | `src/queues.ts`, `src/boss.ts`                           | capture, worker, ingest            |
| `@reb/whatsapp`  | WhatsApp connection, login keys, message parsing, sender hashing | `src/connection.ts`, `src/parse.ts`, `src/auth-store.ts` | capture; chatbot (Phase 7)         |
| `@reb/ingest`    | Storing messages and media, group management, queueing           | `src/ingestor.ts`, `src/files.ts`, `src/groups.ts`       | capture; api (Phase 5)             |

Packages planned for later phases and not created yet: `schema` and `llm` (Phase 2), `media` (Phase 3), `dedup` (Phase 4), `chat-core` (Phase 7), and the `eval/` folder (Phase 2).

**Dependency direction:** `apps → (runtime, ingest) → (whatsapp, queue) → db → (config, normalize)`. Packages never import from apps.

**Library versions** (checked 2026-10-25):

| Library                               | Version                          | Note                                                                   |
| ------------------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| Node.js                               | 24 LTS (Docker), ≥ 22.18 locally | 22.18+ runs TypeScript without flags                                   |
| pnpm                                  | 12.15.0                          |                                                                        |
| TypeScript                            | 6.0.3                            | 7.0 exists but typescript-eslint supports < 6.1                        |
| drizzle-orm / drizzle-kit             | 0.45.4 / 0.31.11                 | latest stable; 1.0 is still beta                                       |
| pg (node-postgres)                    | 8.23.1                           |                                                                        |
| zod                                   | 4.6.7                            |                                                                        |
| pino                                  | 10.4.0                           |                                                                        |
| fastify                               | 5.12.7                           |                                                                        |
| vite / react                          | 8.3.5 / 19.3.1                   |                                                                        |
| vitest                                | 5.0.5                            |                                                                        |
| eslint / typescript-eslint / prettier | 10.13.0 / 8.72.0 / 3.9.10        |                                                                        |
| pg-boss                               | 12.38.0                          |                                                                        |
| baileys                               | 7.0.0-rc14                       | npm's `latest` tag; the 6.x line is marked `legacy`. See decision log. |
| qrcode                                | 1.5.4                            | Prints the pairing QR code in the logs                                 |
| grammY                                | 1.46.0                           | Phase 7                                                                |
| better-auth                           | 1.7.12                           | Phase 5                                                                |
| exceljs                               | 4.4.0                            | Phase 2                                                                |

## 4. Data model

The full generated reference, with every column and an entity diagram, is in [docs/generated/database.md](docs/generated/database.md).

**Canonical entities (Phase 0)**

```mermaid
erDiagram
  developers ||--o{ projects : builds
  cities ||--o{ projects : contains
  cities ||--o{ entity_aliases : "also called"
  developers ||--o{ entity_aliases : "also called"
  projects ||--o{ entity_aliases : "also called"
```

- `cities`, `developers`: an English name (unique, used in exports) and an Arabic name.
- `projects`: belong to one developer and one city. The English name is unique per developer.
- `entity_aliases`: every known spelling. Exactly one of `city_id`, `developer_id`, `project_id` is set (a CHECK constraint enforces it). The same normalized spelling cannot point at the same entity twice, but it may name a city _and_ a project (for example "Madinaty").
- Deleting a city or developer that still has projects is refused (`ON DELETE RESTRICT`). Deleting an entity deletes its aliases (`ON DELETE CASCADE`).
- IDs are small integers (identity columns) because these tables are small and you will read and type these IDs by hand.

**How names are matched.** Both the stored alias and the incoming text go through `normalizeName()` (chapter 6), then:

1. exact match on `alias_normalized` (index), and if nothing is found
2. fuzzy match with pg_trgm: `alias_normalized % $1 ORDER BY similarity(...) DESC` (GIN trigram index).

The matching function itself arrives with extraction in Phase 2. The table and indexes are ready.

**Capture tables (Phase 1)**

```mermaid
erDiagram
  wa_groups ||--o{ messages : contains
  messages ||--o| media_files : "has file"
```

- `wa_groups`: every group the scraper number is in. `watched` (default false) decides whether messages are stored; `source_type` is developer or broker; `is_member` turns false when the number leaves.
- `messages`: one row per stored message, unique per (group, WhatsApp ID). Holds the text or caption, `sender_hash`, `quoted_wa_message_id` (reply context), `edit_of_wa_message_id` (edits are new rows), `deleted_at` ("delete for everyone"), `is_forwarded`, and processing fields: `status` (`pending` → `processing` → `processed` / `skipped` / `failed`), `error`, `attempts`, `enqueued_at`.
- `media_files`: at most one per message. `status`: `pending` → `downloaded`, or `failed` (5 attempts) / `skipped` (over the size limit). `sha256` and `path` (content-addressed under MEDIA_DIR). `media_ref` lets the file be downloaded again.
- `wa_auth`: WhatsApp login keys per account. **Treat as a secret**: whoever has these rows can act as the number.
- `wa_connections`: live status per account (`state`, QR/pairing code while pairing, last connect/disconnect and reason, last message time).
- Status and type columns have CHECK constraints, so the database rejects unknown values.

**Tables added by later phases:** `units`, `extraction_runs` (Phase 2); `unit_prices`, `unit_sources` (Phase 4); `review_corrections`, `audit_log` (Phase 5); `firms`, `users`, `chat_identities`, `saved_searches`, `firm_notes`, `usage_events` (Phase 6); `alert_deliveries` (Phase 7). Each arrives as its own migration in the phase that uses it.

**Primary Units template mapping** _(Phase 2)_: the 26 template columns, their database columns and export rules will be generated here from `packages/schema`.

**Money** _(Phase 2)_ is stored as integer piastres with an explicit currency column. Conversion happens only at query time.

## 5. Pipeline

Each step is its own pg-boss job type, idempotent, with retries and backoff. Jobs carry only IDs and read everything else from the database.

**Step 1: capture (Phase 1, in the capture service, not a job)**

|             |                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Input       | WhatsApp `messages.upsert` events from the scraper number                                                                                                                                  |
| Output      | `messages` row (+ `media_files` row and file on disk), then one `preprocess` job                                                                                                           |
| Ignored     | Unwatched groups, private chats, status updates, own messages, stickers, reactions, polls, system notices                                                                                  |
| Idempotency | Unique (group, WhatsApp ID) → a redelivered message is skipped. `enqueued_at` is set in the same transaction as the job, only if empty → exactly one job per message.                      |
| Retries     | Storing a batch: about 2 minutes (database outage). Media download: up to 5 attempts, swept every 5 minutes; then the message is queued without the file.                                  |
| Restart     | Messages that arrived while capture was down are delivered by WhatsApp on reconnect. On start, a sweep finishes interrupted downloads and queues anything never queued.                    |
| Known gap   | WhatsApp acknowledges a message before we store it. If the database is down for more than ~2 minutes while messages arrive, those messages are lost (their IDs are logged at error level). |

**Job: `preprocess`** _(queue created in Phase 1; handler in Phases 2-3)_

|                   |                                                |
| ----------------- | ---------------------------------------------- |
| Payload           | `{ messageId }`                                |
| Retries           | 8, exponential backoff from 30 s               |
| Waiting jobs kept | 60 days, so a long worker outage loses nothing |

_(Phases 2-4)_ assemble context → classify → extract → validate/normalize → dedup/merge → lifecycle → alerts, plus the reprocessing CLI.

## 6. Extraction

**Normalization rules in place now** (`packages/normalize`):

| Rule                                             | Example                                  |
| ------------------------------------------------ | ---------------------------------------- |
| Lowercase, Unicode NFKC                          | `ＳＯＤＩＣ West` → `sodic west`         |
| Arabic-Indic and Persian digits to ASCII         | `٦ أكتوبر` → `6 اكتوبر`                  |
| Remove diacritics (tashkeel) and tatweel         | `التجمّـع` → `التجمع`                    |
| `أ إ آ ٱ` → `ا`                                  | `إعمار` → `اعمار`                        |
| `ى` → `ي`, `ة` → `ه`, `ؤ` → `و`, `ئ` → `ي`       | `العاصمة الإدارية` → `العاصمه الاداريه`  |
| Non-letters and non-digits become a single space | `Il-Monte  Galala!!` → `il monte galala` |

These only erase differences that never change meaning. Riskier matching (typos, dropped "ال") is done by trigram similarity, where it can be tuned and reviewed.

_(Phase 2)_ Prompts and versions, model fallback chain, number and unit parsing, confidence. _(Phase 4)_ Dedup algorithm with worked examples. _(Phase 3)_ Cost per message.

## 7. Interfaces

**API routes (Phase 0)**

| Method | Path      | Response                                                                                                    |
| ------ | --------- | ----------------------------------------------------------------------------------------------------------- |
| GET    | `/health` | `200 {"status":"ok","service":"api","checks":{"database":"ok"}}`, or `503` with the failing check's message |

Capture, worker and chatbot each serve the same `GET /health` on `HEALTH_PORT` (8080 inside Docker; not published to the host). Capture's includes a `whatsapp` check, which fails once the connection has been down for more than 5 minutes (waiting for pairing counts as healthy).

**Groups command (Phase 1, until the admin page in Phase 5)**

```sh
docker compose exec capture node apps/capture/src/cli.ts groups list
docker compose exec capture node apps/capture/src/cli.ts groups watch <id|jid> [...]
docker compose exec capture node apps/capture/src/cli.ts groups unwatch <id|jid> [...]
docker compose exec capture node apps/capture/src/cli.ts groups source <developer|broker|none> <id|jid> [...]
```

`list` shows id, name, watched, source type, membership, last message time and JID. Changes reach a running capture within 30 seconds.

**Web (Phase 0):** a placeholder page at http://localhost:4173.

_(Phase 5)_ Owner admin pages. _(Phase 6)_ Firm dashboard. _(Phase 7)_ Chat bot commands with sample Arabic and English queries.

## 8. Configuration

Every variable, with purpose, whether it is required, its default and an example: **[docs/generated/env.md](docs/generated/env.md)**. `.env.example` is generated from the same source.

How it works:

- Services read variables once at startup through `loadConfig()` (`packages/config`). A missing or invalid value stops the service with a message naming the variable.
- When running on your machine, `pnpm db:migrate`, `pnpm db:seed` and `pnpm dev:*` load the root `.env` automatically (Node's `--env-file-if-exists`).
- Inside Docker Compose, `DATABASE_URL` is built from `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` with host `postgres`; the `DATABASE_URL` in `.env` is for running tools on your own machine (host `localhost`).
- `.env` is never committed (`.gitignore`). Secrets only live in environment variables.

## 9. Setting up from zero

Steps marked _(Phase N)_ are not possible yet.

**1. Prerequisites.** A Linux machine or Mac with:

- Docker Engine with the Compose plugin (`docker compose version` works)
- Git
- For development only: Node.js 24 (`nvm install 24`) and pnpm 12 (`npm install -g pnpm@12.15.0`)

**2. Two dedicated WhatsApp numbers** _(needed from Phase 1)_: one for the scraper, one for the query bot. Never Hassan's personal number.

**3. Clone**

```sh
git clone <repo-url> realestate-bot
cd realestate-bot
```

**4. Create `.env`**

```sh
cp .env.example .env
```

Edit `.env`:

- `POSTGRES_PASSWORD`: a long random value (`openssl rand -hex 24` makes one). Put the same password in `DATABASE_URL`. It is only applied the first time the database volume is created (see runbook "Database password rejected").
- `SENDER_HASH_SALT`: the output of `openssl rand -hex 32`. **Never change it later**: the same sender would get a different hash. Keep a copy with your other secrets.
- `WA_PAIRING_PHONE` (optional): the scraper's own number, digits only (e.g. `201001234567`), if you prefer typing an 8-character code over scanning a QR code.

**5. Start everything**

```sh
docker compose up -d --build
```

This builds one image, starts Postgres, runs the `migrate` step (migrations, then seed), then starts capture, worker, api, chatbot and web. The first build takes a few minutes.

**6. Confirm it works**

```sh
docker compose ps
```

Expected: `postgres`, `capture`, `worker`, `api`, `chatbot`, `web` show `Up ... (healthy)` within about a minute; `migrate` shows `Exited (0)`.

```sh
docker compose logs migrate
# Migrations applied.
# Seed loaded: 17 cities, 20 developers, 57 projects, 360 new aliases.
curl http://localhost:3000/health
# {"status":"ok","service":"api","checks":{"database":"ok"}}
```

To look at the data:

```sh
docker compose exec postgres psql -U reb -d reb -c "select name_en, name_ar from cities"
```

**7. Development setup (optional)**

```sh
pnpm install
pnpm check        # lint, formatting, type check, tests, generated-docs check
```

To include the database integration tests, point them at the running Postgres (the user must be allowed to create databases; the Compose user is):

```sh
TEST_DATABASE_URL=postgres://reb:<password>@localhost:5432/reb pnpm test
```

**8. Pair the scraper number**

The server needs outbound access to `web.whatsapp.com` and `*.whatsapp.net` (normal on a VPS).

```sh
docker compose logs -f capture
```

A QR code is printed (it refreshes about every 20 s). On the scraper phone: WhatsApp → Settings → Linked devices → Link a device → scan. If `WA_PAIRING_PHONE` is set, an 8-character code is logged instead: Link a device → _Link with phone number instead_ → type the code.

Expected log lines: `WhatsApp asked for a restart (normal after pairing)`, then `WhatsApp connected`.

```sh
docker compose exec postgres psql -U reb -d reb -c "select state, last_connected_at from wa_connections"
#  state |      last_connected_at
#  open  | 2026-...
```

The login is saved in the database; restarts don't need pairing again.

**9. Choose groups**

```sh
docker compose exec capture node apps/capture/src/cli.ts groups list
docker compose exec capture node apps/capture/src/cli.ts groups watch 3 7 12
docker compose exec capture node apps/capture/src/cli.ts groups source developer 3 7
docker compose exec capture node apps/capture/src/cli.ts groups source broker 12
```

Within 30 s, new messages from those groups are stored:

```sh
docker compose exec postgres psql -U reb -d reb -c "select id, sent_at, media_type, left(text, 60) from messages order by id desc limit 5"
docker compose exec postgres psql -U reb -d reb -c "select status, count(*) from media_files group by 1"
```

**Later steps:** create the owner account _(Phase 5)_ · pairing and group choice from the browser _(Phase 5)_ · pair the query bot and create the Telegram bot _(Phase 7)_ · confirm a message flows end to end _(Phase 2)_ · create the first firm _(Phase 6)_ · run the first eval _(Phase 2)_.

## 10. Daily operations

**Adding or correcting entities and aliases (until the admin UI in Phase 5):** edit `packages/db/seed/*.ts`, run `pnpm test` to validate, then `pnpm db:seed` (or `docker compose up -d --build`, which re-runs the seed). The seed only adds and updates; it never deletes.

**Checking the system:** `docker compose ps` (all healthy?) and `docker compose logs -f --since 10m <service>`.

**Adding or removing groups to watch:** see chapter 7 (groups command). The scraper number must first be added to the group from a phone. To find a new group's id, run `groups list`: it is listed as soon as the number joins.

**Is capture receiving messages?**

```sh
docker compose exec postgres psql -U reb -d reb -c "select state, last_message_at, last_disconnect_reason from wa_connections"
docker compose exec postgres psql -U reb -d reb -c "select name, last_message_at from wa_groups where watched order by last_message_at desc nulls last"
```

_(Phase 5)_ Review queue, groups, stats. _(Phase 6)_ Onboarding and offboarding firms, exports.

## 11. Runbooks

**A service shows `unhealthy` or keeps restarting**

- Check: `docker compose logs --tail 50 <service>`.
- `ConfigError: Invalid environment configuration` followed by a variable name means a missing or invalid variable. Fix `.env`, then run `docker compose up -d`.
- `database: ...` in the health output means Postgres is unreachable. See the next runbook.

**Postgres is down or restarting**

- Services keep running and report `503` on `/health` while it is down (they log `Idle database connection lost; will reconnect`). They recover by themselves when it is back; nothing needs restarting.
- Check: `docker compose ps postgres` and `docker compose logs postgres`.

**`migrate` exited with an error, so the apps never started**

- Check: `docker compose logs migrate`.
- `Seed data has N problem(s)` followed by a list: fix the listed entries in `packages/db/seed/`, run `pnpm test`, then `docker compose up -d --build`.
- An SQL error from a migration: do not edit the database by hand. Fix the migration in a new commit (or restore from backup in production) and rerun.

**Database password rejected (`password authentication failed for user "reb"`)**

- Cause: `POSTGRES_PASSWORD` was changed after the database volume was first created. Postgres only reads it the first time.
- Fix on a dev machine with no data worth keeping: `docker compose down -v` (deletes the database) and `docker compose up -d`. In production, change the password inside Postgres (`ALTER USER reb PASSWORD '...'`) instead.

**Port already in use (`Bind for 127.0.0.1:5432 failed: port is already allocated`)**

- Another Postgres (or app) is using the port. Stop it, or change the left-hand port in `docker-compose.yml` (for example `127.0.0.1:5433:5432`) and the port in `.env`'s `DATABASE_URL`.

**Upgrading the app and running migrations**

```sh
git pull
docker compose up -d --build   # the migrate step applies new migrations before apps restart
```

**WhatsApp disconnected (`state = reconnecting`, capture unhealthy after 5 min)**

- Check: `docker compose logs --tail 30 capture`. The `error` field says why.
- `getaddrinfo ENOTFOUND web.whatsapp.com` or connection timeouts: the server has no internet or DNS, or a firewall blocks WhatsApp. Fix the network; capture reconnects by itself (backoff up to 60 s).
- Repeated `connectionReplaced (440)` with "Is a second capture running?": two capture containers are using the same login. Stop one (`docker ps`). Never run capture on two machines with the same database.
- Anything else: capture retries forever with backoff. Restarting it (`docker compose restart capture`) is safe and loses nothing that WhatsApp still holds.

**Number logged out or banned (`state = logged_out`, log: "WhatsApp logged this number out")**

- Cause: the device was unlinked from the phone, or WhatsApp banned the number.
- Capture has already cleared the old keys and is printing a new QR code. If the phone still works, pair again (setup step 8).
- If the number is banned: get a new dedicated number, pair it, and add it to the same groups. Group ids stay the same as long as the groups do; re-check `groups list` and re-watch any new group rows.

**Media files stuck in `pending` or many `failed`**

- `select status, count(*), max(error) from media_files group by 1;`
- Pending files are retried every 5 minutes (5 attempts). `failed` usually means the file expired on WhatsApp's servers; the message was still queued with its caption.
- `skipped` files were over `MEDIA_MAX_BYTES`; raise it in `.env` if needed (affects new messages only).

**Disk filling with media**

- `docker system df -v | grep media`, or `du -sh` inside the capture container: `docker compose exec capture du -sh /app/data/media`.
- Identical files are already stored once. Lower `MEDIA_MAX_BYTES` to stop large videos. A retention policy (deleting old media) arrives in Phase 8.

**A watched group stopped showing new messages**

- `groups list`: is it still `watched`, and is `member` still `yes`? If the number was removed from the group, `member` shows `left`; add it back from a phone.

_(Later phases)_ model errors, cost spike, job backlog, failed jobs, restoring a backup, rotating secrets.

## 12. Evaluation _(Phase 2)_

The eval set (`eval/cases`), `pnpm eval`, the report format and the approval rule for prompt or model changes (a drop of more than 2 points on a key field needs Hassan's approval) arrive in Phase 2.

## 13. Testing

```sh
pnpm test                                     # all unit tests (Vitest)
pnpm vitest run packages/normalize            # one package
pnpm vitest --watch                           # re-run on save
TEST_DATABASE_URL=postgres://reb:<pw>@localhost:5432/reb pnpm test   # plus database integration tests
```

| Suite                                                   | Covers                                                                                                                                                                                                                                                                                                       | Needs                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `packages/config/test`                                  | defaults, coercion, readable errors                                                                                                                                                                                                                                                                          | nothing                                                                                         |
| `packages/normalize/test`                               | every normalization rule, Arabic and mixed-script                                                                                                                                                                                                                                                            | nothing                                                                                         |
| `packages/db/test/seed-data.test.ts`                    | seed data has no duplicates, bad references or ambiguous aliases                                                                                                                                                                                                                                             | nothing                                                                                         |
| `packages/db/test/client.test.ts`                       | a lost connection does not crash the process                                                                                                                                                                                                                                                                 | nothing                                                                                         |
| `packages/db/test/migrate-seed.integration.test.ts`     | migrations on a clean database, rerun is a no-op, seed twice adds nothing, alias lookup, trigram lookup, constraints                                                                                                                                                                                         | `TEST_DATABASE_URL`. Creates and drops a throwaway `reb_test_*` database. Skipped when not set. |
| `packages/runtime/test`                                 | health server 200/503/404, log redaction                                                                                                                                                                                                                                                                     | nothing                                                                                         |
| `apps/api/test`                                         | `/health` 200 and 503 (database mocked)                                                                                                                                                                                                                                                                      | nothing                                                                                         |
| `packages/config/test` (Phase 1 part)                   | per-service required variables (`SENDER_HASH_SALT` for capture), salt length, pairing phone format                                                                                                                                                                                                           | nothing                                                                                         |
| `packages/whatsapp/test/parse.test.ts`                  | text, replies, forwarding, images, PDFs with captions, voice notes, disappearing/view-once, edits, deletions, everything ignored, LID-preferred sender hashing                                                                                                                                               | nothing                                                                                         |
| `packages/whatsapp/test/connection.integration.test.ts` | QR and pairing-code flow, open/close states, backoff timings, restart-required, logged-out key wipe, connection replaced, in-order delivery, retry during DB outage, health check; auth store round trip with binary keys                                                                                    | `TEST_DATABASE_URL`; a fake WhatsApp socket                                                     |
| `packages/ingest/test/ingestor.integration.test.ts`     | store + queue once, duplicates after restart, unwatched groups, replies/edits/deletions, media hashed and stored once, download retries and give-up, size limit (announced and actual), crash mid-download recovery, stragglers, and a raw-message-to-database run proving no phone number or name is stored | `TEST_DATABASE_URL`; fake downloads                                                             |

No test calls WhatsApp, Telegram or a paid API. WhatsApp is replaced by a fake socket (connection tests) and hand-built raw messages (parser tests). _(Phase 2)_ LLM fixtures will be recorded responses replayed offline.

CI (`.github/workflows/ci.yml`) runs lint, format check, type check, all tests against a real Postgres service, the generated-docs check and the web build on every push and pull request.

## 14. Deployment _(Phase 8)_

VPS setup, domain and Caddy (HTTPS), daily off-server backups with a tested restore, monitoring and owner alerts. Until then, `docker compose up -d --build` on any Docker host runs the system; ports are bound to `127.0.0.1` only, so nothing is exposed to the internet.

## 15. Security and privacy

**Now:**

- Secrets only in `.env` / environment variables; `.env` is git-ignored. Generated docs mark secret variables.
- Postgres, API and web ports bind to `127.0.0.1` only.
- Containers run as the unprivileged `node` user.
- The logger redacts `phone`, `phoneNumber`, `senderName`, `senderPhone`, `pushName`, `participant`, `password`, `token` and `authorization` fields at the top level and one level deep.

**Phase 1:**

- Sender identity is stored only as `sender_hash` (HMAC-SHA256 with `SENDER_HASH_SALT`). Display names (`pushName`) and phone numbers are never stored; a test feeds a real-shaped message through the capture path and checks that no number, LID or name appears in any row.
- Only watched groups are stored; private chats are never stored.
- Media paths are content hashes; `media_ref` holds only download information.
- `wa_auth` holds the WhatsApp login keys: protect database backups accordingly.
- The scraper never sends messages, and does not mark itself online.

_(Phase 2)_ Names and numbers stripped before anything reaches a model. _(Phase 6)_ Firm isolation with tests on every route, and the audit log. **Law 151 of 2020:** sender names and phone numbers are personal data; Hassan should get legal advice before charging firms (open decision).

## 16. Troubleshooting FAQ

**`error while interpolating services.api.environment.DATABASE_URL: required variable POSTGRES_PASSWORD is missing a value: Set POSTGRES_PASSWORD in .env`**
There is no `.env`, or it has no `POSTGRES_PASSWORD`. Run `cp .env.example .env` and set it.

**`Invalid environment configuration: ✖ Invalid input: expected string, received undefined → at DATABASE_URL`**
The service can't see `DATABASE_URL`. `pnpm db:migrate`, `pnpm db:seed` and `pnpm dev:*` read the `.env` in the repository root automatically, so check it exists and has `DATABASE_URL`. Other commands (such as `pnpm test`) don't read `.env`.

**`pnpm docs` prints `error: the following required arguments were not provided: <PACKAGE>`**
`pnpm docs` is a built-in pnpm command (it opens a package's homepage). Use `pnpm run docs`.

**`TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"`**
Your Node is older than 22.18 and can't run TypeScript directly. Install Node 24 (`nvm install 24`). `pnpm install` also refuses to run on an old Node (`engine-strict`).

**`ERR_PNPM_IGNORED_BUILDS` during `pnpm install`**
A new dependency needs an install script. If you trust it, add it under `allowBuilds` in `pnpm-workspace.yaml`.

**`required variable SENDER_HASH_SALT is missing a value: Set SENDER_HASH_SALT in .env (openssl rand -hex 32)`**
Add `SENDER_HASH_SALT=` with the output of `openssl rand -hex 32` to `.env`.

**`✖ SENDER_HASH_SALT is required for capture`** (running capture outside Docker)
Same fix: set it in the root `.env`.

**Capture logs `⚠️ DANGER: DISABLING ALL SYNC BY shouldSyncHistoryMsg ...`**
Should not happen: the initial history sync must stay on (decision log). If you changed `connection.ts`, restore it.

**`WebSocket Error (getaddrinfo ENOTFOUND web.whatsapp.com)`**
No DNS/internet route to WhatsApp from the server. See runbook "WhatsApp disconnected".

**`toomanyrequests` / `429 Too Many Requests` while pulling images**
Docker Hub's anonymous pull limit. Run `docker login`, or wait and retry.

## 17. Decision log

| Date       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Reason                                                                                                                                                                                                                              | Alternatives considered                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 2026-10-25 | TypeScript **6.0.3**, not 7.0                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | typescript-eslint 8.72 supports TypeScript < 6.1 only. Revisit when it supports 7.                                                                                                                                                  | TS 7 without type-aware lint rules                               |
| 2026-10-25 | Node services run **.ts directly** (Node type stripping); no build step except the web app                                                                                                                                                                                                                                                                                                                                                                                                    | Code that runs is the code you read; no build output to keep in sync. Requires `erasableSyntaxOnly` (no `enum`/`namespace`).                                                                                                        | tsc build to `dist/`; tsup/esbuild bundles; tsx at runtime       |
| 2026-10-25 | **Node 24 LTS** in Docker; Node ≥ 22.18 allowed locally                                                                                                                                                                                                                                                                                                                                                                                                                                       | 24 is the current LTS; 22.18+ also runs TypeScript unflagged                                                                                                                                                                        | Node 22 everywhere                                               |
| 2026-10-25 | **pnpm 12**; the docs script is run as **`pnpm run docs`**                                                                                                                                                                                                                                                                                                                                                                                                                                    | Latest pnpm. Every pnpm version has a built-in `pnpm docs` command that takes precedence over a script of the same name. The script keeps the name `docs` as the plan asks; only the `run` is added. `pnpm docs:check` works as-is. | Renaming the script (e.g. `gen:docs`)                            |
| 2026-10-25 | Added **`packages/runtime`** (logger, health server, service lifecycle)                                                                                                                                                                                                                                                                                                                                                                                                                       | Not in the plan's layout, but four apps need identical startup, logging and health code; apps must not hold logic.                                                                                                                  | Copying the code into each app; putting it in `config`           |
| 2026-10-25 | **First migration holds only the entity tables** (plus pg_trgm); each later table arrives as a migration in the phase that uses it                                                                                                                                                                                                                                                                                                                                                            | The seed needs only entities. Tables like `units` depend on enums still awaiting Hassan's answers (section 14 of the plan); creating them now would mean guessing and migrating again.                                              | Creating the whole data model in Phase 0                         |
| 2026-10-25 | **Aliases use three nullable foreign keys** + CHECK exactly-one, not `entity_type + entity_id`                                                                                                                                                                                                                                                                                                                                                                                                | Postgres enforces that an alias always points at an existing entity, and cascades deletes                                                                                                                                           | Polymorphic type/id pair; one alias table per entity type        |
| 2026-10-25 | **Integer identity IDs** for entity tables                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Small tables whose IDs Hassan will read and type                                                                                                                                                                                    | UUIDs                                                            |
| 2026-10-25 | **node-postgres (`pg`)** as the database driver                                                                                                                                                                                                                                                                                                                                                                                                                                               | pg-boss uses `pg`; one driver for the whole system                                                                                                                                                                                  | postgres.js                                                      |
| 2026-10-25 | **Drizzle 0.45 / drizzle-kit 0.31** (stable)                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Drizzle 1.0 is still in beta                                                                                                                                                                                                        | 1.0 beta                                                         |
| 2026-10-25 | **One Docker image** for all services                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Identical code and dependencies everywhere; one build                                                                                                                                                                               | One image per service                                            |
| 2026-10-25 | Phase 0 **web is served by `vite preview`**                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Enough to prove the build and health check; Caddy (Phase 8) will serve the static files over HTTPS                                                                                                                                  | nginx container (an extra service not in the plan)               |
| 2026-10-25 | Seed areas reviewed by Hassan: **Katameya, Galala City, El Gouna, Ras El Hekma, New Alamein and Sidi Abdel Rahman are their own cities**; Madinaty is both a city and a project; Sarai stays in Mostakbal City; short aliases (Kai, Taj, D5, Noor, MV) are kept. North Coast projects whose exact area is unknown (June, Caesar, Silversands, Seashore, Fouka Bay, D-Bay, Seazen, La Vista Bay, Jefaira, Azha North Coast) stay under North Coast until real messages show where they belong. | Firms want to filter by these areas; exact matching on the whole name keeps short aliases low-risk, and the review queue catches mistakes.                                                                                          | Treating sub-areas as aliases of a larger city                   |
| 2026-10-25 | API reference generation **deferred to Phase 5**                                                                                                                                                                                                                                                                                                                                                                                                                                              | Phase 0 has a single `/health` route; generation will use Fastify route schemas once real routes exist                                                                                                                              | Generating from `/health` only                                   |
| 2026-10-25 | **Baileys 7.0.0-rc14**                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | It is npm's `latest` release and the actively maintained line; 6.x is tagged `legacy`. 7 adds LID support, which current WhatsApp groups need.                                                                                      | Baileys 6.7 (legacy); whatsapp-web.js (needs a headless browser) |
| 2026-10-25 | Added packages **`whatsapp`**, **`ingest`** and **`queue`** (not in the plan's layout)                                                                                                                                                                                                                                                                                                                                                                                                        | Rule 2 keeps logic out of apps. `whatsapp` is reused by the query bot (Phase 7); `ingest` has no WhatsApp code so it is tested on a real database; `queue` is shared by capture and worker.                                         | One `capture-core` package                                       |
| 2026-10-25 | **WhatsApp login keys in Postgres** (`wa_auth`)                                                                                                                                                                                                                                                                                                                                                                                                                                               | Backed up with everything else, survives rebuilds; Baileys' file store is for demos                                                                                                                                                 | Files in a Docker volume                                         |
| 2026-10-25 | **Unwatched groups are not stored at all** (only the group row)                                                                                                                                                                                                                                                                                                                                                                                                                               | Less personal data held; matches the plan's "watched-group filter"                                                                                                                                                                  | Store everything, filter later                                   |
| 2026-10-25 | **Message and job saved in one transaction** (pg-boss `db` option); media messages queued after the file is saved                                                                                                                                                                                                                                                                                                                                                                             | Exactly one job per message, never a job without its file                                                                                                                                                                           | Separate insert and enqueue with a "re-enqueue pending" job      |
| 2026-10-25 | **Edits stored as new message rows** (`edit_of_wa_message_id`); deletions set `deleted_at`                                                                                                                                                                                                                                                                                                                                                                                                    | Brokers edit prices in place; keeping both versions lets Phase 4 treat an edit as a price update                                                                                                                                    | Overwriting the original text                                    |
| 2026-10-25 | **Sender hash = HMAC-SHA256(salt, LID or phone JID)**, preferring the LID                                                                                                                                                                                                                                                                                                                                                                                                                     | Phone numbers are guessable, so a plain hash is reversible; preferring LID gives one hash per person                                                                                                                                | Plain SHA-256; hashing the phone number only                     |
| 2026-10-25 | **Initial history sync stays on**, full history off, history messages not stored                                                                                                                                                                                                                                                                                                                                                                                                              | Baileys needs the initial sync for LID mappings (it warns otherwise); backfilling old messages was not asked for                                                                                                                    | Disabling all sync                                               |
| 2026-10-25 | **Capture downloads media itself** (5 attempts, 50 MB default limit, content-addressed files)                                                                                                                                                                                                                                                                                                                                                                                                 | The worker must never talk to WhatsApp; downloading at once avoids expired links                                                                                                                                                    | Downloading in the worker                                        |
| 2026-10-25 | **Capture health fails only after 5 minutes down**; awaiting pairing is healthy                                                                                                                                                                                                                                                                                                                                                                                                               | Short reconnects are normal; an unpaired fresh install shouldn't look broken                                                                                                                                                        | Unhealthy whenever not connected                                 |
| 2026-10-25 | **Group watch changes apply within 30 s** (cache refresh)                                                                                                                                                                                                                                                                                                                                                                                                                                     | Simple and enough for a manual setting                                                                                                                                                                                              | Postgres LISTEN/NOTIFY                                           |
| 2026-10-25 | pg-boss **manages its own `pgboss` schema**                                                                                                                                                                                                                                                                                                                                                                                                                                                   | pg-boss creates and upgrades its tables to match its version; putting them in our migrations would fight that. Rule 7 still holds for our tables.                                                                                   | Copying pg-boss SQL into Drizzle migrations                      |
