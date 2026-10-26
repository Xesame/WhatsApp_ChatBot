import { toAsciiDigits } from './text.ts';

/**
 * Turning number phrases from Egyptian real estate posts into numbers.
 *
 * Handles: Arabic-Indic digits (٣٫٥), thousands separators (1,250,000 and
 * 1.250.000), decimal commas (3,5), multipliers (مليون, ألف, M, K, million),
 * halves and quarters (مليون ونص, نص مليون, ربع مليون), compounds
 * (9 مليون و 200 ألف), number words (تلاتة, مليونين) and ranges
 * (6.5 - 9 مليون, من 120 ل 180).
 *
 * Pure functions with no I/O; every rule has a test.
 */

const MULTIPLIERS: [RegExp, number][] = [
  [/^(مليار|billion|bn|b)$/, 1e9],
  [/^(مليون|ملايين|مليونين|million|millions|mn|mil|m)$/, 1e6],
  [/^(الف|ألف|آلاف|الاف|ألاف|الفين|ألفين|thousand|k|ك)$/, 1e3],
];

const WORD_NUMBERS: Record<string, number> = {
  واحد: 1,
  واحده: 1,
  واحدة: 1,
  اتنين: 2,
  اثنين: 2,
  إثنين: 2,
  اثنان: 2,
  تلات: 3,
  ثلاث: 3,
  تلاته: 3,
  تلاتة: 3,
  ثلاثه: 3,
  ثلاثة: 3,
  اربع: 4,
  أربع: 4,
  اربعه: 4,
  اربعة: 4,
  أربعة: 4,
  خمس: 5,
  خمسه: 5,
  خمسة: 5,
  ست: 6,
  سته: 6,
  ستة: 6,
  سبع: 7,
  سبعه: 7,
  سبعة: 7,
  تمن: 8,
  ثمان: 8,
  تمانيه: 8,
  تمانية: 8,
  ثمانية: 8,
  ثمانيه: 8,
  تسع: 9,
  تسعه: 9,
  تسعة: 9,
  عشر: 10,
  عشره: 10,
  عشرة: 10,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** Words that stand for a number on their own: "مليونين" = 2,000,000. */
const SELF_COUNTING: Record<string, number> = {
  مليون: 1e6,
  مليونين: 2e6,
  ألف: 1e3,
  الف: 1e3,
  ألفين: 2e3,
  الفين: 2e3,
};

const HALF = /^(و?نص|و?نصف|half)$/;
const QUARTER = /^(و?ربع|quarter)$/;
const RANGE_WORDS = /^(-|–|—|to|الى|إلى|لـ?|ل|حتى|لحد|till|until|~)$/;
const AND = /^(و|and|&|\+)$/;

interface Numeral {
  value: number;
  /**
   * "1.500" / "6,500": one separator followed by exactly three digits. Read
   * as thousands (1500) unless a multiplier follows ("6.500 مليون" = 6.5M),
   * in which case `decimalValue` is used.
   */
  decimalValue: number | null;
}

function readNumeral(token: string): Numeral | null {
  const t = toAsciiDigits(token).replace(/٫/g, '.').replace(/٬/g, ',');
  if (!/^\d[\d.,]*$/.test(t) || /[.,]$/.test(t)) return null;
  const separators = t.match(/[.,]/g) ?? [];
  if (separators.length === 0) return { value: Number(t), decimalValue: null };
  if (new Set(separators).size > 1) {
    // "1,250.50" or "1.250,50": the last separator is the decimal point.
    const at = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
    return {
      value: Number(`${t.slice(0, at).replace(/[.,]/g, '')}.${t.slice(at + 1)}`),
      decimalValue: null,
    };
  }
  if (separators.length > 1) return { value: Number(t.replace(/[.,]/g, '')), decimalValue: null };
  const [head = '', tail = ''] = t.split(/[.,]/);
  const decimal = Number(`${head}.${tail}`);
  if (tail.length === 3 && head.length <= 3 && head !== '0') {
    return { value: Number(`${head}${tail}`), decimalValue: decimal };
  }
  return { value: decimal, decimalValue: null };
}

/** Reads "1,250,000", "1.250.000", "3,5", "6.5" (no multiplier). */
export function parseNumeral(token: string): number | null {
  return readNumeral(token)?.value ?? null;
}

function multiplierOf(word: string): number | null {
  for (const [pattern, value] of MULTIPLIERS) if (pattern.test(word)) return value;
  return null;
}

/** Splits a phrase into words, numbers and separators. */
function tokenize(text: string): string[] {
  const t = toAsciiDigits(text.toLowerCase())
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    // split "6.5m", "850k", "120م" into number + unit
    .replace(/(\d)([a-z؀-ۿ%٪$])/g, '$1 $2')
    .replace(/([a-z؀-ۿ$])(\d)/g, '$1 $2')
    // "ل120" / "لـ 180": a range word glued to a number
    .replace(/(^|\s)(لـ?)(?=\d)/g, '$1$2 ');
  return t
    .split(/(\s+|-|–|—|~|\+|\/|\(|\)|:|،)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^[()/:،]$/.test(s));
}

export interface Amount {
  value: number;
  /** True when the phrase said million/thousand/K/M etc. */
  hasMultiplier: boolean;
  /** Position in the token list, used to find range separators between amounts. */
  index: number;
  /** Token index just after the amount. */
  end: number;
}

/**
 * Every amount in a phrase, in order.
 * "من 6.5 مليون ل 9 مليون و 200 ألف" → [6,500,000, 9,200,000].
 */
export function parseAmounts(text: string, options: { money?: boolean } = {}): Amount[] {
  // For areas, "m" means metres, not million: no multipliers at all.
  const money = options.money ?? true;
  const tokens = tokenize(text);
  const amounts: Amount[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i] ?? '';
    const numeral = readNumeral(token);
    let base = numeral?.value ?? WORD_NUMBERS[token] ?? null;
    let start = i;

    if (base === null) {
      // "نص مليون", "ربع مليون", or a bare "مليونين"
      const next = tokens[i + 1] ?? '';
      if (money && (HALF.test(token) || QUARTER.test(token)) && multiplierOf(next)) {
        amounts.push({
          value: (HALF.test(token) ? 0.5 : 0.25) * (multiplierOf(next) ?? 1),
          hasMultiplier: true,
          index: i,
          end: i + 2,
        });
        i += 2;
        continue;
      }
      if (money && SELF_COUNTING[token] !== undefined) {
        base = 1;
        start = i;
        i -= 1; // the word itself is the multiplier, read below
      } else {
        i += 1;
        continue;
      }
    }

    let j = i + 1;
    let value = base;
    let hasMultiplier = false;
    const multiplier = money ? multiplierOf(tokens[j] ?? '') : null;
    if (multiplier) {
      // "6.500 مليون" means 6.5 million, not 6,500 million.
      if (numeral?.decimalValue != null) base = numeral.decimalValue;
      value = token in SELF_COUNTING ? (SELF_COUNTING[token] ?? 0) : base * multiplier;
      hasMultiplier = true;
      j += 1;
      // "مليون ونص" / "مليون و نص"
      if (
        HALF.test(tokens[j] ?? '') ||
        (AND.test(tokens[j] ?? '') && HALF.test(tokens[j + 1] ?? ''))
      ) {
        value += 0.5 * multiplier;
        j += AND.test(tokens[j] ?? '') ? 2 : 1;
      } else if (
        QUARTER.test(tokens[j] ?? '') ||
        (AND.test(tokens[j] ?? '') && QUARTER.test(tokens[j + 1] ?? ''))
      ) {
        value += 0.25 * multiplier;
        j += AND.test(tokens[j] ?? '') ? 2 : 1;
      }
      // "9 مليون و 200 ألف": a smaller amount joined with "و" adds on.
      while (AND.test(tokens[j] ?? '')) {
        const n = parseNumeral(tokens[j + 1] ?? '');
        const m = multiplierOf(tokens[j + 2] ?? '');
        if (n === null || m === null || m >= multiplier) break;
        value += n * m;
        j += 3;
      }
    }
    amounts.push({ value, hasMultiplier, index: start, end: j });
    i = j;
  }
  return amounts;
}

/** True if a range word ("-", "to", "ل", "الى") sits between two token positions. */
function rangeBetween(text: string, a: Amount, b: Amount): boolean {
  const tokens = tokenize(text);
  for (let k = a.end; k < b.index; k++) if (RANGE_WORDS.test(tokens[k] ?? '')) return true;
  return false;
}

/** Words before the first number that mean "starting from". */
const STARTING_FROM =
  /^(يبدا|يبدأ|تبدا|تبدأ|بدايه|بداية|ابتداء|ابتداءا|إبتداء|اعتبارا|starting|starts|start|from|min|minimum|اقل|أقل|من|بدءا|بدءًا)$/;

export interface ParsedRange {
  min: number | null;
  max: number | null;
  /** True when every number had an explicit multiplier (or none was needed). */
  explicitUnits: boolean;
  /** "starting from X": only the minimum is known. */
  startingFrom: boolean;
}

/**
 * Reads a range or single value.
 *   "120-180 م"           → 120..180
 *   "6.5 - 9 مليون"        → 6.5M..9M (the multiplier applies to both)
 *   "150 متر"              → 150..150
 *   "يبدأ من 6.5 مليون"     → 6.5M..null (starting from: Min only)
 *   "من 120 ل 180"         → 120..180
 *
 * Pass `{ money: false }` for areas, so "320 m" is 320 metres, not 320 million.
 */
export function parseRange(
  text: string | null | undefined,
  options: { money?: boolean } = {},
): ParsedRange {
  const empty = { min: null, max: null, explicitUnits: true, startingFrom: false };
  if (!text) return empty;
  const amounts = parseAmounts(text, options);
  const [first, second] = amounts;
  if (!first) return empty;

  if (second && rangeBetween(text, first, second)) {
    let low = first.value;
    // "6.5 - 9 مليون": the first number borrows the second's multiplier.
    if (!first.hasMultiplier && second.hasMultiplier) {
      const multiplier = second.value >= 1e6 ? 1e6 : second.value >= 1e3 ? 1e3 : 1;
      if (low * multiplier <= second.value) low *= multiplier;
    }
    return {
      min: Math.min(low, second.value),
      max: Math.max(low, second.value),
      explicitUnits: second.hasMultiplier || (first.hasMultiplier && second.hasMultiplier),
      startingFrom: false,
    };
  }

  const startingFrom = tokenize(text)
    .slice(0, first.index)
    .some((word) => STARTING_FROM.test(word));
  return {
    min: first.value,
    max: startingFrom ? null : first.value,
    explicitUnits: first.hasMultiplier,
    startingFrom,
  };
}

/** First whole number in a phrase: "3 غرف" → 3, "تلات غرف" → 3, "غرفتين" → 2. */
export function parseCount(text: string | null | undefined): number | null {
  if (!text) return null;
  if (/(غرفتين|غرفتان|حمامين|حمامان)/.test(text)) return 2;
  const [first] = parseAmounts(text);
  if (first && Number.isInteger(first.value) && first.value >= 0 && first.value <= 20)
    return first.value;
  if (/(^|\s)(غرفه|غرفة|حمام|bedroom|bathroom|room)(\s|$)/i.test(text)) return 1;
  return null;
}

export interface PercentOrAmount {
  percent: number | null;
  amount: number | null;
}

/** "10%", "١٠٪", "10 في المية", "10 percent" → percent; "500 ألف" → amount. */
export function parsePercentOrAmount(text: string | null | undefined): PercentOrAmount {
  if (!text) return { percent: null, amount: null };
  const t = toAsciiDigits(text).replace(/٫/g, '.');
  const percent =
    /(\d+(?:[.,]\d+)?)\s*(%|٪|في\s*الم[يئ]ة|في\s*المي[هة]|بالم[يئ]ة|percent|pct)/i.exec(t);
  if (percent?.[1]) return { percent: Number(percent[1].replace(',', '.')), amount: null };
  const [first] = parseAmounts(text);
  return { percent: null, amount: first?.value ?? null };
}
