# Learning from reviews, stage A: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every review decision teaches the bot names and normal prices, units waiting in Review are re-checked when a name is learned, and Overview shows the flagged share falling week by week.

**Architecture:** Matching and checks stay in `packages/` (normalize: pure rules; pipeline: database lookups and the re-check; admin: review and names; db: one migration). `apps/api` only wires routes; `apps/web` adds controls to Review, Places & names and Overview in the current style. No model calls are added.

**Tech Stack:** TypeScript on Node 24 (run directly), Drizzle ORM + drizzle-kit migrations, Postgres 16 with pg_trgm, pg-boss, Fastify + zod, React (Vite), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-learning-from-reviews-design.md` (approved by Hassan, 21 Nov 2026). Stage B gets its own plan later.

## Global Constraints

- CLAUDE.md binding rules 1–11 apply to every task; especially: logic in `packages/` with tests (2), no sender names or phone numbers to any model, log or response (3), no LLM arithmetic or confidence scoring (4), idempotent retry-safe jobs (6), schema only by Drizzle migration (7), small commits labeled `phase-5:` (9), no new service or paid API (10), plain-English comments for non-obvious decisions (11).
- Attach threshold: fuzzy similarity **≥ 0.70** attaches (flagged); **0.40 to < 0.70** becomes a suggestion, not attached; below 0.40 unknown.
- Price range: median price per m² of **≥ 3** approved EGP units of the same project + unit type; flag when more than **2.5×** above or below; otherwise the fixed range 3,000 to 1,000,000 EGP/m².
- Re-check never calls a model, never uses `applyExtraction`, never merges, and never touches a unit with any `review_corrections` row.
- Overview covers the last **12** weeks.
- All new thresholds are named constants with a one-line reason.
- Hassan is not a programmer: UI text is plain English, no jargon.

## How to run checks on this laptop

The laptop has no Node 24 or pnpm, so checks run in Docker, and Git on Windows stored files with CRLF line endings (strip them inside the container only). From the repository root, in Git Bash:

```bash
D="/c/Program Files/Docker/Docker/resources/bin/docker.exe"
PW=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2 | tr -d '\r')
"$D" build -q --target build -t reb-check .
"$D" run --rm --network realestate-bot_default \
  -e TEST_DATABASE_URL="postgres://reb:$PW@postgres:5432/reb" reb-check sh -c \
  "find . -type f -not -path '*/node_modules/*' \( -name '*.ts' -o -name '*.tsx' -o -name '*.json' -o -name '*.md' -o -name '*.yml' -o -name '*.yaml' -o -name '*.css' -o -name '*.html' -o -name '*.js' -o -name '*.mjs' -o -name '*.sql' -o -name '.env.example' \) -exec sed -i 's/\r\$//' {} + && <COMMAND>"
```

`<COMMAND>` is `pnpm check` for everything, or `pnpm vitest run <path>` for one test file. Integration tests (`*.integration.test.ts`) create and drop their own `reb_test_*` databases on the running Postgres. Never print `$PW`.

Generating a migration writes files back to the host:

```bash
"$D" run --rm -v "$PWD/packages/db/migrations:/app/packages/db/migrations" reb-check sh -c "<same CRLF strip> && pnpm --filter @reb/db generate --name <name>"
```

Deploy after a checkpoint: `"$D" compose up -d --build` (migrations run in the `migrate` service).

## Review Focus

1. **Arabic and mixed spellings:** remembering "زمرة ايست" or "Zomra East," must match later messages written either way (normalized), and must not create a duplicate alias. Test in Task 4.
2. **A unit Hassan already touched:** any unit with a correction, approval or rejection must come out of every re-check byte-for-byte unchanged, even when its names now match. Test in Task 5.
3. **Spelling already known:** ticking "remember" for a spelling the chosen entity already has must not error or duplicate. Test in Task 4.
4. **Removing a learned spelling:** waiting untouched units that matched through it become unknown or a suggestion again; reviewed units keep their project. Test in Task 5.
5. **Units without a usable price per m²:** USD units, units with no area or no price, and studios with no area must skip the learned price check without errors. Test in Task 6.

---

## Checkpoint 1: names as written, weak matches as suggestions (A1, A2)

### Task 1: Name rules in `@reb/normalize`

**Files:**

- Modify: `packages/normalize/src/unit.ts` (context types, step 7 "Entities", step 9 "Confidence", `extras`)
- Test: `packages/normalize/test/unit.test.ts`

**Interfaces:**

- Produces (exported from `@reb/normalize`):
  - `interface Suggestion { id: number; name: string; similarity: number }`
  - `NormalizeContext` gains `suggestions: { developer: Suggestion | null; project: Suggestion | null; city: Suggestion | null }`
  - `interface WrittenNames { developer: string[]; project: string[]; city: string[] }`
  - `function entityOutcome(written: { developer: string | null; project: string | null; city: string | null }, ctx: Pick<NormalizeContext, 'developer' | 'project' | 'city' | 'suggestions'>): { developerId: number | null; projectId: number | null; cityId: number | null; reasons: string[]; unmatched: Record<string, string>; suggested: Record<string, Suggestion> }` (step 7 moved here unchanged except for the suggestion text)
  - `function isNameReason(reason: string): boolean` (true for the four name-reason shapes listed in spec A4)
  - `function scoreConfidence(parts: { projectSimilarity: number; developerPart: number; hasUnitType: boolean; priceFactor: number; hasArea: boolean }): number` (step 9's formula, rounded to 2 decimals)
  - `normalizeUnit` writes `extras.written` (a `WrittenNames` with this unit's names, empty arrays where none) and `extras.suggested` when non-empty, keeps `extras.unmatched`.

- [ ] **Step 1: Write the failing tests** in `unit.test.ts`, `describe('names')`:
  - `it('suggests instead of attaching a weak match')`: context `project: null`, `suggestions.project: { id: 7, name: 'ZED East', similarity: 0.43 }`, raw project "Zomra East" → `projectId` null, `extras.unmatched.project === 'Zomra East'`, `extras.suggested.project.id === 7`, reasons contain exactly `project "Zomra East" is not in the known list (closest: ZED East, 0.43)`.
  - `it('records names as written')`: raw developer "Taj misr", project "Dejoya 2 R8", city null → `extras.written` equals `{ developer: ['Taj misr'], project: ['Dejoya 2 R8'], city: [] }`.
  - `it('recognises name reasons')`: `isNameReason` true for `project "X" is not in the known list`, `project "X" matched "Y" by similarity (0.77)`, `Developer "A" does not build "B"; used the project's developer`, `Project "B" is not in "C"; used the project's city`; false for `No area` and `Price per m² (4132 EGP) looks wrong`.
  - `it('scores confidence like before')`: an existing full-match test case gives the same `confidence` as before the change (keep the current expected value).
- [ ] **Step 2: Run** `pnpm vitest run packages/normalize/test/unit.test.ts`. Expected: the new tests FAIL (missing exports / `extras.written` undefined).
- [ ] **Step 3: Implement** the interfaces above in `unit.ts`; `normalizeUnit` calls `entityOutcome` and `scoreConfidence`. A suggestion only adds the "(closest: …)" text; it never sets an id.
- [ ] **Step 4: Run** the same command. Expected: PASS, all old tests in the file still pass.
- [ ] **Step 5: Commit** `phase-5: record names as written and suggest weak matches (normalize)`.

### Task 2: Matching returns suggestions, merges keep every spelling (`@reb/pipeline`)

**Files:**

- Modify: `packages/pipeline/src/entities.ts` (`findAlias`, `matchEntities`, new constant)
- Modify: `packages/pipeline/src/steps.ts:156-158` (pass suggestions into `normalizeUnit`)
- Modify: `packages/pipeline/src/apply.ts` (`merge`: union `extras.written`)
- Test: `packages/pipeline/test/pipeline.integration.test.ts`, `packages/pipeline/test/dedup.integration.test.ts`

**Interfaces:**

- Consumes: `Suggestion`, `WrittenNames`, `NormalizeContext.suggestions` (Task 1).
- Produces: `export const ATTACH_THRESHOLD = 0.7` (comment: measured wrong matches 0.43–0.52, right ones 0.77–0.80, typos ~0.44 so typos become suggestions confirmed once); `matchEntities(db, names)` returns `EntityMatches & { suggestions: { developer: Suggestion | null; project: Suggestion | null; city: Suggestion | null } }`. Hits with similarity 1 or ≥ `ATTACH_THRESHOLD` are matches; hits ≥ `FUZZY_THRESHOLD` and < `ATTACH_THRESHOLD` are suggestions.

- [ ] **Step 1: Write the failing tests:**
  - pipeline: `it('turns a weak project match into a suggestion')`: seed data, raw project "Zomra East" through `extract` with the fake model → unit `projectId` null, `extras.suggested.project.name === 'ZED East'`, `needsReview` true.
  - pipeline: `it('still attaches a close match')`: raw project "Hyde Park" → unit project is Mountain View Hyde Park, reason contains `by similarity`.
  - dedup: `it('keeps every spelling when a repost merges')`: two messages, same unit, project written "Mivida" then "ميفيدا" → one unit, `extras.written.project` contains both, no duplicates after reprocessing the second message.
- [ ] **Step 2: Run** both files (integration, needs `TEST_DATABASE_URL`). Expected: the three tests FAIL.
- [ ] **Step 3: Implement** the interfaces. In `merge`, the update sets `extras` to the existing extras with each `written` list unioned with the incoming one (order kept, exact duplicates removed); other `extras` keys keep the existing unit's values.
- [ ] **Step 4: Run** both files. Expected: PASS, and the full `pnpm check` passes.
- [ ] **Step 5: Commit** `phase-5: weak name matches become suggestions; merges keep all spellings`.

**Checkpoint 1 report to Hassan** (stop, wait for his go-ahead): what changed, the full check results, and a re-run of the friend's chat counts (`reprocess` the 24 messages of group "7osam Ashraf (forwarded)" through the worker CLI if one exists, else note it is shown at checkpoint 2). Push to `main` after his go-ahead.

---

## Checkpoint 2: remember spellings, re-check waiting units, prices learned from approvals (A3, A4, A5)

### Task 3: Migration: alias source unit and `flagged_on_arrival`

**Files:**

- Modify: `packages/db/src/schema/entities.ts` (`entityAliases.reviewUnitId: integer('review_unit_id')`, nullable, no foreign key: units live in `listings.ts`, and a reference would make the two schema files import each other; comment says so)
- Modify: `packages/db/src/schema/listings.ts` (`units.flaggedOnArrival: boolean('flagged_on_arrival').notNull().default(false)`)
- Modify: `packages/db/src/schema/docs.ts` (describe both columns in plain English)
- Create: `packages/db/migrations/0009_learning.sql` (generated, then append the back-fill)
- Modify: `packages/pipeline/src/apply.ts` (`create` sets `flaggedOnArrival: unit.needsReview === true`)
- Test: `packages/db/test/migrate-seed.integration.test.ts`, `packages/pipeline/test/pipeline.integration.test.ts`

**Interfaces:**

- Produces: columns `entity_aliases.review_unit_id integer null`, `units.flagged_on_arrival boolean not null default false`.

- [ ] **Step 1: Write the failing tests:**
  - migrate-seed: `it('adds the learning columns')`: after migrations, `information_schema.columns` lists both columns with the stated types and nullability.
  - pipeline: `it('remembers that a unit arrived flagged')`: a unit created with a review reason has `flaggedOnArrival` true; a clean one false; reprocessing a message does not reset it on a merged unit.
- [ ] **Step 2: Run** both. Expected: FAIL.
- [ ] **Step 3: Implement**: schema changes, `pnpm --filter @reb/db generate --name learning`, then append to the generated SQL: `UPDATE units SET flagged_on_arrival = true WHERE needs_review OR id IN (SELECT unit_id FROM review_corrections);`
- [ ] **Step 4: Run** both, then `pnpm run docs` (generated database reference) and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `phase-5: migration for learned spellings and flagged-on-arrival`.

### Task 4: Remember a spelling from Review

**Files:**

- Modify: `packages/admin/src/entities.ts` (`addAlias` options)
- Modify: `packages/admin/src/review.ts` (`reviewUnit` input `remember`, `unitView` exposes written names and suggestions)
- Modify: `apps/api/src/admin-routes.ts:223-245` (body schema `remember`), `:327-341` (unchanged call)
- Modify: `apps/web/src/api.ts`, `apps/web/src/pages/Review.tsx`, `apps/web/src/pages/Entities.tsx` (each spelling shows its source: `from review of unit 123`, linking to that unit's review page, for `source = 'review'`)
- Test: `packages/admin/test/admin.integration.test.ts`

**Interfaces:**

- Produces:
  - entity detail (`packages/admin/src/entities.ts`): each alias also returns `reviewUnitId: number | null`.
  - `addAlias(db, kind, entityId, alias, options?: { source?: 'manual' | 'review'; reviewUnitId?: number }): Promise<boolean>` (default `source: 'manual'`)
  - `reviewUnit(database, unitId, input: { action; changes?; remember?: { kind: EntityKind; alias: string }[] }, reviewerId)`; each `remember` entry is added with `source: 'review'`, `reviewUnitId: unitId`, to the entity the unit has after the changes, inside the same transaction; an entry whose kind has no entity on the unit is ignored.
  - `UnitView.learning: { written: WrittenNames; suggested: Record<string, Suggestion> }` (read from `units.extras`, empty when absent).
  - Review page: under Project, Developer and City, when the field differs from what was loaded and the unit has a written name for it that is not equal (normalized, client-side lower-case + trim is enough for display) to the chosen entity's name, show a checkbox **ticked by default**: `Remember "<written>" as a spelling of <chosen name>`. A suggestion shows as a button `Use <name>` that sets the field. Next to an unknown name: `+ New project named "<written>"` (or developer / area) opens the existing create form from Places & names, prefilled with the written name in both name boxes, and on save sets the field to the new entity.

- [ ] **Step 1: Write the failing tests** (admin integration):
  - `it('remembers a spelling when asked')`: unit with written project "Zomra East", approve with `changes.projectId` = a project "Zomra East Residence" and `remember: [{ kind: 'project', alias: 'Zomra East' }]` → alias row exists with `source = 'review'`, `review_unit_id` = the unit id.
  - `it('does not duplicate a known spelling')`: same remember twice, and once for an alias the project already has → no error, one row.
  - `it('matches Arabic spellings either way')`: remember "زمرة ايست"; `matchEntities` for "زمره ايست" (ta marbuta → ha) returns that project with similarity 1.
  - `it('learns nothing when the box is unticked')`: approve without `remember` → no alias added.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces (backend first, then the API schema `remember: z.array(z.object({ kind, alias: name })).optional()`, then the page).
- [ ] **Step 4: Run** the file and `pnpm check`. Then in the running console (after `compose up -d --build`), open Review on a unit from the friend's chat and confirm the checkbox, `Use …` and `+ New …` appear. Expected: tests PASS; controls visible.
- [ ] **Step 5: Commit** `phase-5: remember spellings from Review`.

### Task 5: Re-check waiting units in place

**Files:**

- Create: `packages/pipeline/src/recheck.ts`
- Modify: `packages/pipeline/src/index.ts` (export)
- Modify: `apps/api/src/admin-routes.ts` (call after review with `remember`, alias add/remove, entity create/merge; include the counts in the response)
- Modify: `apps/web/src/pages/Entities.tsx` (show `Re-checked N waiting units, M cleared`), `apps/web/src/pages/Review.tsx` (refresh the queue after save)
- Test: `packages/pipeline/test/recheck.integration.test.ts`

**Interfaces:**

- Consumes: `matchEntities` (Task 2), `entityOutcome`, `isNameReason`, `scoreConfidence` (Task 1).
- Produces: `recheckWaitingUnits(database: Database): Promise<{ checked: number; cleared: number }>`.
  - Selects units with `needs_review`, status active or stale, `extras.written` present, and no `review_corrections` row.
  - For each: tries every written name per field with `matchEntities` and keeps the best match (or best suggestion), then runs `entityOutcome` with the first written name of each field; new reasons = old reasons without `isNameReason` ones + the new name reasons; confidence = `scoreConfidence` with `hasUnitType = unitType !== null`, `hasArea = minArea !== null`, `priceFactor` = 0 without a price, 0.6 if the old reasons contain the million/thousand-assumed reason from `normalizeUnit` (find its exact text at `packages/normalize/src/unit.ts:96`), else 1; `needsReview = reasons.length > 0 || confidence < 0.7`. Updates ids, `extras.unmatched`, `extras.suggested`, reasons, confidence, `needs_review` in one transaction per unit with `SELECT … FOR UPDATE` and a re-check of "no review_corrections" inside it.
  - Running it twice in a row changes nothing the second time (idempotent).
  - Synchronous in the API request, not a queue job, so Hassan sees the counts at once. _(Plan call: a spec deviation from "queues one re-check job"; there are at most a few hundred waiting units and no model calls, so it takes well under a second. Report it at the checkpoint.)_

- [ ] **Step 1: Write the failing tests** (`recheck.integration.test.ts`):
  - `it('clears a unit once its project is learned')`: unit waiting only for `project "Jamila" is not in the known list`; add project Jamila; `recheckWaitingUnits` → `{ checked: 1, cleared: 1 }`, unit has the project and `needsReview` false, same unit id.
  - `it('keeps other reasons')`: unit with that reason plus `No area` → project set, reasons `['No area']`, still waiting.
  - `it('never touches a unit Hassan reviewed')`: unit with an `edit` correction and the same unknown name → row identical before and after (compare the whole row).
  - `it('does not merge into an existing unit')`: an approved unit of project Jamila with the same type and area exists → after re-check both units exist.
  - `it('reverts when a learned spelling is removed')`: learn "Zomra East" via alias, re-check (attached), remove alias, re-check → unknown again with the suggestion; a reviewed unit with that project keeps it.
  - `it('is idempotent')`: second run returns `cleared: 0` and changes no row.
- [ ] **Step 2: Run** the file. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `recheck.ts` and the route calls (after the change commits; response gains `recheck: { checked, cleared }`).
- [ ] **Step 4: Run** the file and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `phase-5: re-check waiting units when a name is learned`.

### Task 6: Prices learned from approvals

**Files:**

- Create: `packages/pipeline/src/price-range.ts`
- Modify: `packages/normalize/src/unit.ts` (step 8 uses `ctx.usualPricePerM2`)
- Modify: `packages/pipeline/src/steps.ts` (`runExtraction`: look up after matching), `packages/pipeline/src/recheck.ts` (when a unit gains a project)
- Test: `packages/normalize/test/unit.test.ts`, `packages/pipeline/test/price-range.integration.test.ts`

**Interfaces:**

- Produces:
  - normalize: `NormalizeContext.usualPricePerM2?: { median: number; projectName: string; unitType: string } | null`; `export const PRICE_RANGE_FACTOR = 2.5`; `function priceReason(perMetre: number, usual: NormalizeContext['usualPricePerM2']): string | null` (learned range when given, else the fixed 3,000–1,000,000 check, same reason text as today).
  - Learned reason text: `Price per m² 4,132 EGP is far from the usual 41,000 for Dejoya 2 R8 apartments` (numbers rounded, thousands separators, unit type plural lower-case).
  - pipeline: `export const MIN_APPROVED_FOR_RANGE = 3`; `usualPricePerM2(db: Db, projectId: number, unitType: string): Promise<{ median: number; count: number } | null>`: median of `min_price / 100 / min_area` over units of that project and type, EGP, both values present, with an `approve` row in `review_corrections`; null below 3.

- [ ] **Step 1: Write the failing tests:**
  - normalize: `it('flags a price far from the usual one')`: 10,910,00 written price read as 1,091,000 for 264 m² with usual median 41,000 → reason above (with 4,133 / 41,000 as computed). `it('accepts a price within 2.5x')`: 30,000/m² vs 41,000 → no price reason. `it('skips the check without area or in USD')`: no area → no price-per-m² reason; USD → only the existing USD reason.
  - price-range: `it('needs three approved units')`: 2 approved → null; 3 approved (40,000, 41,000, 45,000/m²) → median 41,000; an unapproved unit at 5,000/m² is ignored.
- [ ] **Step 2: Run** both. Expected: FAIL.
- [ ] **Step 3: Implement**; in `runExtraction`, call `usualPricePerM2` only when the project matched and the unit type is known; build the context's `projectName`/`unitType`. In `recheck.ts`, when a unit gains a project, apply `priceReason` with the same lookup and add or remove the price reason accordingly.
- [ ] **Step 4: Run** both and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `phase-5: price checks learned from approved units`.

**Checkpoint 2 report to Hassan** (stop, wait): deploy (`compose up -d --build`), then ask him to add the new projects from the friend's chat via Review's `+ New …` and report how many of the 105 units cleared by themselves. Update `PROJECT.md` (review, names, matching chapters, decision log: 0.70 threshold, re-check in place and synchronous, price range rule) and `PITCH.md` (only what is built and tested). Push after his go-ahead.

---

## Checkpoint 3: progress on Overview (A6)

### Task 7: Weekly learning numbers

**Files:**

- Modify: `packages/admin/src/stats.ts`
- Modify: `apps/api/src/admin-routes.ts:378-386` (response includes `weeks`), `apps/web/src/api.ts`, `apps/web/src/pages/Overview.tsx`
- Test: `packages/admin/test/admin.integration.test.ts`

**Interfaces:**

- Produces: `Stats.weeks: { week: string /* ISO week start, YYYY-MM-DD, Monday, Cairo time */; newUnits: number; flaggedOnArrival: number; reviewed: number; rightFirstTime: number; correctionsPerReviewed: number | null }[]`, last 12 weeks, oldest first, weeks with no data included as zeros.
  - `newUnits`/`flaggedOnArrival`: units by `created_at` week.
  - `reviewed`: units whose first `approve` row falls in the week; `rightFirstTime`: those with no `edit` row at all; `correctionsPerReviewed`: `edit` rows of those units ÷ `reviewed` (null when 0).
  - Overview: a table titled **Is the bot learning?** with columns Week, New listings, Flagged on arrival (%), Reviewed, Right first time (%), Fixes per listing; a one-line explanation under it.

- [ ] **Step 1: Write the failing test** `it('reports learning per week')`: 3 units this week (2 flagged on arrival), approve one without edits and one with 2 edits → current week row `{ newUnits: 3, flaggedOnArrival: 2, reviewed: 2, rightFirstTime: 1, correctionsPerReviewed: 1 }`, 12 rows total.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** with `date_trunc('week', created_at AT TIME ZONE 'Africa/Cairo')` and a generated series of the 12 weeks.
- [ ] **Step 4: Run** it and `pnpm check`; open Overview in the running console. Expected: PASS; the table shows this week's numbers.
- [ ] **Step 5: Commit** `phase-5: weekly learning numbers on Overview`.

**Checkpoint 3 report to Hassan** (stop, wait): the table, the full check, the eval run (`pnpm eval` in the container with `GEMINI_API_KEY` passed through `--env-file .env` only for that run, results summarized without printing the key), `PROJECT.md`/`PITCH.md` updated, `docs/HANDOFF.md` "Build status" and "What's next" updated. Push after his go-ahead. Then stage B gets its plan once at least 20 messages are reviewed; the admin panel redesign is next.
