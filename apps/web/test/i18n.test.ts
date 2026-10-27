import { describe, expect, it } from 'vitest';
import { makeI18n } from '../src/i18n.tsx';

describe('dashboard languages', () => {
  const en = makeI18n('en');
  const ar = makeI18n('ar');

  it('sets the reading direction', () => {
    expect(en.dir).toBe('ltr');
    expect(ar.dir).toBe('rtl');
  });

  it('writes prices the way brokers do, with Western digits in Arabic too', () => {
    expect(en.money(9_800_000)).toBe('9.8M');
    expect(ar.money(9_800_000)).toBe('9.8 مليون');
    expect(en.money(12_500_000)).toBe('12.5M');
    expect(en.moneyFull(9_800_000)).toBe('EGP 9,800,000');
    expect(ar.moneyFull(9_800_000)).toBe('9,800,000 ج.م');
    expect(en.money(null)).toBe('Not stated');
  });

  it('counts rooms with singular, dual and plural forms', () => {
    expect([1, 2, 3].map((n) => en.rooms(n))).toEqual(['1 bedroom', '2 bedrooms', '3 bedrooms']);
    expect([1, 2, 3, 11].map((n) => ar.rooms(n))).toEqual([
      'غرفة واحدة',
      'غرفتين',
      '3 غرف',
      '11 غرفة',
    ]);
  });

  it('translates fixed values and entity names', () => {
    expect(ar.value('Twin House')).toBe('توين هاوس');
    expect(en.value('Twin House')).toBe('Twin House');
    expect(ar.name({ en: 'New Cairo', ar: 'القاهرة الجديدة' })).toBe('القاهرة الجديدة');
    expect(ar.t('search.results', { n: 12 })).toBe('12 وحدة');
  });
});
