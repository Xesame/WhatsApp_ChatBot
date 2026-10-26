import { normalizeName } from '@reb/normalize';

/**
 * A free, instant first pass before any model call (build plan, step 4):
 * a message with none of these words or patterns is not a listing, so the
 * model is never asked. The list is deliberately broad: a false "maybe"
 * costs one cheap model call, a false "no" loses a listing.
 */
const KEYWORDS = [
  // Arabic (normalized: ة→ه, ى→ي, أ→ا)
  'للبيع',
  'بيع',
  'سعر',
  'السعر',
  'اسعار',
  'مليون',
  'الف',
  'متر',
  'م2',
  'مقدم',
  'تقسيط',
  'اقساط',
  'استلام',
  'تسليم',
  'شقه',
  'شقق',
  'فيلا',
  'فيلل',
  'شاليه',
  'دوبلكس',
  'بنتهاوس',
  'تاون',
  'توين',
  'ستوديو',
  'مكتب',
  'محل',
  'عياده',
  'وحده',
  'وحدات',
  'كمبوند',
  'مشروع',
  'ريسيل',
  'اعاده بيع',
  'تشطيب',
  'جاردن',
  'روف',
  'غرف',
  'غرفه',
  'كاش',
  'خصم',
  'اوفر',
  'لونش',
  'لانش',
  'مبيعات',
  'اتباع',
  'اتباعت',
  // English / Franco
  'sale',
  'sell',
  'price',
  'prices',
  'million',
  'sqm',
  'm2',
  'meter',
  'down payment',
  'installment',
  'installments',
  'delivery',
  'rtm',
  'apartment',
  'villa',
  'chalet',
  'duplex',
  'penthouse',
  'townhouse',
  'twin',
  'studio',
  'office',
  'retail',
  'clinic',
  'unit',
  'units',
  'compound',
  'project',
  'resale',
  'launch',
  'offer',
  'finished',
  'garden',
  'roof',
  'bedroom',
  'bedrooms',
  'br',
  'cash',
  'discount',
  'sold',
  'shaqa',
  'sha2a',
].map((k) => normalizeName(k));

/** Money or area figures: "6.5M", "150 م", "850k". */
const FIGURES = /\d\s*(m|k|mn|م|متر|الف|مليون)(\s|$)/;

export function mightBeListing(text: string): boolean {
  const normalized = ` ${normalizeName(text)} `;
  if (FIGURES.test(normalized)) return true;
  return KEYWORDS.some(
    (keyword) => normalized.includes(` ${keyword} `) || normalized.includes(` ${keyword}`),
  );
}
