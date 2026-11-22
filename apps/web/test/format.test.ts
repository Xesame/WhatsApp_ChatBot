import { describe, expect, it } from 'vitest';
import { paymentText } from '../src/firm/format.ts';
import { makeI18n } from '../src/i18n.tsx';

describe('paymentText', () => {
  it('joins the parts with a dash, never a middle dot', () => {
    for (const lang of ['en', 'ar'] as const) {
      const text = paymentText({ downPayment: 10, installmentYears: 7 }, makeI18n(lang));
      expect(text).toContain(' – ');
      expect(text).not.toContain('·');
    }
  });

  it('says unknown when nothing is stated', () => {
    const i18n = makeI18n('en');
    expect(paymentText({ downPayment: null, installmentYears: null }, i18n)).toBe(
      i18n.t('common.unknown'),
    );
  });
});
