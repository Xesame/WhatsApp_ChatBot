# @reb/schema

The single definition of the listing fields (build plan, rule 1). Everything else reads from here: the database constraints, the model's JSON schema, the export, and later the API and UI.

| File                | What it holds                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/enums.ts`      | Every fixed list: categories, unit types, finishing, currencies, installment frequencies, message intents, unit statuses                                                                          |
| `src/extraction.ts` | What the model returns (`rawUnitSchema`): raw phrases as written, never numbers it computed, plus the classification schema. `jsonSchemaFor()` turns them into the JSON Schema sent to the model. |
| `src/unit.ts`       | A unit after normalization (`unitSchema`): the 26 template fields plus internal ones; money in minor units with a currency                                                                        |
| `src/columns.ts`    | The Primary Units template: each header, its database column, its rule, and how it is exported                                                                                                    |
| `src/export.ts`     | Writes the Excel file (exceljs) in the exact template layout                                                                                                                                      |
| `template/`         | Put the original `primary-units-template.xlsx` here; a test then checks the export's header row against it                                                                                        |

**Why it is designed this way**

- **Raw phrases from the model, numbers from code.** The model returns `"يبدأ من 6.5 مليون"`, not `6500000`; `@reb/normalize` does the arithmetic. Parsing bugs can then be fixed and re-run without calling the model again, and the model can't make arithmetic mistakes.
- **Strict schemas.** Every object forbids extra fields and lists every field as required (nullable), which strict structured output on Cerebras and OpenAI requires. A test checks this at every nesting level.
- **Money as integers in minor units** (650000000 = EGP 6,500,000.00) with the currency stored alongside, so no floating-point rounding. EGP is the main currency: the export converts USD prices with the owner-set `USD_EGP_RATE` and says so in Notes.
