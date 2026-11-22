import { describe, expect, it } from 'vitest';
import {
  KEY_FIELDS,
  pairUnits,
  PLAN_FIELDS,
  sameValue,
  scoreCase,
  sumScores,
  percent,
} from '../compare.ts';

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

  it('scores plans separately', () => {
    const plan = (downPaymentPercent: number, installmentAmount: number) => ({
      downPaymentPercent,
      installmentAmount,
      installmentFrequency: 'quarterly',
      installmentYears: null,
    });
    const score = scoreCase(
      {
        intent: 'listing',
        units: [{ unitType: 'Apartment', paymentPlans: [plan(0, 152_000), plan(10, 104_612)] }],
      },
      {
        intent: 'listing',
        units: [
          {
            unitType: 'Apartment',
            paymentPlans: [plan(0, 152_000), plan(10, 999), plan(20, 75_276)],
          },
        ],
      },
    );
    // Plans are paired by position and tallied on their own, not as unit fields.
    expect(score.plans.downPaymentPercent).toEqual({ correct: 2, total: 2 });
    expect(score.plans.installmentAmount).toEqual({ correct: 1, total: 2 });
    expect(score.planCount).toEqual({ correct: 0, total: 1 });
    expect(score.fields.paymentPlans).toBeUndefined();
    expect(score.mistakes).toContain(
      'Apartment plan 2 installmentAmount: expected 104612, got 999',
    );
    expect(score.mistakes).toContain('Apartment: 1 extra plan(s)');
    expect(sumScores([score], 'plans').installmentAmount).toEqual({ correct: 1, total: 2 });
    // Never part of the key fields (the 2-point rule).
    expect(PLAN_FIELDS.some((f) => KEY_FIELDS.includes(f))).toBe(false);
    expect(PLAN_FIELDS).toEqual([
      'downPaymentPercent',
      'installmentAmount',
      'installmentFrequency',
      'installmentYears',
    ]);
  });

  it('expects no plans when expected.json leaves them out, and counts a missing plan', () => {
    const villa = { unitType: 'Villa', readyToMove: false, priceCurrency: 'EGP' };
    const none = scoreCase(
      { intent: 'listing', units: [{ unitType: 'Villa' }] },
      { intent: 'listing', units: [{ ...villa, paymentPlans: [] }] },
    );
    expect(none.mistakes).toEqual([]);
    expect(none.planCount).toEqual({ correct: 1, total: 1 });
    const missing = scoreCase(
      {
        intent: 'listing',
        units: [
          {
            unitType: 'Villa',
            paymentPlans: [
              {
                downPaymentPercent: 10,
                installmentAmount: null,
                installmentFrequency: null,
                installmentYears: 8,
              },
            ],
          },
        ],
      },
      { intent: 'listing', units: [{ ...villa, paymentPlans: [] }] },
    );
    expect(missing.plans.installmentYears).toEqual({ correct: 0, total: 1 });
    expect(missing.mistakes).toEqual(['Villa plan 1: missing']);
  });
});
