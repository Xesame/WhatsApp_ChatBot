import { toAsciiDigits } from '@reb/normalize';

/**
 * Removes personal contact details from text before it is sent to any model
 * (build plan, rule 3).
 *
 * Sender names and phone numbers of the people posting are never stored, so
 * they cannot be sent. What remains is contact details people type *inside*
 * their posts ("للتواصل 0100 123 4567"): phone numbers, e-mail addresses and
 * @mentions are replaced with placeholders. Names typed inside a post
 * (signatures) cannot be detected reliably and are not removed.
 */

const PATTERNS: [RegExp, string][] = [
  // WhatsApp mentions are phone numbers: @201001234567. First, so the
  // phone rule below doesn't eat the digits.
  [/@\d{6,}/g, '[mention]'],
  // Egyptian mobiles, with or without +20 / 0020, any spacing or dashes.
  [/(?:(?:\+|00)\s*20[\s-]*)?0?1[0125](?:[\s-]*\d){8}(?!\d)/g, '[phone]'],
  // Landlines and other long numbers written with separators: 02-2345-6789.
  [/(?<![\d.,])0\d{1,2}[\s-]+\d{3,4}[\s-]*\d{3,4}(?![\d.,])/g, '[phone]'],
  // Any other run of 10 or more digits (prices that long don't occur).
  [/(?<![\d.,])\d{10,}(?![\d.,])/g, '[phone]'],
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]'],
];

/**
 * Same length in, same length out for the digit mapping, so positions found
 * in the ASCII copy are valid in the original (Arabic digits stay readable
 * for the model everywhere else).
 */
export function scrubPersonalData(text: string): string {
  let ascii = toAsciiDigits(text);
  let original = text;
  for (const [pattern, placeholder] of PATTERNS) {
    let result = '';
    let asciiResult = '';
    let last = 0;
    for (const match of ascii.matchAll(pattern)) {
      const start = match.index;
      result += original.slice(last, start) + placeholder;
      asciiResult += ascii.slice(last, start) + placeholder;
      last = start + match[0].length;
    }
    original = result + original.slice(last);
    ascii = asciiResult + ascii.slice(last);
  }
  return original;
}

/** True if the text contains a phone number, e-mail or mention that scrubbing would remove. */
export function containsPersonalData(text: string): boolean {
  return scrubPersonalData(text) !== text;
}
