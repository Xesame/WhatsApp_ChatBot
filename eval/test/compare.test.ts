import { describe, expect, it } from 'vitest';
import { pairUnits, sameValue, scoreCase, sumScores, percent } from '../compare.ts';

describe('eval scoring', () => {
  it('compares numbers with rounding tolerance and strings without case', () => {
    expect(sameValue(9_800_000, 9_800_000.004)).toBe(true);
    expect(sameValue('Mivida', 'mivida')).toBe(true);
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue(120, 121)).toBe(false);
  });

  it('pairs units by similarity, not by order', () => {
    const expected = [
      { unitType: 'Villa', minArea: 300 },
      { unitType: 'Apartment', minArea: 120 },
    ];
    const actual = [
      { unitType: 'Apartment', minArea: 120 },
      { unitType: 'Villa', minArea: 300 },
    ];
    expect(pairUnits(expected, actual).map(([e, a]) => [e.unitType, a?.unitType])).toEqual([
      ['Villa', 'Villa'],
      ['Apartment', 'Apartment'],
    ]);
  });

  it('counts missing units as wrong on every field, and lists mistakes', () => {
    const score = scoreCase(
      {
        intent: 'listing',
        units: [{ unitType: 'Villa', minPrice: 20_000_000 }, { unitType: 'Chalet' }],
      },
      { intent: 'listing', units: [{ unitType: 'Villa', minPrice: 21_000_000 }] },
    );
    expect(score.unitCountCorrect).toBe(false);
    expect(score.fields.unitType).toEqual({ correct: 1, total: 2 });
    expect(score.fields.minPrice).toEqual({ correct: 0, total: 2 });
    expect(score.mistakes).toContain('minPrice: expected 20000000, got 21000000');
    expect(score.mistakes).toContain('unitType: unit missing (expected "Chalet")');
  });

  it('sums tallies across cases and turns them into percentages', () => {
    const a = scoreCase(
      { intent: 'listing', units: [{ city: 'New Cairo' }] },
      { intent: 'listing', units: [{ city: 'New Cairo' }] },
    );
    const b = scoreCase(
      { intent: 'listing', units: [{ city: 'New Cairo' }] },
      { intent: 'listing', units: [{ city: 'Sheikh Zayed' }] },
    );
    const total = sumScores([a, b]);
    expect(total.city).toEqual({ correct: 1, total: 2 });
    expect(percent(total.city ?? { correct: 0, total: 0 })).toBe(50);
  });

  it('assumes "not ready to move" and EGP when expected.json leaves them out', () => {
    const score = scoreCase(
      { intent: 'listing', units: [{ unitType: 'Villa' }] },
      {
        intent: 'listing',
        units: [{ unitType: 'Villa', readyToMove: false, priceCurrency: 'EGP' }],
      },
    );
    expect(score.mistakes).toEqual([]);
  });
});
