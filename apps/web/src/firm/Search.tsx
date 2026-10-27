import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { filtersFromQuery, filtersToQuery, SORTS, type SearchFilters } from '@reb/search/filters';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, type FilterOptions, type SearchItem, type SearchPage } from '../api.ts';
import { useI18n, type I18n } from '../i18n.tsx';
import {
  Badge,
  Button,
  Card,
  cx,
  ErrorNote,
  Input,
  Label,
  Loading,
  Select,
  Table,
  td,
} from '../ui.tsx';
import { Filters } from './Filters.tsx';
import { areaText, deliveryText, kindText, paymentText, placeText, priceText } from './format.ts';

const PAGE_SIZE = 25;

function readFilters(params: URLSearchParams): SearchFilters {
  try {
    return filtersFromQuery(Object.fromEntries(params));
  } catch {
    return {}; // a hand-edited address with a bad value starts over
  }
}

/** The firm dashboard's main page: filters, results as a table or cards, export, save. */
export function Search() {
  const i18n = useI18n();
  const { t } = i18n;
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const query = filtersToQuery(filters);
  const [view, setView] = useState<'table' | 'cards'>(() =>
    window.innerWidth < 768 ? 'cards' : 'table',
  );
  const [showFilters, setShowFilters] = useState(false);
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState(filters.q ?? '');
  useEffect(() => setText(filters.q ?? ''), [filters.q]);

  const options = useQuery({
    queryKey: ['options'],
    queryFn: () => api<FilterOptions>('/api/app/options'),
    staleTime: 5 * 60_000,
  });
  const results = useQuery({
    queryKey: ['listings', query, page],
    queryFn: () =>
      api<SearchPage>(
        `/api/app/listings?${query}${query ? '&' : ''}page=${page}&pageSize=${PAGE_SIZE}`,
      ),
    placeholderData: keepPreviousData,
  });

  const apply = (next: SearchFilters) => setParams(new URLSearchParams(filtersToQuery(next)));
  const setPage = (p: number) => {
    const next = new URLSearchParams(query);
    if (p > 1) next.set('page', String(p));
    setParams(next);
    window.scrollTo({ top: 0 });
  };
  const submitText = () => {
    const q = text.trim();
    const next = { ...filters };
    if (q) next.q = q;
    else delete next.q;
    apply(next);
  };
  const total = results.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className={cx('lg:block', showFilters ? 'block' : 'hidden')}>
        <Card>
          <Filters filters={filters} options={options.data} onChange={apply} />
        </Card>
      </aside>

      <section className="min-w-0 space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitText();
          }}
        >
          <Input
            type="search"
            dir="auto"
            placeholder={t('search.placeholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={submitText}
          />
          <Button type="submit">{t('nav.search')}</Button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            className="lg:hidden"
            onClick={() => setShowFilters(!showFilters)}
          >
            {t('search.filters')}
          </Button>
          <p className="text-sm font-medium">
            {results.data
              ? total === 1
                ? t('search.oneResult')
                : t('search.results', { n: i18n.number(total) })
              : ''}
          </p>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Select
              aria-label={t('search.sort')}
              className="w-auto"
              value={filters.sort ?? 'newest'}
              onChange={(e) => apply({ ...filters, sort: e.target.value as SearchFilters['sort'] })}
            >
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`sort.${s}`)}
                </option>
              ))}
            </Select>
            <div className="flex rounded-md border border-slate-300 dark:border-slate-700">
              {(['table', 'cards'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={cx(
                    'px-2.5 py-1.5 text-sm',
                    view === v && 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900',
                  )}
                >
                  {t(v === 'table' ? 'search.table' : 'search.cards')}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={() => setSaving(true)}>
              {t('search.save')}
            </Button>
            <a
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              href={`/api/app/export?${query}`}
            >
              ⬇ {t('search.export')}
            </a>
            <a
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              href={`/api/app/export?${query}${query ? '&' : ''}format=csv`}
            >
              ⬇ {t('search.exportCsv')}
            </a>
          </div>
        </div>

        {saving && <SaveSearch filters={filters} onClose={() => setSaving(false)} />}
        {results.isPending && <Loading />}
        <ErrorNote error={results.error} />
        {results.data?.items.length === 0 && (
          <Card>
            <p className="text-sm">{t('search.none')}</p>
          </Card>
        )}
        {results.data && results.data.items.length > 0 && (
          <div className={cx(results.isPlaceholderData && 'opacity-60')}>
            {view === 'table' ? (
              <ResultsTable items={results.data.items} />
            ) : (
              <ResultCards items={results.data.items} />
            )}
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 text-sm">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t('search.prev')}
            </Button>
            <span>{t('search.page', { page, pages })}</span>
            <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              {t('search.next')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function Flags({ item, i18n }: { item: SearchItem; i18n: I18n }) {
  return (
    <span className="flex flex-wrap gap-1">
      {item.previousMinPrice !== null &&
        item.minPrice !== null &&
        item.minPrice < item.previousMinPrice && (
          <Badge tone="green">↓ {i18n.t('unit.priceDropped')}</Badge>
        )}
      {item.status !== 'active' && (
        <Badge tone={item.status === 'sold' ? 'red' : 'amber'}>
          {i18n.t(`status.${item.status as 'sold'}`)}
        </Badge>
      )}
      {item.priceCurrency === 'USD' && <Badge tone="blue">{i18n.t('unit.usd')}</Badge>}
      {item.sourceCount > 1 && <Badge>{i18n.t('unit.reposted', { n: item.sourceCount })}</Badge>}
    </span>
  );
}

function ResultsTable({ items }: { items: SearchItem[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <Card className="p-0">
      <Table
        head={[
          t('col.listing'),
          t('col.type'),
          t('col.area'),
          t('col.price'),
          t('col.ppsqm'),
          t('col.delivery'),
          t('col.payment'),
          t('col.seen'),
        ]}
      >
        {items.map((item) => (
          <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td className={td}>
              <Link to={`/app/listings/${item.id}`} className="font-medium hover:underline">
                {i18n.name(item.project)}
              </Link>
              <div className="text-xs text-slate-500">
                {[item.developer, item.city]
                  .filter(Boolean)
                  .map((n) => i18n.name(n))
                  .join(' · ')}
              </div>
              <div className="mt-1">
                <Flags item={item} i18n={i18n} />
              </div>
            </td>
            <td className={td}>{kindText(item, i18n)}</td>
            <td className={`${td} whitespace-nowrap`}>{areaText(item, i18n)}</td>
            <td className={`${td} whitespace-nowrap font-medium tabular-nums`}>
              {priceText(item, i18n)}
            </td>
            <td className={`${td} whitespace-nowrap tabular-nums`}>
              {item.pricePerSqm === null ? '—' : i18n.number(item.pricePerSqm)}
            </td>
            <td className={td}>{deliveryText(item, i18n)}</td>
            <td className={td}>{paymentText(item, i18n)}</td>
            <td className={`${td} whitespace-nowrap text-slate-500`}>
              {i18n.date(item.lastSeenAt)}
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function ResultCards({ items }: { items: SearchItem[] }) {
  const i18n = useI18n();
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <Link key={item.id} to={`/app/listings/${item.id}`} className="block">
          <Card className="h-full transition hover:border-slate-400">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{i18n.name(item.project)}</p>
                <p className="truncate text-xs text-slate-500">
                  {placeText({ project: item.developer, city: item.city }, i18n)}
                </p>
              </div>
              <p className="whitespace-nowrap text-lg font-semibold tabular-nums">
                {priceText(item, i18n)}
              </p>
            </div>
            <p className="mt-2 text-sm">
              {kindText(item, i18n)} · {areaText(item, i18n)}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {deliveryText(item, i18n)} · {paymentText(item, i18n)}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Flags item={item} i18n={i18n} />
              {item.pricePerSqm !== null && (
                <span className="text-xs whitespace-nowrap text-slate-500 tabular-nums">
                  {i18n.number(item.pricePerSqm)} / {i18n.t('common.m2')}
                </span>
              )}
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function SaveSearch({ filters, onClose }: { filters: SearchFilters; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<'none' | 'whatsapp' | 'telegram'>('whatsapp');
  const save = useMutation({
    mutationFn: () =>
      api('/api/app/saved-searches', {
        method: 'POST',
        body: { name, filters, alertChannel: channel, active: true },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['saved'] });
      onClose();
    },
  });
  return (
    <Card title={t('search.save')}>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Label text={t('saved.name')}>
          <Input
            required
            autoFocus
            dir="auto"
            placeholder={t('saved.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Label>
        <Label text={t('saved.alerts')}>
          <Select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
            {(['whatsapp', 'telegram', 'none'] as const).map((c) => (
              <option key={c} value={c}>
                {t(`channel.${c}`)}
              </option>
            ))}
          </Select>
        </Label>
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {t('common.save')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
      <p className="mt-2 text-xs text-slate-500">{t('saved.alertsSoon')}</p>
      <ErrorNote error={save.error} />
    </Card>
  );
}
