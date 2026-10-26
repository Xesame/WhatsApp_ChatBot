import { describe, expect, it } from 'vitest';
import {
  parseAmounts,
  parseCount,
  parseNumeral,
  parsePercentOrAmount,
  parseRange,
} from '../src/index.ts';

const values = (text: string) => parseAmounts(text).map((a) => a.value);

describe('parseNumeral', () => {
  it.each<[string, number]>([
    ['6.5', 6.5],
    ['3,5', 3.5],
    ['1,250,000', 1_250_000],
    ['1.250.000', 1_250_000],
    ['1,250', 1250],
    ['1,250.50', 1250.5],
    ['1.250,50', 1250.5],
    ['٣٫٥', 3.5],
    ['١٢٠', 120],
    ['0.750', 0.75],
  ])('%s → %d', (input, expected) => {
    expect(parseNumeral(input)).toBe(expected);
  });

  it('rejects things that are not numbers', () => {
    expect(parseNumeral('abc')).toBeNull();
    expect(parseNumeral('5.')).toBeNull();
  });
});

describe('parseAmounts', () => {
  it.each<[string, number[]]>([
    ['3.5 مليون', [3_500_000]],
    ['٣٫٥ مليون', [3_500_000]],
    ['3.5M', [3_500_000]],
    ['3.5m', [3_500_000]],
    ['850 ألف', [850_000]],
    ['850 الف', [850_000]],
    ['850k', [850_000]],
    ['EGP 6,500,000', [6_500_000]],
    ['6.500 مليون', [6_500_000]],
    ['مليون ونص', [1_500_000]],
    ['2 مليون و نص', [2_500_000]],
    ['نص مليون', [500_000]],
    ['ربع مليون', [250_000]],
    ['مليونين', [2_000_000]],
    ['9 مليون و 200 ألف', [9_200_000]],
    ['تلاتة مليون', [3_000_000]],
    ['1.2 billion', [1_200_000_000]],
    ['من 6.5 مليون ل 9 مليون', [6_500_000, 9_000_000]],
  ])('%s', (input, expected) => {
    expect(values(input)).toEqual(expected);
  });
});

describe('parseRange', () => {
  it.each<[string, number | null, number | null, boolean]>([
    ['120-180 م', 120, 180, false],
    ['120 - 180 متر', 120, 180, false],
    ['من 120 ل 180 متر', 120, 180, false],
    ['من 120 لـ180', 120, 180, false],
    ['120 to 180 sqm', 120, 180, false],
    ['150 متر', 150, 150, false],
    ['150m²', 150, 150, false],
    ['6.5 - 9 مليون', 6_500_000, 9_000_000, false],
    ['6.5M - 9M', 6_500_000, 9_000_000, false],
    ['يبدأ من 6.5 مليون', 6_500_000, null, true],
    ['starting from 6.5M', 6_500_000, null, true],
    ['تبدأ الأسعار من 120 متر', 120, null, true],
    ['من 6.5 مليون', 6_500_000, null, true],
    ['السعر 7,200,000 جنيه', 7_200_000, 7_200_000, false],
  ])('%s', (input, min, max, startingFrom) => {
    expect(parseRange(input)).toMatchObject({ min, max, startingFrom });
  });

  it('reads "m" as metres for areas, and as million for money', () => {
    expect(parseRange('BUA 320 m', { money: false })).toMatchObject({ min: 320, max: 320 });
    expect(parseRange('land 600 m', { money: false })).toMatchObject({ min: 600, max: 600 });
    expect(parseRange('120-180 m', { money: false })).toMatchObject({ min: 120, max: 180 });
    expect(parseRange('6.5 m')).toMatchObject({ min: 6_500_000 });
  });

  it('reports when a price had no million/thousand word', () => {
    expect(parseRange('السعر 6.5').explicitUnits).toBe(false);
    expect(parseRange('6.5 مليون').explicitUnits).toBe(true);
  });

  it('returns nothing for empty or number-less text', () => {
    expect(parseRange(null)).toMatchObject({ min: null, max: null });
    expect(parseRange('السعر عند الاتصال')).toMatchObject({ min: null, max: null });
  });
});

describe('parseCount', () => {
  it.each<[string, number | null]>([
    ['3 غرف', 3],
    ['٣ غرف', 3],
    ['3BR', 3],
    ['3 bedrooms', 3],
    ['تلات غرف', 3],
    ['غرفتين', 2],
    ['حمامين', 2],
    ['غرفة', 1],
    ['3+1', 3],
    ['', null],
  ])('%s → %s', (input, expected) => {
    expect(parseCount(input)).toBe(expected);
  });
});

describe('parsePercentOrAmount', () => {
  it.each<[string, number | null, number | null]>([
    ['10%', 10, null],
    ['١٠٪', 10, null],
    ['مقدم 10 %', 10, null],
    ['7.5%', 7.5, null],
    ['10 في المية', 10, null],
    ['8% من ثمن الوحدة', 8, null],
    ['مقدم 500 ألف', null, 500_000],
    ['200k', null, 200_000],
  ])('%s', (input, percent, amount) => {
    expect(parsePercentOrAmount(input)).toEqual({ percent, amount });
  });
});
