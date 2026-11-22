import type { PaymentPlan } from '@reb/schema';
import { describe, expect, it } from 'vitest';
import { editRow, emptyRow, planToRow, plansChanged, rowsToPlans } from '../src/pages/plans.ts';

const plan: PaymentPlan = {
  position: 0,
  label: '10% down',
  downPaymentPercent: 10,
  downPaymentAmount: 150_000_000,
  installmentAmount: 12_500_050,
  installmentFrequency: 'quarterly',
  installmentsCount: 32,
  installmentYears: 8,
  planPrice: 1_500_000_000,
  cash: false,
  notes: null,
  currency: 'EGP',
};

describe('plans table helpers', () => {
  it('shows amounts in whole pounds and sends them back in piastres', () => {
    const row = planToRow(plan);
    expect(row).toMatchObject({
      downPaymentAmount: '1500000',
      installmentAmount: '125000.5',
      planPrice: '15000000',
      downPaymentPercent: '10',
      notes: '',
    });
    expect(rowsToPlans([row])).toEqual([plan]); // round trip, nothing lost
  });

  it('numbers plans in table order and treats empty boxes as not stated', () => {
    const rows = [emptyRow('USD'), { ...emptyRow('USD'), label: ' cash ', cash: true }];
    expect(rowsToPlans(rows)).toMatchObject([
      { position: 0, label: null, planPrice: null, currency: 'USD', cash: false },
      { position: 1, label: 'cash', cash: true },
    ]);
  });

  it('accepts commas and refuses text where a number goes', () => {
    expect(rowsToPlans([{ ...emptyRow('EGP'), planPrice: '1,500,000' }])[0]?.planPrice).toBe(
      150_000_000,
    );
    expect(() => rowsToPlans([{ ...emptyRow('EGP'), installmentYears: 'eight' }])).toThrow(
      /Plan 1: "eight" is not a number/,
    );
  });

  it('drops the hidden installment count when frequency or years change', () => {
    const row = planToRow(plan);
    expect(editRow(row, { installmentFrequency: 'monthly' }).installmentsCount).toBeNull();
    expect(editRow(row, { installmentYears: '5' }).installmentsCount).toBeNull();
    expect(editRow(row, { label: 'x' }).installmentsCount).toBe(32);
  });

  it('knows when the table changed', () => {
    const loaded = [planToRow(plan)];
    expect(plansChanged(loaded, [planToRow(plan)])).toBe(false);
    expect(plansChanged(loaded, [{ ...planToRow(plan), label: 'x' }])).toBe(true);
    expect(plansChanged(loaded, [])).toBe(true);
  });
});
