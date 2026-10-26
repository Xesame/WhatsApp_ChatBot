import { describe, expect, it } from 'vitest';
import { detectCurrency, parseDelivery, parseFloor, parseInstallments } from '../src/index.ts';

const sent = new Date('2026-10-26T10:00:00Z');

describe('detectCurrency', () => {
  it.each<[string, 'EGP' | 'USD']>([
    ['6.5 مليون', 'EGP'],
    ['6.5 مليون جنيه', 'EGP'],
    ['250,000$', 'USD'],
    ['250k USD', 'USD'],
    ['250 ألف دولار', 'USD'],
  ])('%s → %s', (input, expected) => {
    expect(detectCurrency(input)).toBe(expected);
  });
});

describe('parseDelivery', () => {
  it.each<[string, number | null, boolean]>([
    ['Q3 2027', 2027, false],
    ['تسليم 2028', 2028, false],
    ['استلام ٢٠٢٩', 2029, false],
    ['Q4-28', 2028, false],
    ['استلام فوري', null, true],
    ['RTM', null, true],
    ['ready to move', null, true],
    ['جاهز للسكن', null, true],
    ['بعد 3 سنين', 2029, false],
    ['delivery in 4 years', 2030, false],
    ['', null, false],
  ])('%s', (input, year, readyToMove) => {
    expect(parseDelivery(input, sent)).toMatchObject({ year, readyToMove });
  });

  it('flags two different years', () => {
    expect(parseDelivery('2027 / 2028', sent)).toEqual({
      year: 2027,
      readyToMove: false,
      ambiguous: true,
    });
  });
});

describe('parseInstallments', () => {
  it.each<[string, number | null, string | null, number | null]>([
    ['8 years quarterly', 8, 'quarterly', 32],
    ['على 8 سنين ربع سنوي', 8, 'quarterly', 32],
    ['اقساط شهرية على 6 سنين', 6, 'monthly', 72],
    ['تقسيط 10 سنوات نص سنوي', 10, 'semi-annual', 20],
    ['7 years annually', 7, 'annual', 7],
    ['على 7 سنين', 7, null, null],
    ['96 شهر', 8, 'monthly', 96],
    ['كل 3 شهور على 5 سنين', 5, 'quarterly', 20],
    ['سنتين', 2, null, null],
  ])('%s', (input, years, frequency, count) => {
    expect(parseInstallments(input)).toEqual({ years, frequency, count });
  });
});

describe('parseFloor', () => {
  it.each<[string, string | null]>([
    ['أرضي بجاردن', 'Ground'],
    ['ground floor', 'Ground'],
    ['روف', 'Roof'],
    ['الدور التالت', '3'],
    ['الدور الثالث', '3'],
    ['3rd floor', '3'],
    ['دور 5', '5'],
    ['1-5', '1-5'],
    ['من 1 الى 5', '1-5'],
    ['', null],
  ])('%s → %s', (input, expected) => {
    expect(parseFloor(input)).toBe(expected);
  });
});
