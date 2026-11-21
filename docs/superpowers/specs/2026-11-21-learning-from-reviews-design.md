# Learning from reviews: design

Date: 21 November 2026. Owner: Hassan. Status: draft for Hassan's approval.

## Why

Hassan's first real test (a broker friend's forwarded chat, 24 messages) gave 105 units, and **all 105 were flagged** for review. About 90% of the flags were project, developer or area names the bot did not know. Today a correction in Review fixes that one unit and teaches the bot nothing: the next "Zomra East" is flagged again, and adding the name in Places & names does not clear units already waiting.

Hassan wants every correction to teach the bot, so that **the share of flagged units falls week after week and the share right the first time rises**, and he wants to see that happening.

## Goals

1. A correction in Review that names the right project, developer or area offers to remember the spelling as written (box ticked by default; Hassan can untick). Decided by Hassan.
2. When a spelling or a new name is added (from Review or Places & names), units still waiting in Review that it now explains are re-checked automatically and, if nothing else is wrong, leave the queue.
3. A weak name match is never attached silently: it becomes a suggestion Hassan confirms once.
4. A price far from what Hassan has approved for that project and unit type is flagged (catches typos like "10,910,00").
5. When a new message looks like one Hassan already corrected, Gemini is shown his corrected answer as a worked example (stage B).
6. Overview shows, week by week: share of new units flagged, share approved without any change ("right first time"), and the latest accuracy score.

## Non-goals

- Training or fine-tuning a model (not possible on the free tier, not needed).
- Auto-trust (stage C: stop flagging a reason Hassan always approves). Only after the Overview numbers show it is safe, as its own decision.
- Merging duplicate units by hand (a known gap, separate work).
- The admin panel redesign (next project, separate design). This work adds only the controls it needs, in the current style.

## Anti-goals (a failure even if it works)

- The bot learning a wrong lesson silently and spreading it (every learned item must trace to a decision Hassan made, and be visible and removable in Places & names).
- Re-checking that undoes Hassan's work: a unit he has edited, approved or rejected is never re-processed by the automatic re-check.
- Learning that costs Gemini calls on the free tier for things code can do (re-checks must not call the model).
- Sender names or phone numbers reaching Gemini through examples (binding rule 3).

## Constraints

- CLAUDE.md binding rules, in particular: logic in `packages/` with tests (2), no sender data to models (3), LLM does no arithmetic or confidence scoring (4), idempotent retry-safe jobs (6), schema changes only by Drizzle migration (7), checks + eval before each checkpoint (8), small labeled commits (9), no new service or paid API (10).
- Free Gemini tier (about 10 requests a minute): stage B may make prompts longer but must not add model calls.
- Postgres with pg_trgm is already available; no new database or search service.

## Approaches considered

|       | What                                                                                                                                                | Trade-off                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **A** | Remember names (with Hassan's OK) + automatic re-check of waiting units + weak matches as suggestions + learned price ranges + progress on Overview | Small and safe; clears most flags; does not fix format mistakes (missing unit types, multi-plan payment terms) |
| **B** | A + Hassan's corrected answers shown to Gemini as examples for similar new messages                                                                 | Fixes recurring format mistakes; slightly longer prompts; needs the eval set to prove each change              |
| **C** | B + auto-trust: stop flagging reasons Hassan always approves                                                                                        | Fastest drop in flags; riskiest (mistakes pass unseen)                                                         |

**Chosen: A, then B.** C only later, per reason, when the Overview numbers justify it. Hassan approved this order on 21 November 2026.

## Stage A: design

### A1. Keep the names as written

Every unit records the developer, project and city names exactly as the message wrote them (`extras.written`, alongside the existing `extras.unmatched`), whether they matched or not. Re-checks and "remember this spelling" read from here.

`extras` is not merged today (it is not in `DESCRIPTIVE_FIELDS`), so a unit seen in several messages would keep only the first message's names. `extras.written` is therefore a list per field (`{ project: ["Zomra East", "زمرة ايست"], ... }`), and a merge adds the incoming names to it without duplicates. _(Claude's call, from the builder check.)_

### A2. Weak matches become suggestions

Measured on the first real chat: wrong fuzzy matches scored 0.43 to 0.52 (Zomra East → ZED East 0.43, Taj Misr → Tatweer Misr 0.47, SODIC East → SODIC West 0.47, Aknan → SODIC 0.52), and real typos score about the same ("mivda" → Mivida 0.44). No threshold separates them, so:

- similarity **≥ 0.70**: attached and flagged, as today (Hyde Park 0.77 and Azha El Sokhna 0.80 were right);
- **0.40 to 0.70**: not attached. The unit keeps the name in `extras.unmatched` plus `extras.suggested` (the closest known entity and its score). The review reason reads `project "Zomra East" is not in the known list (closest: ZED East, 0.43)`.
- below 0.40: unknown, as today.

`0.70` is a named constant with a comment, tuned later with the eval set. A typo then needs one click once (use the suggestion + remember the spelling) and is exact from then on.

### A3. "Remember this spelling" in Review

When Hassan sets or changes the project, developer or city of a unit, and the name as written (A1) is not already a spelling of the entity he chose, Review shows under that field:

> ☑ Remember "Zomra East" as a spelling of Zomra East (project)

ticked by default. On save or approve with the box ticked, the spelling is added to `entity_aliases` with `source: 'review'` and the unit id, in the same transaction as the correction. The suggested entity (A2) is offered as a one-click choice in the field.

`entity_aliases` has no unit column today and `addAlias` always writes `source: 'manual'`: a Drizzle migration adds a nullable `review_unit_id` (references `units`, `ON DELETE SET NULL`), and `addAlias` takes the source and unit id as parameters. _(Claude's call.)_

Review also gets **"+ New project / developer / area named '…'"** next to an unknown name, which creates the entity (asking for the developer and city of a new project) with the written name as its first spelling. Fifteen of the first chat's names were new projects; without this, Hassan would switch to Places & names fifteen times. _(Proposal: Claude's call, Hassan may drop it.)_

Places & names shows each learned spelling's source ("from review of unit 123"), so a wrong one can be found and removed.

### A4. Automatic re-check of waiting units

Adding, removing or merging a spelling or entity queues one re-check job. The job:

1. finds units that are waiting for review (`needs_review`, active or stale), **have no review decision or correction**, and whose written names (A1) mention the changed spelling (normalized written name equal to or containing the alias);
2. for each such unit, **updates the existing row in place**: re-matches its written names, sets `developer_id`, `project_id`, `city_id` and `extras.unmatched`/`extras.suggested` from the result, and replaces only the name-related review reasons (the ones that say "is not in the known list", "matched … by similarity", "does not build", "is not in") with the new ones; every other reason stays as it was. Confidence is recomputed by the same code function as at creation. **No Gemini call, no `applyExtraction`, no merging.**
3. if no reasons remain and confidence ≥ 0.7, the unit leaves the queue.

Why not re-apply the message (builder check): `applyExtraction` deletes and re-inserts single-source units (new ids, breaking Review links, the alias's unit id and `flagged_on_arrival`), keeps old reasons on merged units, and, once a unit gains a project, can merge it into a unit Hassan already reviewed. Updating in place avoids all three. The price check (A5) is re-run for the unit when it gains a project, since its project and unit type now give it a learned range.

A re-checked unit that gains a project is **not** merged into other units of that project, even if it duplicates one; later messages about it dedup normally. Possible duplicates show twice and are handled like today's missed duplicates. _(Claude's call: a wrong automatic merge loses a real unit; a missed one only shows twice.)_

Removing a learned spelling re-checks waiting, untouched units the same way (the name becomes unknown or a suggestion again); units Hassan reviewed keep what he decided.

The job is idempotent and safe to retry (rule 6). Places & names shows "Re-checked N waiting units, M cleared" after a change.

### A5. Price checks learned from approvals

For each project + unit type, the normal price per m² is the median of units Hassan approved (at least 3). A new unit more than 2.5× above or below that median is flagged: `Price per m² 4,132 EGP is far from the usual 41,000 for Dejoya 2 R8 apartments`. With fewer than 3 approvals the current fixed range (3,000 to 1,000,000 EGP/m²) applies. Arithmetic is in code (rule 4). Thresholds are named constants.

What counts _(Claude's calls)_: only units with an `approve` decision in `review_corrections` (never-flagged units are not proof); EGP only (USD units keep the fixed check); price per m² = `min_price ÷ min_area` for both the approved units and the new one. The check runs when a unit is created and when the re-check (A4) gives it a project; it does not run when a new message merges into an existing unit, so a unit Hassan approved is not flagged again by it.

### A6. Progress on Overview

A weekly table/chart for the last 12 weeks:

- **flagged on arrival**: share of new units that needed review when created;
- **right first time**: share of reviewed units approved with no field changed;
- **corrections per reviewed unit**;
  "Right first time" means approved with no field changed; accepting a suggestion (A2) is a change and does not count. _(Claude's call.)_

"Flagged on arrival" needs a new column on `units` set at creation and never changed afterwards (`flagged_on_arrival boolean`), added by Drizzle migration (rule 7); existing units are back-filled as flagged if they have any review correction or are still waiting. Because A4 updates units in place, re-checks never reset it.

The eval accuracy score is **not** on Overview: `pnpm eval` runs on Hassan's laptop and writes its report there, while the console will move to a server in Phase 8. It is reported at each checkpoint instead; putting it on Overview can come with Phase 8. _(Claude's call: no new data path for now.)_

## Stage B: design

### B1. Worked examples from Hassan's corrections

When extracting a message, the bot looks up to **2** earlier messages Hassan reviewed (approved with or without changes; not rejected) that look like it, and adds each to the user prompt as:

```
AN EARLIER MESSAGE AND ITS CORRECT ANSWER (checked by the owner):
<<< message >>>
ANSWER: { ...units as the owner left them, in the extraction output format... }
```

- **Similar** = same group and trigram similarity of the message text ≥ 0.3, or the same project named; best two by similarity. pg_trgm, no new service. The text compared and shown is the composed text the model reads (`composeMessageText`: message text plus the text found in its flyer or PDF).
- The example messages are scrubbed of contact details exactly like the message itself (`scrubPersonalData`); sender names never appear (rule 3).
- **The answer** _(Claude's call, from the builder check)_: the model writes text as it appears in the message, but units store normalized numbers and ids, so the answer is the run's stored raw model answer (`extraction_runs.parsed`) with Hassan's corrections laid over it, and only where that can be done without arithmetic or reformatting:
  - approved with no change: the raw answer as is;
  - corrected fields that are names or fixed choices (project, developer, city, unit type, bedrooms, finishing, category): the corrected value written in, using the name as written in the message when it is a learned spelling, else the canonical English name;
  - a corrected number or payment term (price, area, down payment, installments, delivery): the example is used only if the corrected value appears in the message text (same check as "no invention"), copied as written there; otherwise this message is not used as an example.
    This covers the recurring mistakes seen so far (missing unit types, wrong projects) and skips the rare cases it cannot show faithfully.
- **Never its own example**: the message being extracted, any message whose composed text is ≥ 0.9 similar to it (the same flyer reposted in another group), and, in eval, the source message of every eval case are excluded, so the eval never scores a case against itself.
- Size cap: examples are skipped if they would make the prompt longer than a set character budget (named constant), so the free tier is not slowed.
- The prompt `VERSION` is bumped; `pnpm eval` must show no drop in accuracy on the real cases before it is turned on (rule 8, CLAUDE.md prompt rule).

### B2. Accuracy set grows from reviews

`pnpm eval:from-review` already turns reviews into cases. After each review session, new cases are generated, read and committed, and the eval is run, so "latest accuracy" on Overview (A6) moves with the work. This is a routine, not new code.

## Order of work and checkpoints

1. A1 + A2 (no UI): checkpoint, eval run.
2. A3 + A4 (Review and Places & names): checkpoint with Hassan reviewing the 105 units from the first chat; expected: most clear by adding the ~15 new names.
3. A5 + A6: checkpoint.
4. Stage B after Hassan has reviewed enough messages to make real eval cases (at least 20 reviewed messages).

Each checkpoint: lint, types, tests, generated docs, eval (rule 8); PROJECT.md and PITCH.md updated (claim only what is built and tested); commits labeled `phase-5:` because this extends the owner console's review loop (Claude's call).

## Left to the builder

- Exact names of columns, constants, jobs and functions; where in `packages/` each piece lives (within rule 2).
- How the "remember" box and the "+ New" control look, in the current console style (the redesign comes next).
- Chart or table for A6.
- How the re-check job finds "mentions the changed spelling" (normalized written name equal to or containing the alias is enough).
