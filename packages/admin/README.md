# @reb/admin

Everything the owner's admin console does, as plain functions over the database. `apps/api` exposes them as routes (`src/admin-routes.ts`); this package has no HTTP code, so it is tested directly against Postgres.

| Module          | Exports                                                                                    | What it does                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review.ts`     | `reviewQueue`, `unitView`, `reviewUnit`, `editableUnitSchema`                              | Flagged units with their source messages, media and price history (never the sender). Save, approve or reject a unit; each changed field becomes a `review_corrections` row |
| `eval-cases.ts` | `reviewCases`                                                                              | Turns reviewed messages into eval cases (`pnpm eval:from-review`)                                                                                                           |
| `entities.ts`   | `listEntities`, `createEntity`, `renameEntity`, `addAlias`, `removeAlias`, `mergeEntities` | Cities, developers and projects and their spellings. A merge moves units, projects and spellings to the right entity and deletes the duplicate, in one transaction          |
| `stats.ts`      | `stats`, `failedJobs`, `retryJob`                                                          | Messages per day by outcome, model calls, tokens and cost, success and review rates; pg-boss jobs that failed all retries, and retrying them                                |
| `settings.ts`   | `getSetting`, `setSetting`, `usdToEgpRate`                                                 | Owner settings in the `settings` table, each validated by its own Zod schema. Today: `usd_egp_rate`, used by every export before the `USD_EGP_RATE` fallback                |
| `whatsapp.ts`   | `connectionStatus`                                                                         | Each WhatsApp number's state, with the pairing QR code turned into an SVG image while waiting                                                                               |
| `audit.ts`      | `audit`                                                                                    | Writes an `audit_log` row (who, action, target, details, IP). Never pass passwords                                                                                          |

**Design notes**

- **Corrections use the pipeline's own schema.** `editableUnitSchema` is picked from `unitSchema` in `@reb/schema`, so a correction can't store a value the pipeline itself would reject (a 150% down payment, an unknown unit type). Prices are minor units (piastres), like everywhere else.
- **A price correction fixes the latest price-history row** rather than adding one: a misread price is an extraction mistake, not a market change.
- **Approve** sets confidence to 1 and clears the review reasons. **Reject** ("Not a listing") marks the unit `withdrawn`, so it leaves exports and search; its history stays.
- **Eval cases** use the units as the owner left them, in the same comparable form as hand-written cases (English names, whole currency units). Rejected units are left out, so a message with only rejected units becomes a "not relevant" case.

Tests: `test/admin.integration.test.ts` (needs `TEST_DATABASE_URL`).
