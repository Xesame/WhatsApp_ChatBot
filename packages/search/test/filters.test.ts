import { describe, expect, it } from 'vitest';
import { filtersFromQuery, filtersToQuery, isEmptySearch } from '../src/filters.ts';

describe('search filters from a URL query', () => {
  it('reads lists, numbers and yes/no values', () => {
    expect(
      filtersFromQuery({
        unitTypes: 'Apartment,Villa',
        cityIds: '3, 7',
        priceMax: '8000000',
        bedroomsMin: '3',
        readyToMove: 'true',
        sort: 'price_asc',
        page: '2',
      }),
    ).toEqual({
      unitTypes: ['Apartment', 'Villa'],
      cityIds: [3, 7],
      priceMax: 8_000_000,
      bedroomsMin: 3,
      readyToMove: true,
      sort: 'price_asc',
    });
  });

  it('round-trips through the query string', () => {
    const filters = { q: 'ميفيدا', projectIds: [4], areaMin: 120, priceDropped: true };
    expect(
      filtersFromQuery(Object.fromEntries(new URLSearchParams(filtersToQuery(filters)))),
    ).toEqual(filters);
  });

  it('refuses unknown filters, bad values and withdrawn listings', () => {
    expect(() => filtersFromQuery({ firmId: '2' })).toThrow();
    expect(() => filtersFromQuery({ unitTypes: 'Castle' })).toThrow();
    expect(() => filtersFromQuery({ priceMax: 'cheap' })).toThrow();
    expect(() => filtersFromQuery({ statuses: 'withdrawn' })).toThrow();
    expect(() => filtersFromQuery({ downPaymentMax: '150' })).toThrow();
  });

  it('knows when nothing narrows the search', () => {
    expect(isEmptySearch({ sort: 'newest' })).toBe(true);
    expect(isEmptySearch({ unitTypes: [] })).toBe(true);
    expect(isEmptySearch({ bedroomsMin: 2 })).toBe(false);
  });
});
