# Payment plans and name lookup: design

Date: 21 November 2026. Owner: Hassan. Status: draft for Hassan's approval.

## Why

Reviewing his broker friend's chat, Hassan found two things that cost him time and lose value:

1. **Payment plans are mostly lost.** A unit keeps one plan (down payment, years, frequency, cash discount). Veloria offered five plans (0%, 10%, 15%, 20%, 30% down, each with its own quarterly payment, e.g. 152,000 and 104,612); the bot kept only "0% down, quarterly". Installment amounts are never stored. Buyers choose a unit by its plan, so firms need all of them, and need to search by them.
2. **Unknown names take most of the review time.** When a message names a project but not its developer or area (or the names are new), Hassan has to look them up himself before he can add the project.

Hassan asked for both now, before the remaining learning work (the Overview progress table), on 21 November 2026.

## Decisions Hassan made (21 Nov 2026)

- Payment plans: firms can **see and search** them.
- Name lookup: use **Gemini's own memory** (free; no Google Search, which would need a paid Gemini plan). The answer is only a suggestion Hassan confirms in Review.
- Gemini's extraction instructions must be updated for plans.

## Goals

1. Every payment plan a message offers is stored for each unit it applies to, with the values as the message wrote them turned into numbers by code.
2. Firms see the plans on the listing page and in the Excel export, and can filter by them.
3. Hassan sees and corrects plans in Review; his corrections become accuracy test cases like other fields.
4. When a unit's developer or city/area is missing or unknown, the bot asks Gemini once per name what it knows and shows the answer in Review as a one-click suggestion, and pre-fills the "+ New project" form with it.

## Non-goals

- Google Search grounding (declined: paid plan).
- Re-reading every old message automatically for plans (it would use the free Gemini quota; Hassan can re-run a group when he wants).
- Mortgage or bank-finance calculators.

## Anti-goals

- Gemini doing arithmetic (CLAUDE.md rule 4): Gemini copies phrases as written; code turns them into numbers and computes monthly equivalents.
- A remembered "fact" from Gemini entering the data without Hassan's click: lookup answers are never attached to units automatically and are always labelled as Gemini's memory, to be checked.
- Message text or sender data sent with a lookup: only the project/developer name goes (rule 3).
- Breaking the Primary Units Excel template: its 26 columns stay exactly as they are.

## Constraints

- CLAUDE.md binding rules 1–11 (listing fields only in `packages/schema`; logic in packages with tests; no sender data to models; no LLM arithmetic; firm scoping; idempotent jobs; migrations only; checks and eval before each checkpoint; small `phase-*` commits; no new service or paid API; plain-English comments).
- Free Gemini tier (about 10 requests a minute, daily quota already reached once today): lookups must be few (once per name) and must not delay extraction.
- Prompt changes bump the prompt `VERSION` and are compared with `pnpm eval` before deploying.

## Approaches considered

**Plans storage.**

| | What | Trade-off |
|---|---|---|
| **A (chosen)** | A `unit_payment_plans` table, one row per plan | Easy to search ("any plan with ≤ 10% down") and to show; one migration |
| B | A JSON list on the unit | No new table, but searching inside JSON is slower and awkward to keep correct |

**Name lookup.**

| | What | Trade-off |
|---|---|---|
| **A (chosen)** | A separate small Gemini call per unknown name, cached in a table, run as its own low-priority job | Keeps the extraction rule "never fill from general knowledge" intact; each name costs one call, once |
| B | Ask for developer/area inside the extraction prompt | No extra call, but mixes remembered facts into copied data and breaks the no-invention check |

## Part 1: Payment plans

### What the model returns

The extraction output gains `payment_plans`: a list per unit entry, each item copied **as written**:

- `label` (e.g. "Plan 2", "خطة 10%", "Cash"), `down_payment` ("10%", "DP: 395,200 L.E"), `installment_amount` ("Quarterly: 104,612 L.E"), `installments` ("Rest over 10 Years", "على 8 سنين ربع سنوي"), `plan_price` (a total that applies only to this plan, e.g. "Total after discount: 6,968,250"), `cash_discount`, `notes` (e.g. "Equal installments").

Plans that apply to every unit in the message are copied into each unit entry, like other shared details today. The existing single `down_payment` / `installments` / `cash_discount` fields stay (they feed the template columns). The no-invention check applies to every copied phrase.

### What code stores

`unit_payment_plans` (Drizzle migration): `unit_id`, `position` (order in the message), `label`, `down_payment_percent`, `down_payment_amount` (minor units), `installment_amount` (minor units), `installment_frequency` (monthly / quarterly / semi-annual / annual), `installments_count`, `installment_years`, `plan_price` (minor units, null when it is the unit's price), `cash` (boolean, a pay-in-full option), `notes`, `currency`. Parsing reuses the existing parsers in `@reb/normalize` (percent or amount, installments, money).

- **The unit's own columns** (down payment, installments, template columns) keep coming from the **first plan listed**, so the Excel template and today's behaviour stay the same when a message has one plan. *(Claude's call: messages list their headline plan first.)*
- **Reposts and updates** *(Hassan, 21 Nov: "newest post wins", including over his Review corrections)*: the unit's plans are always those of the **newest message (by sent time) that stated plans**; a message without plans leaves them as they are. Each plan row records the message it came from (`source_message_id`, or `null` with `source = 'review'` for plans Hassan typed), so retracting or reprocessing a message recomputes the current plans exactly as price history does today (rule 6), and re-running a group out of date order still ends with the newest message's plans. A newer post replaces plans Hassan corrected.
- **Price-only updates** *(Hassan, 21 Nov)*: when a message changes a unit's price but states no plans, the plans stay visible and the unit goes back to Review with the reason `Price changed; check the payment plans` (only when the unit has plans with amounts).
- **Price history**: the first plan's terms already feed the unit's down-payment and installment columns, which are part of the price snapshot (`PRICE_FIELDS` in `packages/dedup`), so a change to the headline plan writes a price-history row exactly as today; changes to the other plans don't. *(Claude's call: no change to dedup or price history.)*
- **Top-level fields vs plans**: the prompt tells the model to put every plan, including a single one, in `payment_plans`; code fills the unit's columns from the first plan, and falls back to the old top-level `down_payment` / `installments` / `cash_discount` only when the model returned no plans (old recordings, fallback models). *(Claude's call.)*
- **Monthly equivalent** for search: computed in code from amount and frequency (quarterly ÷ 3, semi-annual ÷ 6, annual ÷ 12), never by the model.

### Review

Review shows a **Payment plans** table under the unit's fields: one row per plan with the stored values, editable, with "+ Add plan" and "Remove". Edits are validated by their own plan schema in `packages/schema` (rule 1) and saved in the same transaction as the other corrections; each change is a `review_corrections` row (field `paymentPlans`, before/after as JSON). Saved plans get `source = 'review'`.

**Test cases from reviews**: `eval:from-review` builds the expected plans only from plans whose source is that case's message (or Hassan's own edits made while reviewing it), never from a later repost. Eval gets a plan comparison (plans matched by position; down payment, installment amount, frequency, years compared), reported separately and **not** part of the deploy-blocking key-field rule until at least 20 real reviewed cases exist. The hand-written example cases and their recordings are updated with `payment_plans` so `pnpm eval --replay` keeps working. *(Claude's calls.)*

### Firms

- **Listing page**: a "Payment plans" section (Arabic and English) listing each plan: down payment (percent and amount), installment amount and frequency, years, plan price when different, notes.
- **Search filters** (`packages/search/src/filters.ts`): `downPaymentMax` and `installmentYearsMin` now match **any** of a unit's plans (falling back to the unit columns when it has no plans); new `monthlyInstallmentMax` (EGP per month equivalent, any plan). Saved searches keep working (new filter is optional).
- **Excel export** *(Hassan, 21 Nov: second sheet is fine)*: the 26-column sheet is unchanged; a second sheet **"Payment plans"** lists every plan with the unit's row number, unit code, project and unit type so it can be matched to the first sheet. Same for the owner's export. CSV export is unchanged.

### Accuracy

The extraction prompt `VERSION` is bumped; the four example eval cases get expected plans; a new example case is added from the Veloria message (made-up names and contact details removed per the samples rules); `pnpm eval` is run and compared before deploying.

## Part 2: Name lookup from Gemini's memory

### When it runs

After a unit is created or re-checked, if its project is known or written but its **developer or city/area is missing or not in the lists**, a `lookup` job is queued for that written project name (and the written developer name, if any). Each normalized name is looked up **once**; the answer is cached in a `name_lookups` table (`name_normalized`, `kind`, answer fields, model, prompt version, created_at) and reused for every unit and later message with that name. A name already known (exact alias) is never looked up.

### What is asked

A small separate prompt (`packages/llm/prompts/lookup.ts`, its own `VERSION`): "Egyptian real estate: for the project '<name>' (developer as written: '<developer or none>'), which developer builds it and in which city or area? Answer only if you know; otherwise say unknown." It returns `developer`, `city`, `confidence_words` (as the model states it). Only the names are sent.

- **Gemini only** (`gemini:` models from the extraction list); no Groq or OpenRouter fallback, because the answer is labelled "Gemini thinks" and a weak free model would be cached. If no Gemini model is available, the job waits and retries (idempotent). *(Claude's call.)*
- **Cache**: a known answer is kept; an "unknown" answer is retried after 30 days (new projects become known). *(Claude's call.)*
- **Extraction first**: the lookup job only calls the model when the extract queue is empty, and otherwise re-queues itself with a short delay, since the worker's queues run side by side and share one rate limit. *(Claude's call.)*

### What Hassan sees

In Review, under Developer and City/area, when a lookup answer exists: **"Gemini thinks: Dubai Misr (from memory, check)"** with a **Use** button if the answer matches a known entity, or **"+ New developer named 'Dubai Misr'"** pre-filled if it doesn't. The "+ New project" form's developer and area lists pre-select the looked-up answers when they match known entities. Nothing is attached without his click. Answers he uses or ignores are recorded, so the lookup's accuracy can be measured later.

## Order of work and checkpoints

1. **Name lookup** (smaller, speeds up Hassan's current reviews at once): checkpoint, with lookups run for the friend's chat.
2. **Payment plans**: storage, extraction prompt and eval, Review editing: checkpoint, re-running the friend's chat (costs about 30 free Gemini calls).
3. **Firms**: listing page, search filters, Excel sheet: checkpoint.

Each checkpoint: lint, types, tests, generated docs, eval (rule 8); PROJECT.md and PITCH.md updated (claim only what is built and tested); commits labelled `phase-5:` *(Claude's call: both extend the review and listing data built in phases 5–6)*. Built on top of the learning-from-reviews branch; its Overview progress table (Task 7) comes after.

## Left to the builder

- Exact column, function and job names within the rules above; where pieces live in `packages/`.
- Layout of the plans table in Review and on the listing page, in the current style (the redesign comes later).
- Wording of the lookup prompt, within the rules above.
