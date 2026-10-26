# @reb/dedup

Decides when two listings are the same unit, which unit a reply means, and when a price has changed. Pure functions with no database access, so every rule has a unit test (`test/match.test.ts`). `@reb/pipeline` (`src/apply.ts`) applies the decisions to the database.

| Export                                           | What it does                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `isSameUnit(existing, incoming, tolerances)`     | The matching rules (below)                                                 |
| `findMatch(candidates, incoming)`                | The best matching existing unit, or `null` to create a new one             |
| `pickTargets(quotedUnits, update)`               | For a reply: which of the earlier message's units it means, or "ambiguous" |
| `applyObservation`, `priceChanged`, `snapshotOf` | Price and payment terms after an observation, and whether they changed     |

**Matching rules** (all must hold):

1. Same project. Listings without a known project are never merged.
2. Same developer, when both are known.
3. Same unit type.
4. Unit codes: a named unit only matches the same code, and never matches a unit-type offering.
5. Same bedrooms, when both are known.
6. Areas within tolerance: the gap between the two area ranges is at most `DEDUP_AREA_TOLERANCE_PERCENT` (5%) of the larger area, or `DEDUP_AREA_TOLERANCE_M2` (3 m²), whichever is bigger. If neither has an area, prices must be within `DEDUP_PRICE_TOLERANCE_PERCENT` (10%) instead. If only one has an area, they're treated as different.

**Why it is designed this way:** a wrong merge loses information (two real units become one), while a missed duplicate only shows twice and can be merged from the review queue. So the rules say "different" whenever they're unsure. The tolerances are settings, to be tuned on real data.
