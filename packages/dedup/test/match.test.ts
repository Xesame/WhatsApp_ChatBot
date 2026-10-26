import { describe, expect, it } from 'vitest';
import {
  applyObservation,
  DEFAULT_TOLERANCES,
  findMatch,
  isSameUnit,
  pickTargets,
  priceChanged,
  type MatchFields,
  type PriceSnapshot,
} from '../src/index.ts';

const unit = (overrides: Partial<MatchFields> = {}): MatchFields => ({
  projectId: 7,
  developerId: 2,
  unitType: 'Apartment',
  unitCode: null,
  bedrooms: 3,
  minArea: 150,
  maxArea: 150,
  minPrice: 950_000_000,
  maxPrice: 950_000_000,
  priceCurrency: 'EGP',
  ...overrides,
});

describe('isSameUnit: what must agree', () => {
  it('matches an identical listing', () => {
    expect(isSameUnit(unit(), unit())).toBe(true);
  });

  it.each<[string, Partial<MatchFields>]>([
    ['different project', { projectId: 8 }],
    ['different developer', { developerId: 3 }],
    ['different unit type', { unitType: 'Duplex' }],
    ['different bedrooms', { bedrooms: 2 }],
  ])('rejects a %s', (_label, overrides) => {
    expect(isSameUnit(unit(), unit(overrides))).toBe(false);
  });

  it('never matches without a project', () => {
    expect(isSameUnit(unit({ projectId: null }), unit({ projectId: null }))).toBe(false);
  });

  it('allows unknown bedrooms or developer on one side', () => {
    expect(isSameUnit(unit(), unit({ bedrooms: null }))).toBe(true);
    expect(isSameUnit(unit({ developerId: null }), unit())).toBe(true);
  });
});

describe('isSameUnit: area tolerance edges (gap ≤ 5% of the larger area, at least 3 m²)', () => {
  it.each<[string, Partial<MatchFields>, boolean]>([
    ['150 vs 150', { minArea: 150, maxArea: 150 }, true],
    ['150 vs 157 (gap 7 ≤ 7.85)', { minArea: 157, maxArea: 157 }, true],
    ['150 vs 158 (gap 8 > 7.9)', { minArea: 158, maxArea: 158 }, false],
    ['150 vs 165 (10% apart)', { minArea: 165, maxArea: 165 }, false],
    ['150 vs a 120-180 range', { minArea: 120, maxArea: 180 }, true],
    ['150 vs a 160-200 range (gap 10 ≤ 5% of 200)', { minArea: 160, maxArea: 200 }, true],
    ['150 vs a 170-200 range', { minArea: 170, maxArea: 200 }, false],
  ])('%s', (_label, overrides, expected) => {
    expect(isSameUnit(unit(), unit(overrides))).toBe(expected);
  });

  it('uses the 3 m² minimum for small units (studios)', () => {
    const studio = unit({ unitType: 'Studio', bedrooms: null, minArea: 40, maxArea: 40 });
    // 5% of 43 is 2.15 m²; the 3 m² floor lets 43 match 40
    expect(isSameUnit(studio, { ...studio, minArea: 43, maxArea: 43 })).toBe(true);
    expect(isSameUnit(studio, { ...studio, minArea: 44, maxArea: 44 })).toBe(false);
  });

  it('respects custom tolerances', () => {
    const strict = { ...DEFAULT_TOLERANCES, areaFraction: 0, areaMinimumM2: 0 };
    expect(isSameUnit(unit(), unit({ minArea: 151, maxArea: 151 }), strict)).toBe(false);
  });
});

describe('isSameUnit: when area is missing', () => {
  it('matches on price when neither side has an area (10% tolerance)', () => {
    const a = unit({ minArea: null, maxArea: null });
    // 9.5M vs 10M: gap 0.5M ≤ 10% of 10M
    expect(isSameUnit(a, { ...a, minPrice: 1_000_000_000, maxPrice: 1_000_000_000 })).toBe(true);
    expect(isSameUnit(a, { ...a, minPrice: 1_300_000_000, maxPrice: 1_300_000_000 })).toBe(false);
  });

  it('does not match on price across currencies', () => {
    const a = unit({ minArea: null, maxArea: null });
    expect(isSameUnit(a, { ...a, priceCurrency: 'USD' })).toBe(false);
  });

  it('does not match when only one side has an area', () => {
    expect(isSameUnit(unit(), unit({ minArea: null, maxArea: null }))).toBe(false);
  });
});

describe('isSameUnit: unit codes', () => {
  it('matches the same code, ignoring case and spacing', () => {
    expect(
      isSameUnit(unit({ unitCode: 'B12-305' }), unit({ unitCode: 'b12 305', minArea: 300 })),
    ).toBe(true);
  });

  it('never matches different codes, even with identical details', () => {
    expect(isSameUnit(unit({ unitCode: 'B12-305' }), unit({ unitCode: 'B12-306' }))).toBe(false);
  });

  it('never merges a named unit into a unit-type offering', () => {
    expect(isSameUnit(unit(), unit({ unitCode: 'B12-305' }))).toBe(false);
  });
});

describe('findMatch', () => {
  it('picks the candidate with the closest area', () => {
    const far = { ...unit({ minArea: 120, maxArea: 180 }), id: 1 };
    const near = { ...unit({ minArea: 148, maxArea: 152 }), id: 2 };
    expect(findMatch([far, near], unit())?.id).toBe(2);
  });

  it('returns null when nothing matches', () => {
    expect(findMatch([{ ...unit({ unitType: 'Villa' }), id: 1 }], unit())).toBeNull();
  });
});

describe('pickTargets (replies)', () => {
  const quoted = [
    { ...unit({ bedrooms: 2, minArea: 120, maxArea: 120 }), id: 1 },
    { ...unit({ bedrooms: 3, minArea: 165, maxArea: 165 }), id: 2 },
    { ...unit({ unitType: 'Townhouse', bedrooms: null, minArea: 210, maxArea: 210 }), id: 3 },
  ];

  it('uses the only unit of the earlier message', () => {
    const only = quoted.slice(0, 1);
    expect(pickTargets(only, {})).toEqual({ targets: only, ambiguous: false });
  });

  it('narrows by unit type, bedrooms or area', () => {
    expect(pickTargets(quoted, { unitType: 'Townhouse' }).targets.map((u) => u.id)).toEqual([3]);
    expect(
      pickTargets(quoted, { unitType: 'Apartment', bedrooms: 3 }).targets.map((u) => u.id),
    ).toEqual([2]);
    expect(pickTargets(quoted, { minArea: 121, maxArea: 121 }).targets.map((u) => u.id)).toEqual([
      1,
    ]);
  });

  it('is ambiguous when the update does not say which unit', () => {
    expect(pickTargets(quoted, {}).ambiguous).toBe(true);
    expect(pickTargets(quoted, { unitType: 'Apartment' }).ambiguous).toBe(true);
  });
});

describe('price snapshots', () => {
  const current: PriceSnapshot = {
    minPrice: 900_000_000,
    maxPrice: 950_000_000,
    priceCurrency: 'EGP',
    downPayment: 10,
    downPaymentAmount: null,
    installmentsCount: 32,
    installmentYears: 8,
    installmentFrequency: 'quarterly',
    cashDiscount: null,
    cashDiscountType: null,
    cashDiscountCurrency: null,
  };

  it('a new price replaces both ends and keeps the payment plan', () => {
    const next = applyObservation(current, { minPrice: 700_000_000, maxPrice: null });
    expect(next).toMatchObject({
      minPrice: 700_000_000,
      maxPrice: null,
      downPayment: 10,
      installmentsCount: 32,
    });
    expect(priceChanged(current, next)).toBe(true);
  });

  it('an observation stating nothing new is not a change', () => {
    expect(priceChanged(current, applyObservation(current, { downPayment: 10 }))).toBe(false);
    expect(priceChanged(current, applyObservation(current, {}))).toBe(false);
  });

  it('a new payment plan alone is a change', () => {
    const next = applyObservation(current, { installmentsCount: 40, installmentYears: 10 });
    expect(next.minPrice).toBe(900_000_000);
    expect(priceChanged(current, next)).toBe(true);
  });
});
