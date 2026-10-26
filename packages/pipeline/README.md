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
- **Idempotent.** Re-running `extract` for a message replaces the units it produced before and adds new `extraction_runs` rows; nothing is duplicated. (From Phase 4, units are merged across messages instead.)
- **The model reads, code decides.** `runExtraction` gets raw phrases from the model, then matches names (`entities.ts`) and normalizes every field (`@reb/normalize`): numbers, currencies, the no-invention check, confidence and review reasons.
- **Media waits for Phase 3.** Images, PDFs and videos are marked `skipped` with the reason "Media extraction arrives in Phase 3"; `reprocess --status skipped` sends them through again once it exists. Voice notes are not processed (decided with Hassan).
