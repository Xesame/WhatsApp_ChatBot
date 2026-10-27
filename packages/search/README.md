# @reb/search

Finding listings for firms. One filter shape (`src/filters.ts`) is used by the dashboard, exports and saved searches, and the Phase 7 chat bots will turn questions into the same shape, so a question gets the same answer everywhere.

| Export                                                        | What it does                                                                                                                                                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `searchFiltersSchema`, `filtersFromQuery`, `filtersToQuery`   | The filters, and their form in a URL (`?unitTypes=Apartment,Villa&priceMax=8000000`). Unknown filters and withdrawn listings are refused. No database code, so the web app imports it too (`@reb/search/filters`) |
| `searchListings(db, filters, { usdEgpRate, page, pageSize })` | One page of results and the total                                                                                                                                                                                 |
| `matchingIds(db, filters, { usdEgpRate, limit })`             | Every matching id in order, for exports                                                                                                                                                                           |
| `listingDetail(db, unitId)`                                   | What a firm sees about one listing                                                                                                                                                                                |
| `visibleMedia(db, mediaId)`                                   | A stored file, only if it belongs to a listing firms can see                                                                                                                                                      |

**Rules**

- **Prices are compared in EGP.** USD listings are converted with the owner's rate when the query runs (never stored converted, build plan section 7). Without a rate, a USD listing has no EGP price: it still shows, but not under price filters or price sorting.
- **Ranges overlap.** A listing "120 to 180 m²" matches "at least 150 m²"; a price range matches when any part of it is inside the filter.
- **Price per m²** is the lowest EGP price over the smallest area.
- **Price dropped** means the latest price row is lower than the one before.
- **Text search** matches every spelling in `entity_aliases` (Arabic, English, Franco), normalized the same way as extraction.
- **Firms see:** active listings by default, optionally stale and sold; never withdrawn. Never the sender, never the group name (only whether it was a developer or broker group), and phone numbers and e-mails in message text are blanked.

Tests: `test/filters.test.ts`, `test/search.integration.test.ts` (needs `TEST_DATABASE_URL`).
