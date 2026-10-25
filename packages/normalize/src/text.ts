/**
 * Text normalization for matching names written in many ways.
 *
 * WhatsApp posts spell the same place in Arabic, English, Franco-Arabic and
 * mixed forms, with inconsistent hamza, diacritics and spacing. Before we
 * compare a name against the alias table, both sides go through
 * `normalizeName`, so "التجمع الخامس", "التجمّع  الخامس" and "التجمع الخامس."
 * all become the same key.
 *
 * The rules are intentionally conservative: they only erase differences that
 * never change meaning. Anything riskier (dropping "ال", fixing typos) is left
 * to fuzzy trigram matching in Postgres, which can be tuned and reviewed.
 */

const ARABIC_DIACRITICS = /[ً-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ARABIC_INDIC_DIGITS = /[٠-٩]/g;
const EASTERN_ARABIC_INDIC_DIGITS = /[۰-۹]/g;
// Anything that is not a letter or a number in any script becomes a space.
const NON_WORD = /[^\p{L}\p{N}]+/gu;

const LETTER_FOLDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[أإآٱ]/g, 'ا'], // alef with hamza or madda -> bare alef
  [/ى/g, 'ي'], // alef maqsura -> ya (written interchangeably in Egypt)
  [/ة/g, 'ه'], // ta marbuta -> ha (also written interchangeably)
  [/ؤ/g, 'و'], // waw with hamza -> waw
  [/ئ/g, 'ي'], // ya with hamza -> ya
  [/گ/g, 'ج'], // Persian gaf, sometimes used for Egyptian hard g
];

/** Converts Arabic-Indic digits (٠١٢ and ۰۱۲) to ASCII digits. */
export function toAsciiDigits(text: string): string {
  return text
    .replace(ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EASTERN_ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Returns the comparison key for a city, developer or project name.
 *
 * Examples:
 *   "New Cairo"          -> "new cairo"
 *   "  ZED-East "        -> "zed east"
 *   "العاصمة الإدارية"     -> "العاصمه الاداريه"
 *   "٦ أكتوبر"            -> "6 اكتوبر"
 */
export function normalizeName(text: string): string {
  let result = text.normalize('NFKC').toLowerCase();
  result = toAsciiDigits(result);
  result = result.replace(ARABIC_DIACRITICS, '').replace(TATWEEL, '');
  for (const [pattern, replacement] of LETTER_FOLDS) {
    result = result.replace(pattern, replacement);
  }
  return result.replace(NON_WORD, ' ').trim();
}
