import { CATEGORIES, FINISHING_SPECS, UNIT_TYPES } from '@reb/schema/enums';
import { VISIBLE_STATUSES, type SearchFilters } from '@reb/search/filters';
import type { FilterOptions } from '../api.ts';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { Button, Input, Select } from '../ui.tsx';
import { MultiPick } from './MultiPick.tsx';

const thisYear = new Date().getFullYear();
const ROOMS = [0, 1, 2, 3, 4, 5, 6];

/** The filter panel. Every change is applied at once (and kept in the address). */
export function Filters({
  filters,
  options,
  onChange,
}: {
  filters: SearchFilters;
  options: FilterOptions | undefined;
  onChange: (next: SearchFilters) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const set = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K] | undefined) => {
    const empty = value === undefined || (Array.isArray(value) && value.length === 0);
    // rebuild without the key rather than deleting it
    const next = Object.fromEntries(
      Object.entries(filters).filter(([k]) => k !== key),
    ) as SearchFilters;
    onChange(empty ? next : { ...next, [key]: value });
  };
  const ids = (values: string[]) => values.map(Number);
  const strings = (values: number[] | undefined) => (values ?? []).map(String);
  const num = (text: string, scale = 1) => {
    const n = Number(text.replace(/,/g, ''));
    return text.trim() === '' || !Number.isFinite(n) || n < 0 ? undefined : n * scale;
  };
  // projects narrow down with the chosen areas and developers
  const projects = (options?.projects ?? []).filter(
    (p) =>
      (!filters.cityIds?.length || filters.cityIds.includes(p.cityId)) &&
      (!filters.developerIds?.length || filters.developerIds.includes(p.developerId)),
  );
  const entity = (list: { id: number; en: string; ar: string }[]) =>
    list.map((e) => ({ value: String(e.id), label: i18n.name(e) }));
  const fixed = (list: readonly string[]) => list.map((v) => ({ value: v, label: i18n.value(v) }));

  return (
    <div className="space-y-4">
      <MultiPick
        label={t('filter.city')}
        options={entity(options?.cities ?? [])}
        selected={strings(filters.cityIds)}
        onChange={(v) => set('cityIds', ids(v))}
      />
      <MultiPick
        label={t('filter.developer')}
        options={entity(options?.developers ?? [])}
        selected={strings(filters.developerIds)}
        onChange={(v) => set('developerIds', ids(v))}
      />
      <MultiPick
        label={t('filter.project')}
        options={entity(projects)}
        selected={strings(filters.projectIds)}
        onChange={(v) => set('projectIds', ids(v))}
      />
      <MultiPick
        label={t('filter.unitType')}
        options={fixed(UNIT_TYPES)}
        selected={filters.unitTypes ?? []}
        onChange={(v) => set('unitTypes', v as SearchFilters['unitTypes'])}
      />
      <MultiPick
        label={t('filter.category')}
        options={fixed(CATEGORIES)}
        selected={filters.categories ?? []}
        onChange={(v) => set('categories', v as SearchFilters['categories'])}
      />

      <fieldset>
        <legend className="text-xs font-medium text-slate-600 dark:text-slate-400">
          {t('filter.bedrooms')}
        </legend>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {(['bedroomsMin', 'bedroomsMax'] as const).map((key, i) => (
            <Select
              key={key}
              aria-label={`${t('filter.bedrooms')} ${i === 0 ? t('common.min') : t('common.max')}`}
              value={filters[key] ?? ''}
              onChange={(e) => set(key, e.target.value === '' ? undefined : Number(e.target.value))}
            >
              <option value="">{i === 0 ? t('common.min') : t('common.max')}</option>
              {ROOMS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          ))}
        </div>
      </fieldset>

      {(
        [
          ['filter.area', 'areaMin', 'areaMax', 1],
          ['filter.price', 'priceMin', 'priceMax', 1_000_000],
        ] as const
      ).map(([labelKey, minKey, maxKey, scale]) => (
        <fieldset key={labelKey}>
          <legend className="text-xs font-medium text-slate-600 dark:text-slate-400">
            {t(labelKey)}
          </legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {([minKey, maxKey] as const).map((key, i) => (
              <NumberField
                key={key}
                label={`${t(labelKey)} ${i === 0 ? t('common.min') : t('common.max')}`}
                placeholder={i === 0 ? t('common.min') : t('common.max')}
                value={filters[key] === undefined ? undefined : filters[key] / scale}
                onCommit={(text) => set(key, num(text, scale))}
              />
            ))}
          </div>
        </fieldset>
      ))}

      <label className="block">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
          {t('filter.deliveryBy')}
        </span>
        <Select
          className="mt-1"
          value={filters.deliveryYearMax ?? ''}
          onChange={(e) =>
            set('deliveryYearMax', e.target.value === '' ? undefined : Number(e.target.value))
          }
        >
          <option value="">{t('common.any')}</option>
          {Array.from({ length: 9 }, (_, i) => thisYear + i).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
            {t('filter.downPaymentMax')}
          </span>
          <NumberField
            className="mt-1"
            value={filters.downPaymentMax}
            onCommit={(text) => set('downPaymentMax', num(text))}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
            {t('filter.installmentYearsMin')}
          </span>
          <NumberField
            className="mt-1"
            value={filters.installmentYearsMin}
            onCommit={(text) => set('installmentYearsMin', num(text))}
          />
        </label>
      </div>

      <MultiPick
        label={t('filter.finishing')}
        options={fixed(FINISHING_SPECS)}
        selected={filters.finishing ?? []}
        onChange={(v) => set('finishing', v as SearchFilters['finishing'])}
      />

      <div className="space-y-1.5 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filters.readyToMove === true}
            onChange={(e) => set('readyToMove', e.target.checked ? true : undefined)}
          />
          {t('filter.readyToMove')}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filters.priceDropped === true}
            onChange={(e) => set('priceDropped', e.target.checked ? true : undefined)}
          />
          {t('filter.priceDropped')}
        </label>
      </div>

      <fieldset>
        <legend className="text-xs font-medium text-slate-600 dark:text-slate-400">
          {t('filter.status')}
        </legend>
        <div className="mt-1 space-y-1 text-sm">
          {VISIBLE_STATUSES.map((status) => {
            const chosen = filters.statuses ?? ['active'];
            return (
              <label key={status} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={chosen.includes(status)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...chosen, status]
                      : chosen.filter((s) => s !== status);
                    set(
                      'statuses',
                      next.length === 0 || (next.length === 1 && next[0] === 'active')
                        ? undefined
                        : next,
                    );
                  }}
                />
                {t(`status.${status}`)}
              </label>
            );
          })}
        </div>
      </fieldset>

      <Button
        variant="secondary"
        className="w-full"
        onClick={() => onChange(filters.sort ? { sort: filters.sort } : {})}
      >
        {t('search.clear')}
      </Button>
    </div>
  );
}

/** A number box that applies its value when you leave it or press Enter, and follows outside changes (Clear filters). */
function NumberField({
  value,
  onCommit,
  label,
  placeholder,
  className,
}: {
  value: number | undefined;
  onCommit: (text: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => setText(value === undefined ? '' : String(value)), [value]);
  return (
    <Input
      className={className}
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(text)}
      onKeyDown={(e) => e.key === 'Enter' && onCommit(text)}
    />
  );
}
