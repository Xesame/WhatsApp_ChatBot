import type { SearchItem } from '../api.ts';
import type { I18n } from '../i18n.tsx';

/** Piastres → whole pounds. */
export const pounds = (minor: number | null | undefined) =>
  minor === null || minor === undefined ? null : Math.round(minor / 100);

/** "9.8M" or "8M – 9.5M", in EGP (USD listings converted). */
export function priceText(
  item: Pick<SearchItem, 'minPriceEgp' | 'maxPriceEgp'>,
  i18n: I18n,
): string {
  const low = pounds(item.minPriceEgp);
  const high = pounds(item.maxPriceEgp);
  if (low === null && high === null) return i18n.t('common.unknown');
  if (low !== null && high !== null && high > low)
    return `${i18n.money(low)} – ${i18n.money(high)}`;
  return i18n.money(low ?? high);
}

export function areaText(item: Pick<SearchItem, 'minArea' | 'maxArea'>, i18n: I18n): string {
  const { minArea: a, maxArea: b } = item;
  if (a === null && b === null) return i18n.t('common.unknown');
  const unit = i18n.t('common.m2');
  if (a !== null && b !== null && b > a) return `${i18n.number(a)} – ${i18n.number(b)} ${unit}`;
  return `${i18n.number(a ?? b ?? 0)} ${unit}`;
}

export function paymentText(
  item: Pick<SearchItem, 'downPayment' | 'installmentYears'>,
  i18n: I18n,
): string {
  const parts: string[] = [];
  if (item.downPayment !== null)
    parts.push(i18n.t('unit.down', { p: i18n.number(item.downPayment, 1) }));
  if (item.installmentYears !== null)
    parts.push(i18n.t('unit.overYears', { n: i18n.number(item.installmentYears, 1) }));
  return parts.length ? parts.join(' · ') : i18n.t('common.unknown');
}

export function deliveryText(
  item: Pick<SearchItem, 'readyToMove' | 'deliveryYear'>,
  i18n: I18n,
): string {
  if (item.readyToMove) return i18n.t('unit.readyToMove');
  return item.deliveryYear ? String(item.deliveryYear) : i18n.t('common.unknown');
}

/** "Apartment · 3 bedrooms" */
export function kindText(item: Pick<SearchItem, 'unitType' | 'bedrooms'>, i18n: I18n): string {
  const parts = [i18n.value(item.unitType)];
  if (item.bedrooms !== null) parts.push(i18n.rooms(item.bedrooms));
  return parts.join(' · ');
}

export function placeText(item: Pick<SearchItem, 'project' | 'city'>, i18n: I18n): string {
  return (
    [item.project, item.city]
      .filter(Boolean)
      .map((n) => i18n.name(n))
      .join(' · ') || i18n.t('common.unknown')
  );
}
