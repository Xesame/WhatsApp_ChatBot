import { parseAmounts } from './numbers.ts';
import { toAsciiDigits } from './text.ts';

/** Everything below is pure: phrase in, value out, with a test for each rule. */

/** "$", "USD", "dollar", "دولار" → USD; anything else is EGP (the main currency). */
export function detectCurrency(text: string | null | undefined): 'EGP' | 'USD' {
  return text && /(\$|usd|dollar|دولار|دولار)/i.test(text) ? 'USD' : 'EGP';
}

export interface Delivery {
  year: number | null;
  readyToMove: boolean;
  /** More than one year was mentioned; the first was used. */
  ambiguous: boolean;
}

const READY =
  /(استلام\s*فور[يى]|فور[يى]|جاهز|جاهزه|جاهزة|ready|rtm|immediate|delivered|move\s*in\s*now|كامل\s*التسليم)/i;

/**
 * "Q3 2027" → 2027; "تسليم 2028" → 2028; "استلام فوري" / "RTM" → ready to
 * move; "بعد 3 سنين" / "in 3 years" → the message's year + 3.
 */
export function parseDelivery(text: string | null | undefined, sentAt: Date): Delivery {
  if (!text) return { year: null, readyToMove: false, ambiguous: false };
  const t = toAsciiDigits(text.toLowerCase());
  if (READY.test(t)) return { year: null, readyToMove: true, ambiguous: false };

  const years = [...t.matchAll(/(?:^|[^\d])(20\d{2})(?!\d)/g)].map((m) => Number(m[1]));
  const shortQuarter = /q\s*[1-4]\s*[-/ ]?\s*(\d{2})(?!\d)/.exec(t);
  if (years.length === 0 && shortQuarter?.[1]) years.push(2000 + Number(shortQuarter[1]));
  if (years.length > 0) {
    return { year: years[0] ?? null, readyToMove: false, ambiguous: new Set(years).size > 1 };
  }

  const relative = /(\d+(?:\.\d+)?)\s*(سنين|سنوات|سنه|سنة|years?|yrs?)/.exec(t);
  if (relative?.[1]) {
    return {
      year: sentAt.getUTCFullYear() + Math.ceil(Number(relative[1])),
      readyToMove: false,
      ambiguous: false,
    };
  }
  return { year: null, readyToMove: false, ambiguous: false };
}

export type Frequency = 'monthly' | 'quarterly' | 'semi-annual' | 'annual';

export interface Installments {
  years: number | null;
  frequency: Frequency | null;
  /** years × payments per year, or a stated number of monthly installments. */
  count: number | null;
}

const PER_YEAR: Record<Frequency, number> = {
  monthly: 12,
  quarterly: 4,
  'semi-annual': 2,
  annual: 1,
};

function frequencyOf(t: string): Frequency | null {
  // Order matters: "ربع سنوي" and "نص سنوي" also contain "سنوي".
  if (/(ربع\s*سنو|quarter|كل\s*3\s*(شهور|اشهر|أشهر))/.test(t)) return 'quarterly';
  if (
    /(نص\s*سنو|نصف\s*سنو|semi|half[-\s]*year|biannual|bi-annual|كل\s*6\s*(شهور|اشهر|أشهر))/.test(t)
  ) {
    return 'semi-annual';
  }
  if (/(شهر[يى]|monthly|month)/.test(t)) return 'monthly';
  if (/(سنو[يى]|annual|yearly)/.test(t)) return 'annual';
  return null;
}

/**
 * "8 years quarterly" → 8 years × 4 = 32; "على 7 سنين" → 7 years, count
 * unknown; "96 شهر" → 96 monthly installments over 8 years. The count is
 * always computed here, never by the model.
 */
export function parseInstallments(text: string | null | undefined): Installments {
  if (!text) return { years: null, frequency: null, count: null };
  const t = toAsciiDigits(text.toLowerCase()).replace(/٫/g, '.');
  const frequency = frequencyOf(t);

  const months = /(\d+)\s*(شهر|اشهر|أشهر|months?)(?!\s*ي)/.exec(t);
  const years = /(\d+(?:\.\d+)?)\s*(سنين|سنوات|سنه|سنة|سنتين|years?|yrs?|y\b)/.exec(t);
  const twoYears = /سنتين/.test(t) && !years;

  if (months?.[1] && !years && !/كل\s*\d+\s*(شهر|اشهر|أشهر)/.test(t)) {
    const count = Number(months[1]);
    return { years: count / 12, frequency: 'monthly', count };
  }
  const y = years?.[1] ? Number(years[1]) : twoYears ? 2 : null;
  if (y === null) {
    // "5 أقساط" style: a count with no duration.
    const [first] = parseAmounts(t);
    return {
      years: null,
      frequency,
      count: /(قسط|اقساط|أقساط|installments?)/.test(t) && first ? first.value : null,
    };
  }
  return { years: y, frequency, count: frequency ? Math.round(y * PER_YEAR[frequency]) : null };
}

const ORDINALS: Record<string, number> = {
  الاول: 1,
  الأول: 1,
  اول: 1,
  أول: 1,
  التاني: 2,
  الثاني: 2,
  تاني: 2,
  ثاني: 2,
  التالت: 3,
  الثالث: 3,
  تالت: 3,
  ثالث: 3,
  الرابع: 4,
  رابع: 4,
  الخامس: 5,
  خامس: 5,
  السادس: 6,
  سادس: 6,
  السابع: 7,
  سابع: 7,
  الثامن: 8,
  التامن: 8,
  ثامن: 8,
  تامن: 8,
  التاسع: 9,
  تاسع: 9,
  العاشر: 10,
  عاشر: 10,
};

/**
 * Floor in the template's form: "Ground", "Roof", "3", or a range "1-5".
 * "أرضي بجاردن" → Ground; "الدور التالت" → 3; "3rd floor" → 3.
 */
export function parseFloor(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = toAsciiDigits(text.toLowerCase());
  if (/(ارض[يى]|أرض[يى]|ground|\bgf\b|\bg\b)/.test(t)) return 'Ground';
  if (/(روف|roof|سطح)/.test(t)) return 'Roof';
  const range = /(\d+)\s*(?:-|–|to|الى|إلى|ل)\s*(\d+)/.exec(t);
  if (range?.[1] && range[2]) return `${range[1]}-${range[2]}`;
  const number = /(\d+)(?:st|nd|rd|th)?/.exec(t);
  if (number?.[1]) return number[1];
  for (const word of t.split(/\s+/)) {
    const n = ORDINALS[word];
    if (n !== undefined) return String(n);
  }
  return null;
}
