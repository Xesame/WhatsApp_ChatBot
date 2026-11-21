# Payment plans and name lookup: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gemini's remembered developer and area become one-click suggestions in Review, and every payment plan in a message is stored, editable in Review, shown to firms, searchable and exported.

**Architecture:** New tables by Drizzle migration in `packages/db`; plan shapes in `packages/schema`; parsing in `packages/normalize` (pure); storage, lookup job and current-plan rules in `packages/pipeline`; Review edits in `packages/admin`; firm listing and filters in `packages/search`; the Excel sheet in `packages/schema/src/export.ts`. `apps/` only wire routes, the worker job and UI.

**Tech Stack:** TypeScript on Node 24, Drizzle + drizzle-kit, Postgres 16 (pg_trgm), pg-boss, Fastify + zod, React + React Query (Vite), ExcelJS, Vitest, `pnpm eval`.

**Spec:** `docs/superpowers/specs/2026-11-21-payment-plans-and-name-lookup-design.md` (approved by Hassan, 21 Nov 2026). Builds on branch `learning-stage-a` (`extras.written`, suggestions, re-check, learned prices).

## Global Constraints

- CLAUDE.md binding rules 1–11 apply to every task: listing fields only in `packages/schema` (1); logic in `packages/` with tests (2); no sender names/phones to any model, log or firm response (3); the model never does arithmetic, conversion or scoring (4); firm scoping on firm data (5); idempotent, retry-safe jobs (6); schema only by Drizzle migration (7); checks + eval before each checkpoint (8); commits labelled `phase-5:` (9); no new service or paid API (10); plain-English comments (11).
- Lookup: **Gemini models only** (`gemini:` entries of `LLM_EXTRACT_MODELS`); only project/developer names are sent; answers are never attached without Hassan's click; UI wording `Gemini thinks: <name> (from memory, check)`.
- Lookup cache: one lookup per normalized name; an `unknown` answer is retried after **30 days**; the lookup job calls the model only when the `extract` queue has no waiting or active jobs, otherwise it re-queues itself with a **60 s** delay.
- Plans: the unit's plans are those of the **newest message (by `sent_at`) that stated plans**, even over Hassan's Review corrections; a message without plans leaves them.
- Price-only update on a unit that has plans with amounts → review reason exactly `Price changed; check the payment plans`.
- The unit's down-payment / installment / cash-discount columns come from the **first plan**; the top-level raw fields are used only when the model returned no plans.
- Monthly equivalent = installment amount ÷ (12 ÷ `PAYMENTS_PER_YEAR[frequency]`), computed in code.
- Excel: the 26-column `Primary Units Template` sheet is unchanged; a second sheet named **`Payment plans`**; CSV unchanged.
- Extraction prompt `VERSION` bumped (`extract-2026-11-21.1`); plan accuracy reported separately, not in the deploy-blocking key-field rule.

## How to run checks on this laptop

Same as the learning plan (`docs/superpowers/plans/2026-11-21-learning-from-reviews-stage-a.md`, "How to run checks"): build `reb-check` with Docker, strip CR line endings inside the container (include `-name '*.sql' -o -name '.env.example'`), pass `TEST_DATABASE_URL` from `.env` on network `realestate-bot_default`, never print it. Migrations and generated docs are written back with `MSYS_NO_PATHCONV=1 … -v "$(pwd -W)/<dir>:/app/<dir>"`, then `git checkout --` files that changed only in line endings. Known flaky: `packages/whatsapp/test/connection.integration.test.ts`. Never run `docker compose` against the live bot; the controller deploys.

## Review Focus

1. **Arabic plan phrases and Arabic digits** ("مقدم ١٠٪ والباقي على ٨ سنين ربع سنوي", "القسط الربع سنوي ١٠٤٬٦١٢ ج") parse to 10%, 8 years, quarterly, 104,612. Test in Task 4.
2. **Plans shared by several unit entries**: a price list with three unit types and one set of plans gives each of the three units the same plans. Test in Task 5.
3. **Cash-only plans** (pay in full, discount only) have no installment amount: monthly equivalent is null, the `monthlyInstallmentMax` filter skips them without error, the listing shows "Cash". Tests in Tasks 4 and 8.
4. **USD plans**: amounts in USD are stored with their currency and converted with the existing EGP rate only for the monthly filter; never mixed as EGP. Test in Task 8.
5. **A lookup answer naming an entity that doesn't exist yet** shows `+ New developer named "<answer>"` pre-filled instead of a Use button; an answer matching a known entity (any spelling) shows `Use`. Test in Task 3.

---

## Checkpoint A: names from Gemini's memory

### Task 1: Lookup storage, prompt and queue

**Files:**

- Modify: `packages/db/src/schema/listings.ts` (or a new `packages/db/src/schema/lookups.ts` exported from `index.ts`), `packages/db/src/schema/docs.ts`; generated migration `packages/db/migrations/0010_name_lookups.sql`
- Modify: `packages/schema/src/extraction.ts` (lookup result schema)
- Create: `packages/llm/prompts/lookup.ts`
- Modify: `packages/queue/src/queues.ts` (`lookup` queue)
- Test: `packages/db/test/migrate-seed.integration.test.ts`, `packages/llm/test/` (prompt shape, if a prompt test folder exists; else `packages/schema/test/schema.test.ts`)

**Interfaces:**

- Produces:
  - table `name_lookups`: `id`, `name` (as first written), `name_normalized` (unique), `developer` (text, nullable, as answered), `city` (text, nullable), `known` (boolean), `model`, `prompt_version`, `created_at`, `updated_at`. Drizzle export `nameLookups`.
  - `lookupResultSchema = z.strictObject({ known: z.boolean(), developer: z.string().nullable(), city: z.string().nullable() })`, type `LookupResult`.
  - `packages/llm/prompts/lookup.ts`: `export const VERSION = 'lookup-2026-11-21.1'`, `export const SYSTEM`, `export function userPrompt(input: { project: string; developer: string | null }): string`. The prompt says: Egyptian real estate; answer only from what it knows; `known: false` with nulls if unsure; never invent; names only, no explanation.
  - queue `lookup: z.object({ name: z.string().min(1).max(200), developer: z.string().max(200).nullable() })`, settings `{ retryLimit: 20, retryDelay: 60, retryBackoff: false, retentionSeconds: 30 * 24 * 3600 }`.

- [ ] **Step 1: Failing tests**: migrate-seed `it('adds the name_lookups table')` (columns and the unique index on `name_normalized`); schema test `it('accepts a lookup answer')` (`{known:true, developer:'Dubai Misr', city:'Mostakbal City'}` passes; extra keys fail).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces; generate the migration with `--name name_lookups`; run `pnpm run docs`.
- [ ] **Step 4: Run** them and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `phase-5: storage, prompt and queue for name lookups`.

### Task 2: The lookup job

**Files:**

- Create: `packages/pipeline/src/lookup.ts`; Modify: `packages/pipeline/src/index.ts`, `packages/pipeline/src/steps.ts` (after `applyExtraction`), `packages/pipeline/src/recheck.ts` (after a unit is updated), `apps/worker/src/main.ts` (register `lookup`)
- Test: `packages/pipeline/test/lookup.integration.test.ts`

**Interfaces:**

- Consumes: Task 1 table, schema, prompt, queue; `extras.written` / `extras.unmatched` (learning branch); `LlmClient.callJson`; `parseModelList`.
- Produces:
  - `needsLookup(unit: { projectId: number | null; developerId: number | null; cityId: number | null; extras: unknown }): { name: string; developer: string | null } | null` (pure): returns the first written project name when the developer or city is missing (no `developerId`/`cityId`) and a project name is written; else null.
  - `queueLookups(db: Db, boss: PgBoss, unitIds: number[]): Promise<number>`: for each unit needing a lookup whose `name_normalized` has no row, or has a `known: false` row older than 30 days, sends one `lookup` job (pg-boss `singletonKey` = normalized name, so duplicates collapse).
  - `runLookup(deps: PipelineDeps, job: { name: string; developer: string | null }): Promise<'done' | 'waiting'>`: returns `'waiting'` (and the worker re-queues with `startAfter: 60`) when the `extract` queue has created/retry/active jobs; otherwise calls `callJson` with the Gemini-only model list, upserts `name_lookups`, returns `'done'`. With no Gemini model configured, logs once and returns `'done'` without a row.
  - `lookupFor(db: Db, unit): Promise<LookupResult & { name: string } | null>` used by Task 3.
- [ ] **Step 1: Failing tests** (fake model as in `pipeline.integration.test.ts`):
  - `it('looks up a project with no developer once')`: unit with written project "Lumia Lagoons", no developer → one job; run it → row `{known:true, developer:'Dubai Misr', city:'R8'}`; a second unit with the same name queues nothing.
  - `it('sends only names to the model')`: the recorded request contains "Lumia Lagoons" and no message text or sender hash.
  - `it('uses Gemini models only')`: with `LLM_EXTRACT_MODELS` = groq + gemini, the call list holds only the gemini model; with groq only → no call, no row.
  - `it('waits while messages are being extracted')`: an `extract` job queued → `'waiting'`, no model call.
  - `it('asks again about unknown names after 30 days')`: `known:false` row 31 days old → re-queued; 5 days old → not.
  - `needsLookup` unit tests: project known with developer and city → null; written project, no developer → name.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement**; call `queueLookups` after `applyExtraction` commits (created and merged unit ids) and after `recheckWaitingUnits` updates units.
- [ ] **Step 4: Run** the file and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `phase-5: ask Gemini once per unknown project for its developer and area`.

### Task 3: Suggestions in Review

**Files:**

- Modify: `packages/admin/src/review.ts` (`UnitView.learning.lookup`), `apps/web/src/pages/ReviewLearning.tsx`, `apps/web/src/pages/Review.tsx`, web helper module + its tests
- Test: `packages/admin/test/admin.integration.test.ts`, the web helper test file

**Interfaces:**

- Consumes: `lookupFor` (Task 2); the entities list; the "+ New developer/area" options added on the learning branch.
- Produces: `UnitView.learning.lookup: { developer: string | null; city: string | null } | null`; web helper `lookupOffer(answer: string | null, known: Entity[]): { kind: 'use'; id: number; name: string } | { kind: 'new'; name: string } | null` (matches any spelling with the same trim + lower-case rule as `spellingsToOffer`).
- UI: under Developer and City / area, when the field is empty and the lookup has an answer: `Gemini thinks: <answer> (from memory, check)` with `Use` (known) or `+ New developer named "<answer>"` / `+ New area named "<answer>"` (unknown). The "+ New project" form pre-selects a known looked-up developer/area; for an unknown one its "+ New …" option is pre-filled with the answer instead of the written name when no name was written.
- Clicking `Use` or creating from a lookup answer writes an `audit_log` row `lookup.used` (`target` = the name); saving the unit with a different developer/area than the answer writes `lookup.ignored`, so lookup accuracy can be measured later (spec Part 2).
- [ ] **Step 1: Failing tests**: admin `it('records when a remembered answer is used or ignored')`; admin `it('shows what Gemini remembers for a waiting unit')` (unit view carries the cached answer; none when no row); web `lookupOffer` cases: known by Arabic spelling → use; unknown → new; null → null.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `phase-5: show Gemini's remembered developer and area in Review`.

**Checkpoint A report** (stop, wait for Hassan): deploy, queue lookups for the friend's waiting units (one-off call of `queueLookups` for all waiting units), report how many names got an answer and spot-check five against what Hassan knows; docs updated (PROJECT.md chapters 5, 6, 7, 17; PITCH.md only what is tested).

---

## Checkpoint B: storing payment plans

### Task 4: Plan shapes and parsing

**Files:**

- Modify: `packages/schema/src/extraction.ts` (`rawPaymentPlanSchema`, `payment_plans` on `rawUnitSchema`), `packages/schema/src/unit.ts` (`paymentPlanSchema`), `packages/normalize/src/` (new `plans.ts`, exported), `packages/normalize/src/unit.ts` (columns from the first plan)
- Test: `packages/schema/test/schema.test.ts`, `packages/normalize/test/plans.test.ts`, `packages/normalize/test/unit.test.ts`

**Interfaces:**

- Produces:
  - `rawPaymentPlanSchema = z.strictObject({ label, down_payment, installment_amount, installments, plan_price, cash_discount, notes })`, all `raw(...)` nullable strings with descriptions quoting the spec's examples; `rawUnitSchema.payment_plans: z.array(rawPaymentPlanSchema)` (required, may be empty).
  - `paymentPlanSchema` (`PaymentPlan`): `position` int ≥ 0, `label` string|null, `downPaymentPercent` 0–100|null, `downPaymentAmount` money|null, `installmentAmount` money|null, `installmentFrequency` enum|null, `installmentsCount` int|null, `installmentYears` 0–30|null, `planPrice` money|null, `cash` boolean, `notes` string|null (≤ 300), `currency` 'EGP'|'USD'.
  - `normalizePlans(raw: RawPaymentPlan[], ctx: { sourceText: string; unitCurrency: 'EGP' | 'USD' }): { plans: PaymentPlan[]; reasons: string[] }`: every copied phrase checked with `appearsIn` (dropped with `Dropped <field> "<value>": not found in the message`); `cash` true when there is no installment and (a cash discount or a "cash/كاش" label); currency from the phrase else the unit's.
  - `monthlyEquivalent(plan: PaymentPlan): number | null` (minor units per month; null without amount or frequency).
  - `normalizeUnit` fills `downPayment`, `downPaymentAmount`, `installmentsCount`, `installmentYears`, `installmentFrequency`, `cashDiscount*` from `plans[0]` when `raw.payment_plans` is non-empty, else from the top-level fields as today; returns `paymentPlans: PaymentPlan[]` on the unit.
- [ ] **Step 1: Failing tests**: Veloria fixture (five plans: 0% quarterly 152,000; 10% DP 395,200 quarterly 104,612; 15%/592,800/88,400; 20%/790,400/75,276; 30% plan as written in `samples/7osam-ashraf/chat.txt`) → 5 plans with exact numbers in minor units; Arabic phrase from Review Focus 1; cash-only plan (`cash` true, `monthlyEquivalent` null); a plan phrase not in the message is dropped with the reason; unit columns follow plan 1; no plans → old behaviour (existing tests unchanged).
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement** with the existing parsers (`parsePercentOrAmount`, `parseInstallments`, `parseAmounts`).
- [ ] **Step 4: Run** and `pnpm check` (the pipeline's fake model fixtures gain `payment_plans: []`). Expected: PASS.
- [ ] **Step 5: Commit** `phase-5: payment plan shapes and parsing`.

### Task 5: Storing plans and keeping the newest

**Files:**

- Modify: `packages/db/src/schema/listings.ts`, `docs.ts`; migration `0011_payment_plans.sql`; `packages/pipeline/src/apply.ts` (create, merge, retract, price updates); `packages/pipeline/src/steps.ts`
- Test: `packages/pipeline/test/plans.integration.test.ts`

**Interfaces:**

- Consumes: `PaymentPlan`, `Unit.paymentPlans` (Task 4).
- Produces: table `unit_payment_plans` (`id`, `unit_id` → units ON DELETE CASCADE, `source_message_id` → messages nullable, `source` 'message'|'review', the `PaymentPlan` columns in snake_case, `observed_at`), index on `unit_id`; Drizzle export `unitPaymentPlans`; `currentPlans(db: Db, unitId: number): Promise<PaymentPlan[]>` (rows of the newest source by `observed_at`, ordered by `position`).
  - Applying a message that states plans for a unit writes its rows (`source 'message'`, `observed_at = sent_at`) and deletes rows of older sources for that unit; a message without plans writes nothing.
  - `retract` deletes the message's rows; the current plans then fall back to the newest remaining source automatically (no stored "current" flag).
  - A price update or repost that changes the price, states no plans, and hits a unit whose current plans have an `installmentAmount` or `planPrice` → adds `Price changed; check the payment plans` and `needs_review = true`.
- [ ] **Step 1: Failing tests**: `it('stores every plan of a message')`; `it('the newest message with plans wins')` (older message reprocessed later doesn't replace newer plans); `it('a message without plans keeps them')`; `it('retracting a message brings back the previous plans')`; `it('gives each unit of a price list the shared plans')` (Review Focus 2); `it('asks for a check when only the price changes')`; `it('replaces plans Hassan corrected when a newer post has plans')`.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement**; generate migration `--name payment_plans`; `pnpm run docs`.
- [ ] **Step 4: Run** and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `phase-5: store payment plans; the newest post sets them`.

### Task 6: Gemini instructions and accuracy checks for plans

**Files:**

- Modify: `packages/llm/prompts/extract.ts` (`VERSION = 'extract-2026-11-21.1'`, plan rules), `eval/compare.ts`, `eval/run.ts`, `eval/cases/*/expected.json`, `eval/recordings/*.json`, `packages/admin/src/eval-cases.ts`
- Create: `eval/cases/example-05-payment-plans/` (`message.txt` adapted from the Veloria message with names/contacts made up, `expected.json`), its recording
- Test: `eval/test/`, `packages/admin/test/admin.integration.test.ts`

**Interfaces:**

- Prompt: new rule "payment_plans: one entry per payment plan offered, in the order written, each phrase copied exactly; put a single plan here too; [] if none; plans for the whole message are copied into every unit entry they apply to".
- `scoreCase` gains a plans comparison (paired by position; compares `downPaymentPercent`, `installmentAmount`, `installmentFrequency`, `installmentYears`), reported as its own table, excluded from `KEY_FIELDS` and the 2-point rule.
- `reviewCases`: expected plans only from rows whose `source_message_id` is the case's message, or `source 'review'` rows saved while reviewing that unit.
- [ ] **Step 1: Failing tests**: compare `it('scores plans separately')`; admin `it('takes expected plans only from the case's own message')`.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement**; update the example recordings so `pnpm eval --replay` passes.
- [ ] **Step 4: Run** the tests, `pnpm eval --replay`, and `pnpm check`. Expected: PASS; replay shows the plans table.
- [ ] **Step 5: Commit** `phase-5: Gemini copies every payment plan; accuracy checks score them`.

### Task 7: Plans in Review

**Files:**

- Modify: `packages/schema/src/unit.ts` (`editablePlansSchema`), `packages/admin/src/review.ts`, `apps/api/src/admin-routes.ts`, `apps/web/src/pages/Review.tsx` (+ a `ReviewPlans.tsx`), `apps/web/src/api.ts`; regenerate `docs/generated/api.md`
- Test: `packages/admin/test/admin.integration.test.ts`

**Interfaces:**

- `UnitView.plans: PaymentPlan[]` (current plans); `reviewUnit` input gains `paymentPlans?: PaymentPlan[]` (validated by `editablePlansSchema`, max 12 plans); when given and different, the unit's current plans are replaced by rows with `source 'review'`, `observed_at = now()`, and one `review_corrections` row `{ field: 'paymentPlans', before, after }` is written, in the same transaction.
- UI: a "Payment plans" table (Label, Down payment %, Down payment amount, Installment, How often, Years, Plan price, Cash, Notes) with "+ Add plan" and "Remove"; amounts in whole pounds like the price fields.
- [ ] **Step 1: Failing tests**: `it('corrects a unit's plans')` (rows replaced, correction recorded, `source 'review'`); `it('refuses an impossible plan')` (down payment 150% → 400, nothing saved); `it('leaves plans alone when not sent')`.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `phase-5: see and correct payment plans in Review`.

**Checkpoint B report** (stop, wait): deploy; run the live eval (`pnpm eval` with the Gemini key passed only to that container run) and compare with the last report; re-run the friend's chat (`reprocess --group 2`, ~30 free calls); show Veloria's five plans stored; docs updated.

---

## Checkpoint C: plans for firms

### Task 8: Listing page and search filters

**Files:**

- Modify: `packages/search/src/filters.ts` (`monthlyInstallmentMax`), `packages/search/src/search.ts` (filters over plans), `packages/search/src/listing.ts` (`ListingDetail.paymentPlans`), `apps/web/src/firm/Listing.tsx`, `apps/web/src/firm/Filters.tsx`, `apps/web/src/i18n.tsx`
- Test: `packages/search/test/filters.test.ts`, `packages/search/test/search.integration.test.ts`

**Interfaces:**

- `searchFiltersSchema.monthlyInstallmentMax: z.number().positive().max(100_000_000)` (EGP per month, optional; added to `NUMBER_KEYS`).
- SQL: `downPaymentMax` and `installmentYearsMin` match when **any** current plan matches, else the unit columns when the unit has no plans; `monthlyInstallmentMax` matches when any plan's monthly equivalent (in EGP: USD × the configured rate, as the existing price filters do) is ≤ the value; cash-only plans never match it and never error.
- `ListingDetail.paymentPlans: PaymentPlan[]` (no source or message ids exposed to firms).
- UI (Arabic and English): listing page "Payment plans" / "خطط السداد" section; filter "Monthly payment up to" / "القسط الشهري حتى".
- [ ] **Step 1: Failing tests**: filters `it('accepts monthlyInstallmentMax')`; search `it('matches a unit when any plan fits')` (Veloria-like: 20% plan matches `downPaymentMax: 20`, 0% plan matches `downPaymentMax: 0`); `it('filters by monthly payment')` (quarterly 152,000 → 50,667/month: matches 60,000, not 50,000); `it('skips cash-only plans')`; `it('converts USD plans for the monthly filter')`; `it('shows plans on the listing without sources')`.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `phase-5: firms see and search payment plans`.

### Task 9: Payment plans sheet in the Excel export

**Files:**

- Modify: `packages/schema/src/export.ts`, `packages/pipeline/src/admin.ts` (`exportUnits` passes plans), the firm export route if it builds its own workbook
- Test: `packages/schema/test/` export tests, `packages/pipeline/test/pipeline.integration.test.ts` (export case)

**Interfaces:**

- `writePrimaryUnitsWorkbook(units, ctx, plans?: Map<number /* unit index in units */, PaymentPlan[]>)`: first sheet unchanged; when any plans exist, a second sheet `Payment plans` with headers `Row`, `Unit code`, `Project`, `Unit type`, `Plan`, `Down payment %`, `Down payment amount`, `Installment`, `How often`, `Years`, `Plan price`, `Cash`, `Notes`, `Currency` (`Row` = the unit's row number on the first sheet).
- [ ] **Step 1: Failing tests**: `it('keeps the 26-column sheet unchanged')` (existing header test still exact); `it('adds a Payment plans sheet')` (sheet name, headers, Veloria's five rows pointing at the right row); `it('adds no second sheet without plans')`.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `phase-5: payment plans sheet in the Excel export`.

**Checkpoint C report** (stop, wait): deploy; show a firm listing with plans, a filter search and the exported workbook; docs updated (PROJECT.md, PITCH.md, HANDOFF.md); then the learning work's Overview progress table (learning plan Task 7).
