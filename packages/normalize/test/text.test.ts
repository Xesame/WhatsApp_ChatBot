import { describe, expect, it } from 'vitest';
import { normalizeName, toAsciiDigits } from '../src/index.ts';

describe('toAsciiDigits', () => {
  it('converts Arabic-Indic digits', () => {
    expect(toAsciiDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('converts Eastern Arabic-Indic (Persian) digits', () => {
    expect(toAsciiDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });

  it('leaves other text alone', () => {
    expect(toAsciiDigits('Phase 2 المرحلة')).toBe('Phase 2 المرحلة');
  });
});

describe('normalizeName', () => {
  it.each([
    ['New Cairo', 'new cairo'],
    ['  ZED-East ', 'zed east'],
    ['Mountain View iCity', 'mountain view icity'],
    ['6th of October', '6th of october'],
    ['SODIC   West.', 'sodic west'],
  ])('normalizes English %j', (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it('folds alef variants', () => {
    expect(normalizeName('أكتوبر')).toBe(normalizeName('اكتوبر'));
    expect(normalizeName('إعمار')).toBe(normalizeName('اعمار'));
    expect(normalizeName('آمون')).toBe('امون');
  });

  it('folds ta marbuta and alef maqsura', () => {
    expect(normalizeName('العاصمة الإدارية')).toBe('العاصمه الاداريه');
    expect(normalizeName('الساحل الشمالى')).toBe(normalizeName('الساحل الشمالي'));
  });

  it('removes diacritics and tatweel', () => {
    expect(normalizeName('التجمّع الخامِس')).toBe('التجمع الخامس');
    expect(normalizeName('التجمـــع')).toBe('التجمع');
  });

  it('converts Arabic digits inside names', () => {
    expect(normalizeName('٦ أكتوبر')).toBe('6 اكتوبر');
  });

  it('handles mixed scripts', () => {
    expect(normalizeName('كمبوند Mivida')).toBe('كمبوند mivida');
  });

  it('collapses punctuation and whitespace', () => {
    expect(normalizeName('Il-Monte  Galala!!')).toBe('il monte galala');
    expect(normalizeName('زايد،  الجديدة')).toBe('زايد الجديده');
  });

  it('folds full-width Latin letters via NFKC', () => {
    expect(normalizeName('ＳＯＤＩＣ')).toBe('sodic');
  });

  it('returns an empty string for punctuation only', () => {
    expect(normalizeName(' - . ')).toBe('');
  });
});
