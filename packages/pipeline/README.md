# @reb/pipeline

The processing steps the worker runs for each message, plus reprocessing and export.

| File               | What it does                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `src/steps.ts`     | `preprocess`, `classify`, `extract` jobs; `runClassification` / `runExtraction`, shared with `pnpm eval`          |
| `src/context.ts`   | Builds what the model reads: the message, plus the message it replies to (or the original, for an edit), scrubbed |
| `src/prefilter.ts` | Free keyword check before any model call                                                                          |
| `src/entities.ts`  | Name → canonical city / developer / project (exact, contained, fuzzy)                                             |
| `src/admin.ts`     | `reprocess()` (send messages through again) and `exportUnits()` (Excel)                                           |

**Flow**

```
preprocess ──► classify ──► extract ──► units
   │              │            │
   │ voice note,  │ no listing │ price update / sold:
   │ media (until │ words, or  │ kept in extraction_runs
   │ Phase 3),    │ model says │ for Phase 4
   │ deleted,     │ not        │
   │ empty        │ relevant   │
   ▼              ▼            ▼
 skipped        skipped     processed
```

**Why it is designed this way**

- **Each step is its own job**, so it can fail, wait and be retried on its own. A failed model call marks the message `failed` with the reason and throws, and pg-boss retries it later (6 times, backing off from 1 minute). The next success clears the error.
- **Dedup (Phase 4).** A listing that matches an existing unit (`@reb/dedup` rules) adds a source to it, fills in details it lacked, and adds a price row if the terms changed; otherwise a new unit is created. Price updates and sold notices find their unit through the message they reply to (or, without a reply, through the matching rules). All of it runs under one advisory lock, so simultaneous reposts can't create twins.
- **Idempotent.** Applying a message first undoes everything it did before (`retract`: its sources, price rows, sold mark, and units only it created), then applies it again. Re-running `extract` never duplicates; new `extraction_runs` rows are added.
- **Lifecycle.** A daily job (03:17 Cairo time) marks active units not seen for `STALE_AFTER_DAYS` (45) as `stale`; a repost makes them `active` again.
- **The model reads, code decides.** `runExtraction` gets raw phrases from the model, then matches names (`entities.ts`) and normalizes every field (`@reb/normalize`): numbers, currencies, the no-invention check, confidence and review reasons.
- **Media waits for Phase 3.** Images, PDFs and videos are marked `skipped` with the reason "Media extraction arrives in Phase 3"; `reprocess --status skipped` sends them through again once it exists. Voice notes are not processed (decided with Hassan).
