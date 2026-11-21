import { paymentPlanSchema, type RawPaymentPlan } from '@reb/schema';
import { describe, expect, it } from 'vitest';
import { monthlyEquivalent, normalizePlans } from '../src/plans.ts';

const blankPlan: RawPaymentPlan = {
  label: null,
  down_payment: null,
  installment_amount: null,
  installments: null,
  plan_price: null,
  cash_discount: null,
  notes: null,
};
const plan = (fields: Partial<RawPaymentPlan>): RawPaymentPlan => ({ ...blankPlan, ...fields });

// The Veloria message (listing text only, no names or contact details).
const VELORIA = `🏢 Veloria Compound
📍 Unit: 95 M | Two Bedroom
📍 Meter Price: 41,600 L.E
💰 TOTAL PRICE: 3,952,000 L.E
💳 PAYMENT PLAN
🔹 0% DP
Quarterly: 152,000 L.E

🔹 10% DP
DP: 395,200 L.E
Quarterly: 104,612 L.E

🔹 15% DP
DP: 592,800 L.E
Quarterly: 88,400 L.E

🔹 20% DP
DP: 790,400 L.E
Quarterly: 75,276 L.E

🔹 30% DP
DP: 1,185,600 L.E
Quarterly: 55,328 L.E
━━━━━━━━━━━━━
🚧 Delivery: 3.5 Years`;

const ctx = (sourceText: string) => ({ sourceText, unitCurrency: 'EGP' as const });

describe('normalizePlans', () => {
  it('reads all five Veloria plans in minor units', () => {
    const raw = [
      plan({ label: '0% DP', down_payment: '0% DP', installment_amount: 'Quarterly: 152,000 L.E' }),
      plan({
        label: '10% DP',
        down_payment: '10% DP DP: 395,200 L.E',
        installment_amount: 'Quarterly: 104,612 L.E',
      }),
      plan({
        label: '15% DP',
        down_payment: '15% DP DP: 592,800 L.E',
        installment_amount: 'Quarterly: 88,400 L.E',
      }),
      plan({
        label: '20% DP',
        down_payment: '20% DP DP: 790,400 L.E',
        installment_amount: 'Quarterly: 75,276 L.E',
      }),
      plan({
        label: '30% DP',
        down_payment: '30% DP DP: 1,185,600 L.E',
        installment_amount: 'Quarterly: 55,328 L.E',
      }),
    ];
    const { plans, reasons } = normalizePlans(raw, ctx(VELORIA));
    expect(reasons).toEqual([]);
    expect(plans).toHaveLength(5);
    expect(
      plans.map((p) => [
        p.position,
        p.downPaymentPercent,
        p.downPaymentAmount,
        p.installmentAmount,
        p.installmentFrequency,
        p.cash,
        p.currency,
      ]),
    ).toEqual([
      [0, 0, null, 15_200_000, 'quarterly', false, 'EGP'],
      [1, 10, 39_520_000, 10_461_200, 'quarterly', false, 'EGP'],
      [2, 15, 59_280_000, 8_840_000, 'quarterly', false, 'EGP'],
      [3, 20, 79_040_000, 7_527_600, 'quarterly', false, 'EGP'],
      [4, 30, 118_560_000, 5_532_800, 'quarterly', false, 'EGP'],
    ]);
  });

  it('reads Arabic words and Arabic digits', () => {
    const text = 'مقدم ١٠٪ والباقي على ٨ سنين ربع سنوي القسط الربع سنوي ١٠٤٬٦١٢ ج';
    const { plans, reasons } = normalizePlans(
      [
        plan({
          down_payment: 'مقدم ١٠٪',
          installments: 'والباقي على ٨ سنين ربع سنوي',
          installment_amount: 'القسط الربع سنوي ١٠٤٬٦١٢ ج',
        }),
      ],
      ctx(text),
    );
    expect(reasons).toEqual([]);
    expect(plans[0]).toMatchObject({
      downPaymentPercent: 10,
      installmentYears: 8,
      installmentFrequency: 'quarterly',
      installmentsCount: 32,
      installmentAmount: 10_461_200,
      currency: 'EGP',
    });
  });

  it('marks a pay-in-full plan as cash with no monthly equivalent', () => {
    const { plans } = normalizePlans(
      [plan({ label: 'Cash', cash_discount: 'خصم 15% كاش' })],
      ctx('Cash price: خصم 15% كاش'),
    );
    expect(plans[0]?.cash).toBe(true);
    expect(plans[0] && monthlyEquivalent(plans[0])).toBeNull();
  });

  it('drops a phrase that is not in the message, and says so', () => {
    const { plans, reasons } = normalizePlans(
      [plan({ down_payment: '10% DP', installment_amount: 'Quarterly: 999,999 L.E' })],
      ctx(VELORIA),
    );
    expect(plans[0]?.installmentAmount).toBeNull();
    expect(plans[0]?.downPaymentPercent).toBe(10);
    expect(reasons).toEqual([
      'Dropped installment_amount "Quarterly: 999,999 L.E": not found in the message',
    ]);
  });

  it('takes the currency from the phrase, else the unit currency', () => {
    const usd = normalizePlans([plan({ installment_amount: 'Monthly: 2,000 USD' })], {
      sourceText: 'Monthly: 2,000 USD',
      unitCurrency: 'EGP',
    });
    expect(usd.plans[0]?.currency).toBe('USD');
    const bare = normalizePlans([plan({ installment_amount: 'Monthly: 2,000' })], {
      sourceText: 'Monthly: 2,000',
      unitCurrency: 'USD',
    });
    expect(bare.plans[0]?.currency).toBe('USD');
  });

  it('does not read a duration as a down payment or installment amount', () => {
    const text = 'مقدم 10% على 8 سنين قسط شهري 12 قسط';
    const { plans } = normalizePlans(
      [plan({ down_payment: 'مقدم 10% على 8 سنين', installment_amount: 'قسط شهري 12 قسط' })],
      ctx(text),
    );
    expect(plans[0]?.downPaymentPercent).toBe(10);
    expect(plans[0]?.downPaymentAmount).toBeNull();
    expect(plans[0]?.installmentAmount).toBeNull();
    const noPercent = normalizePlans(
      [plan({ down_payment: 'مقدم على 8 سنين' })],
      ctx('مقدم على 8 سنين'),
    );
    expect(noPercent.plans[0]?.downPaymentAmount).toBeNull();
  });

  it('reads a small amount only when it names a currency', () => {
    const text = 'Monthly 850 L.E or Monthly 850';
    const named = normalizePlans([plan({ installment_amount: 'Monthly 850 L.E' })], ctx(text));
    expect(named.plans[0]?.installmentAmount).toBe(85_000);
    const bare = normalizePlans([plan({ installment_amount: 'Monthly 850' })], ctx(text));
    expect(bare.plans[0]?.installmentAmount).toBeNull();
  });

  it('treats a plan over 0 years as having no length', () => {
    const { plans } = normalizePlans(
      [plan({ down_payment: '100%', installments: 'على 0 سنة' })],
      ctx('100% على 0 سنة'),
    );
    expect(plans[0]?.installmentYears).toBeNull();
    expect(paymentPlanSchema.safeParse({ ...plans[0], installmentYears: 0 }).success).toBe(false);
  });

  it('ignores a plan with nothing in it', () => {
    expect(normalizePlans([blankPlan], ctx(VELORIA)).plans).toEqual([]);
  });
});

describe('monthlyEquivalent', () => {
  it('turns each frequency into a per-month amount', () => {
    const base = normalizePlans(
      [plan({ installment_amount: 'Quarterly: 300,000 L.E' })],
      ctx('Quarterly: 300,000 L.E'),
    ).plans[0];
    expect(base && monthlyEquivalent(base)).toBe(10_000_000);
    expect(base && monthlyEquivalent({ ...base, installmentFrequency: 'annual' })).toBe(2_500_000);
    expect(base && monthlyEquivalent({ ...base, installmentFrequency: null })).toBeNull();
  });
});
