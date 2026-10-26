# @reb/normalize

Everything deterministic between the model's raw phrases and a stored unit: names, numbers, currencies, dates, payment plans, the no-invention check, confidence and review reasons. Pure functions, no I/O, about 130 tests.

| File             | What it does                                                                      |
| ---------------- | --------------------------------------------------------------------------------- |
| `src/text.ts`    | `normalizeName()` for matching names                                              |
| `src/numbers.ts` | `parseAmounts`, `parseRange`, `parseCount`, `parsePercentOrAmount`                |
| `src/fields.ts`  | `detectCurrency`, `parseDelivery`, `parseInstallments`, `parseFloor`              |
| `src/unit.ts`    | `normalizeUnit()`: raw model output → template values, confidence, review reasons |

The full rule list with examples is in PROJECT.md, chapter 6.

## Name normalization

**What it does today.** `normalizeName(text)` turns any spelling of a city, developer or project into a comparison key:

| Rule                                                       | Example                                  |
| ---------------------------------------------------------- | ---------------------------------------- |
| Lowercase, Unicode NFKC (full-width letters become normal) | `ＳＯＤＩＣ` → `sodic`                   |
| Arabic-Indic digits to ASCII                               | `٦ أكتوبر` → `6 اكتوبر`                  |
| Remove Arabic diacritics and tatweel                       | `التجمّـع` → `التجمع`                    |
| Fold alef forms `أ إ آ ٱ` → `ا`                            | `إعمار` → `اعمار`                        |
| Fold `ى` → `ي`, `ة` → `ه`, `ؤ` → `و`, `ئ` → `ي`            | `العاصمة` → `العاصمه`                    |
| Punctuation and repeated spaces become one space           | `Il-Monte  Galala!!` → `il monte galala` |

**Why it is designed this way.** Egyptian posts write the same name many ways. These rules only erase differences that never change meaning. Riskier guesses (dropping "ال", fixing typos like "mivda") are left to Postgres trigram similarity on the `entity_aliases` table, where the threshold can be tuned and the results reviewed. The build plan (rule 4) keeps all of this in code, never in the LLM.
