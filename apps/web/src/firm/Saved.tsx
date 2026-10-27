import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { filtersToQuery, type SearchFilters } from '@reb/search/filters';
import { Link } from 'react-router';
import { api, type FilterOptions, type SavedSearch } from '../api.ts';
import { useI18n, type I18n } from '../i18n.tsx';
import { Badge, Button, Card, ErrorNote, Loading, Select } from '../ui.tsx';

/** Readable chips for a saved filter set ("Mivida", "3+ rooms", "up to 8M"). */
export function describeFilters(
  f: SearchFilters,
  options: FilterOptions | undefined,
  i18n: I18n,
): string[] {
  const { t } = i18n;
  const names = (
    ids: number[] | undefined,
    list: { id: number; en: string; ar: string }[] | undefined,
  ) => (ids ?? []).map((id) => i18n.name(list?.find((e) => e.id === id) ?? null));
  const chips = [
    ...(f.q ? [`“${f.q}”`] : []),
    ...names(f.projectIds, options?.projects),
    ...names(f.developerIds, options?.developers),
    ...names(f.cityIds, options?.cities),
    ...(f.unitTypes ?? []).map((v) => i18n.value(v)),
    ...(f.categories ?? []).map((v) => i18n.value(v)),
  ];
  const range = (
    label: string,
    min: number | undefined,
    max: number | undefined,
    show: (n: number) => string,
  ) => {
    if (min !== undefined && max !== undefined) chips.push(`${label} ${show(min)} – ${show(max)}`);
    else if (min !== undefined) chips.push(`${label} ≥ ${show(min)}`);
    else if (max !== undefined) chips.push(`${label} ≤ ${show(max)}`);
  };
  range(t('filter.bedrooms'), f.bedroomsMin, f.bedroomsMax, String);
  range(t('col.area'), f.areaMin, f.areaMax, (n) => `${i18n.number(n)} ${t('common.m2')}`);
  range(t('col.price'), f.priceMin, f.priceMax, (n) => i18n.money(n));
  if (f.deliveryYearMax) chips.push(`${t('filter.deliveryBy')} ${f.deliveryYearMax}`);
  if (f.readyToMove) chips.push(t('unit.readyToMove'));
  if (f.priceDropped) chips.push(t('unit.priceDropped'));
  if (f.downPaymentMax !== undefined)
    chips.push(`${t('field.downPayment')} ≤ ${f.downPaymentMax}%`);
  if (f.installmentYearsMin !== undefined)
    chips.push(`${t('field.installments')} ≥ ${t('common.years', { n: f.installmentYearsMin })}`);
  return chips;
}

export function Saved() {
  const i18n = useI18n();
  const { t } = i18n;
  const queryClient = useQueryClient();
  const saved = useQuery({
    queryKey: ['saved'],
    queryFn: () => api<SavedSearch[]>('/api/app/saved-searches'),
  });
  const options = useQuery({
    queryKey: ['options'],
    queryFn: () => api<FilterOptions>('/api/app/options'),
    staleTime: 5 * 60_000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['saved'] });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: number; alertChannel?: string; active?: boolean }) =>
      api(`/api/app/saved-searches/${id}`, { method: 'PATCH', body }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/api/app/saved-searches/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('saved.title')}</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('saved.alertsSoon')}</p>
      {saved.isPending && <Loading />}
      <ErrorNote error={saved.error ?? update.error ?? remove.error} />
      {saved.data?.length === 0 && (
        <Card>
          <p className="text-sm">{t('saved.empty')}</p>
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {saved.data?.map((s) => (
          <Card
            key={s.id}
            title={<span dir="auto">{s.name}</span>}
            actions={
              <Badge tone={s.active ? 'green' : 'gray'}>
                {s.active ? t('saved.active') : t('saved.paused')}
              </Badge>
            }
          >
            {!s.mine && s.ownerName && (
              <p className="mb-2 text-xs text-slate-500">{t('saved.by', { name: s.ownerName })}</p>
            )}
            <div className="mb-3 flex flex-wrap gap-1">
              {describeFilters(s.filters as SearchFilters, options.data, i18n).map((chip) => (
                <Badge key={chip}>{chip}</Badge>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/app?${filtersToQuery(s.filters)}`}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
              >
                {t('saved.open')}
              </Link>
              <Select
                aria-label={t('saved.alerts')}
                className="w-auto"
                value={s.alertChannel}
                onChange={(e) => update.mutate({ id: s.id, alertChannel: e.target.value })}
              >
                {(['whatsapp', 'telegram', 'none'] as const).map((c) => (
                  <option key={c} value={c}>
                    {t(`channel.${c}`)}
                  </option>
                ))}
              </Select>
              <Button
                variant="secondary"
                onClick={() => update.mutate({ id: s.id, active: !s.active })}
              >
                {s.active ? t('saved.paused') : t('saved.active')}
              </Button>
              <Button
                variant="ghost"
                className="ms-auto text-red-600"
                onClick={() => remove.mutate(s.id)}
              >
                {t('common.delete')}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
