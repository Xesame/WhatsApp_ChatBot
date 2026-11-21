import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CASH_DISCOUNT_TYPES,
  CATEGORIES,
  CURRENCIES,
  FINISHING_SPECS,
  INSTALLMENT_FREQUENCIES,
  MAINTENANCE_CURRENCIES,
  UNIT_TYPES,
} from '@reb/schema/enums';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { api, type Entity, type EntityKind, type UnitView } from '../api.ts';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  formatDate,
  formatMoney,
  Input,
  Label,
  Loading,
  PageTitle,
  Select,
} from '../ui.tsx';
import { afterReview, rememberedSpellings, unitStateLabel } from './learning.ts';
import { LearnControls, useEntities } from './ReviewLearning.tsx';

/**
 * Side-by-side review: the original message (and its flyer or PDF) on the
 * left, the extracted unit on the right. Every change is kept as a
 * correction, and corrections become accuracy test cases
 * (`pnpm eval:from-review`).
 */

type Kind =
  | 'text'
  | 'int'
  | 'number'
  | 'money'
  | 'bool'
  | { options: readonly string[] }
  | { entity: EntityKind };
interface FieldDef {
  key: string;
  label: string;
  kind: Kind;
}

const SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Where',
    fields: [
      { key: 'projectId', label: 'Project', kind: { entity: 'project' } },
      { key: 'developerId', label: 'Developer', kind: { entity: 'developer' } },
      { key: 'cityId', label: 'City / area', kind: { entity: 'city' } },
    ],
  },
  {
    title: 'Unit',
    fields: [
      { key: 'category', label: 'Category', kind: { options: CATEGORIES } },
      { key: 'unitType', label: 'Unit type', kind: { options: UNIT_TYPES } },
      { key: 'bedrooms', label: 'Bedrooms', kind: 'int' },
      { key: 'bathrooms', label: 'Bathrooms', kind: 'int' },
      { key: 'unitCode', label: 'Unit code', kind: 'text' },
      { key: 'floor', label: 'Floor', kind: 'text' },
      { key: 'finishingSpecs', label: 'Finishing', kind: { options: FINISHING_SPECS } },
    ],
  },
  {
    title: 'Size (m²)',
    fields: [
      { key: 'minArea', label: 'Area from', kind: 'number' },
      { key: 'maxArea', label: 'Area to', kind: 'number' },
      { key: 'landArea', label: 'Land', kind: 'number' },
      { key: 'gardenArea', label: 'Garden', kind: 'number' },
      { key: 'outdoorArea', label: 'Roof / terrace', kind: 'number' },
    ],
  },
  {
    title: 'Price and delivery',
    fields: [
      { key: 'priceCurrency', label: 'Currency', kind: { options: CURRENCIES } },
      { key: 'minPrice', label: 'Price from', kind: 'money' },
      { key: 'maxPrice', label: 'Price to', kind: 'money' },
      { key: 'deliveryYear', label: 'Delivery year', kind: 'int' },
      { key: 'readyToMove', label: 'Ready to move', kind: 'bool' },
    ],
  },
  {
    title: 'Payment plan',
    fields: [
      { key: 'downPayment', label: 'Down payment %', kind: 'number' },
      { key: 'downPaymentAmount', label: 'Down payment amount', kind: 'money' },
      { key: 'installmentYears', label: 'Installment years', kind: 'number' },
      { key: 'installmentsCount', label: 'Number of installments', kind: 'int' },
      { key: 'installmentFrequency', label: 'Paid', kind: { options: INSTALLMENT_FREQUENCIES } },
      { key: 'maintenance', label: 'Maintenance', kind: 'number' },
      {
        key: 'maintenanceCurrency',
        label: 'Maintenance in',
        kind: { options: MAINTENANCE_CURRENCIES },
      },
      { key: 'cashDiscount', label: 'Cash discount', kind: 'number' },
      { key: 'cashDiscountType', label: 'Discount type', kind: { options: CASH_DISCOUNT_TYPES } },
      { key: 'cashDiscountCurrency', label: 'Discount currency', kind: { options: CURRENCIES } },
    ],
  },
  { title: 'Notes', fields: [{ key: 'notes', label: 'Notes', kind: 'text' }] },
];
const FIELDS = SECTIONS.flatMap((s) => s.fields);

/** Stored value → text in the form (money: piastres → pounds). */
function toInput(kind: Kind, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (kind === 'money') return String((value as number) / 100);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

/** Text in the form → stored value; throws on a value that isn't a number. */
function fromInput(def: FieldDef, text: string): unknown {
  const t = text.trim();
  if (def.kind === 'bool') return t === 'true';
  if (t === '') return def.key === 'priceCurrency' ? 'EGP' : null;
  if (def.kind === 'text' || (typeof def.kind === 'object' && 'options' in def.kind)) return t;
  const n = Number(t.replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new Error(`${def.label}: "${text}" is not a number`);
  if (def.kind === 'money') return Math.round(n * 100);
  return n;
}

export function Review() {
  const queryClient = useQueryClient();
  const [afterId, setAfterId] = useState<number | undefined>(undefined);
  // `/review?unit=123` opens that one unit (linked from Places & names).
  const [params, setParams] = useSearchParams();
  // The short "Approved ✓" message lives here, not in the unit, because the
  // unit on screen changes as soon as a decision is saved.
  const [notice, setNotice] = useState<string | null>(null);
  const wanted = Number(params.get('unit')) || undefined;
  const queue = useQuery({
    queryKey: ['review', afterId, wanted],
    queryFn: async () => {
      if (wanted) {
        const unit = await api<UnitView>(`/api/admin/units/${wanted}`);
        return { items: [unit], remaining: unit.unit.needsReview ? 1 : 0 };
      }
      return api<{ items: UnitView[]; remaining: number }>(
        `/api/admin/review?limit=1${afterId ? `&afterId=${afterId}` : ''}`,
      );
    },
  });
  const item = queue.data?.items[0];

  return (
    <>
      <PageTitle
        title="Review"
        subtitle={
          queue.data && !wanted
            ? `${queue.data.remaining} unit(s) waiting. Oldest first.`
            : undefined
        }
        actions={
          <div className="flex gap-2">
            {wanted && (
              <Button
                variant="secondary"
                onClick={() => {
                  setNotice(null);
                  setParams({});
                }}
              >
                Back to the queue
              </Button>
            )}
            {!wanted && afterId !== undefined && (
              <Button
                variant="secondary"
                onClick={() => {
                  setNotice(null);
                  setAfterId(undefined);
                }}
              >
                Back to first
              </Button>
            )}
            {item && !wanted && (
              <Button
                variant="secondary"
                onClick={() => {
                  setNotice(null);
                  setAfterId(item.unit.id);
                }}
              >
                Skip
              </Button>
            )}
          </div>
        }
      />
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
        >
          {notice}
        </p>
      )}
      {queue.isPending && <Loading />}
      <ErrorNote error={queue.error} />
      {queue.data && !item && (
        <Card>
          <p className="text-sm">
            {afterId ? 'No more units after this one.' : 'Nothing to review. 🎉'}
          </p>
        </Card>
      )}
      {item && (
        <ReviewItem
          key={item.unit.id}
          view={item}
          onDone={(action) => {
            const next = afterReview(action, Boolean(wanted));
            setNotice(next.message);
            if (next.backToQueue) setParams({});
            // The save may have re-checked other waiting units (fresh queue) and
            // learned a spelling (fresh name lists, so it isn't offered again).
            void queryClient.invalidateQueries({ queryKey: ['review'] });
            void queryClient.invalidateQueries({ queryKey: ['stats'] });
            void queryClient.invalidateQueries({ queryKey: ['entities'] });
          }}
        />
      )}
    </>
  );
}

function ReviewItem({
  view,
  onDone,
}: {
  view: UnitView;
  onDone: (action: 'save' | 'approve' | 'reject') => void;
}) {
  const { unit } = view;
  const initial = useMemo(
    () => Object.fromEntries(FIELDS.map((f) => [f.key, toInput(f.kind, unit[f.key])])),
    [unit],
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => setValues(initial), [initial]);

  // Spellings offered for remembering are ticked unless the person unticks them.
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setUnticked((old) => {
      const next = new Set(old);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const lists = {
    project: useEntities('project').data,
    developer: useEntities('developer').data,
    city: useEntities('city').data,
  };
  /** The ticked spellings to send along with the save. */
  const remembered = () =>
    rememberedSpellings({ values, initial, lists, written: view.learning.written, unticked });

  const review = useMutation({
    mutationFn: (action: 'save' | 'approve' | 'reject') => {
      const changes: Record<string, unknown> = {};
      for (const def of FIELDS) {
        if (values[def.key] !== initial[def.key])
          changes[def.key] = fromInput(def, values[def.key] ?? '');
      }
      const remember = remembered();
      return api(`/api/admin/units/${unit.id}/review`, {
        method: 'POST',
        body: { action, changes, ...(remember.length > 0 ? { remember } : {}) },
      });
    },
    onSuccess: (_data, action) => onDone(action),
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });
  const run = (action: 'save' | 'approve' | 'reject') => {
    setFormError(null);
    try {
      review.mutate(action);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    }
  };
  const changed = FIELDS.filter((f) => values[f.key] !== initial[f.key]).length;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        {view.sources.map((s) => (
          <Card
            key={`${s.messageId}-${s.role}`}
            title={<span dir="auto">{s.groupName ?? 'Group'}</span>}
            actions={
              <span className="flex items-center gap-2 text-xs text-slate-500">
                <Badge tone={s.role === 'listing' ? 'blue' : 'amber'}>
                  {s.role.replace('_', ' ')}
                </Badge>
                {formatDate(s.sentAt)}
              </span>
            }
          >
            {s.media && <MediaPreview media={s.media} />}
            {s.text ? (
              <p dir="auto" className="whitespace-pre-wrap text-sm leading-relaxed">
                {s.text}
              </p>
            ) : (
              !s.media && <p className="text-sm italic text-slate-500">No text</p>
            )}
          </Card>
        ))}
        {view.prices.length > 0 && (
          <Card title="Price history">
            <ul className="space-y-1 text-sm">
              {view.prices.map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <span className="text-slate-500">{formatDate(p.observedAt)}</span>
                  <span>
                    {formatMoney(p.minPrice, p.priceCurrency)}
                    {p.maxPrice !== p.minPrice && ` – ${formatMoney(p.maxPrice, p.priceCurrency)}`}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <Card
        title={`Unit #${unit.id}`}
        actions={
          <span className="flex items-center gap-2">
            <Badge
              tone={unit.confidence >= 0.8 ? 'green' : unit.confidence >= 0.5 ? 'amber' : 'red'}
            >
              confidence {Math.round(unit.confidence * 100)}%
            </Badge>
            <Badge>{unit.status}</Badge>
            {unitStateLabel(unit) && <Badge tone="amber">{unitStateLabel(unit)}</Badge>}
          </span>
        }
      >
        {unit.reviewReasons.length > 0 && (
          <ul className="mb-4 list-disc space-y-1 rounded-md bg-amber-50 py-2 pr-3 pl-7 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {unit.reviewReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        <div className="space-y-4">
          {SECTIONS.map((section) => (
            <fieldset key={section.title}>
              <legend className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                {section.title}
              </legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {section.fields.map((def) => (
                  <Field
                    key={def.key}
                    def={def}
                    value={values[def.key] ?? ''}
                    changed={values[def.key] !== initial[def.key]}
                    onChange={(v) => setValues((old) => ({ ...old, [def.key]: v }))}
                    below={
                      typeof def.kind === 'object' && 'entity' in def.kind ? (
                        <LearnControls
                          kind={def.kind.entity}
                          view={view}
                          value={values[def.key] ?? ''}
                          loadedValue={initial[def.key] ?? ''}
                          entities={lists[def.kind.entity]}
                          unticked={unticked}
                          onToggle={toggle}
                          onPick={(id) => setValues((old) => ({ ...old, [def.key]: String(id) }))}
                          onPickOther={(kind, id) =>
                            setValues((old) => ({
                              ...old,
                              [kind === 'developer' ? 'developerId' : 'cityId']: String(id),
                            }))
                          }
                          defaults={{
                            developerId: values.developerId ?? '',
                            cityId: values.cityId ?? '',
                          }}
                        />
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Prices and amounts in whole pounds or dollars. Empty means “not stated”.
        </p>
        <div className="mt-4 space-y-3">
          <ErrorNote error={formError} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={review.isPending} onClick={() => run('approve')}>
              {changed > 0 ? `Save ${changed} change(s) and approve` : 'Approve'}
            </Button>
            <Button
              variant="secondary"
              disabled={review.isPending || changed === 0}
              onClick={() => run('save')}
            >
              Save only
            </Button>
            <Button variant="secondary" disabled={changed === 0} onClick={() => setValues(initial)}>
              Undo changes
            </Button>
            <Button
              variant="danger"
              className="ml-auto"
              disabled={review.isPending}
              onClick={() => run('reject')}
            >
              Not a listing
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function MediaPreview({ media }: { media: NonNullable<UnitView['sources'][number]['media']> }) {
  const url = `/api/admin/media/${media.id}`;
  return (
    <div className="mb-3 space-y-2">
      {media.status !== 'downloaded' ? (
        <p className="text-sm text-slate-500">File not available ({media.status}).</p>
      ) : media.kind === 'image' ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt="Flyer from the message"
            className="max-h-[32rem] w-full rounded border border-slate-200 object-contain dark:border-slate-800"
          />
        </a>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className="text-sm underline">
          Open the {media.mimeType?.includes('pdf') ? 'PDF' : 'file'}
        </a>
      )}
      {media.derivedText && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-500">
            Text read from the file ({media.derivedMethod ?? 'unknown method'})
          </summary>
          <pre
            dir="auto"
            className="mt-2 max-h-80 overflow-auto rounded bg-slate-50 p-2 text-xs whitespace-pre-wrap dark:bg-slate-950"
          >
            {media.derivedText}
          </pre>
        </details>
      )}
    </div>
  );
}

function Field({
  def,
  value,
  changed,
  onChange,
  below,
}: {
  def: FieldDef;
  value: string;
  changed: boolean;
  onChange: (v: string) => void;
  below?: ReactNode;
}) {
  const ring = changed ? 'border-sky-500 ring-2 ring-sky-100 dark:ring-sky-900' : '';
  const wide = def.key === 'notes' || def.key === 'projectId' ? 'col-span-2 sm:col-span-3' : '';
  let control;
  if (def.kind === 'bool') {
    control = (
      <Select className={ring} value={value || 'false'} onChange={(e) => onChange(e.target.value)}>
        <option value="false">No</option>
        <option value="true">Yes</option>
      </Select>
    );
  } else if (typeof def.kind === 'object' && 'options' in def.kind) {
    control = (
      <Select className={ring} value={value} onChange={(e) => onChange(e.target.value)}>
        {def.key !== 'priceCurrency' && <option value="">—</option>}
        {def.kind.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    );
  } else if (typeof def.kind === 'object') {
    control = (
      <EntitySelect kind={def.kind.entity} className={ring} value={value} onChange={onChange} />
    );
  } else {
    control = (
      <Input
        className={ring}
        dir="auto"
        inputMode={def.kind === 'text' ? 'text' : 'decimal'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <div className={wide}>
      <Label text={def.label}>{control}</Label>
      {below}
    </div>
  );
}

function EntitySelect({
  kind,
  value,
  onChange,
  className,
}: {
  kind: EntityKind;
  value: string;
  onChange: (v: string) => void;
  className: string;
}) {
  const list = useQuery({
    queryKey: ['entities', kind, ''],
    queryFn: () => api<Entity[]>(`/api/admin/entities/${kind}`),
    staleTime: 60_000,
  });
  return (
    <Select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— unknown —</option>
      {list.data?.map((e) => (
        <option key={e.id} value={e.id}>
          {e.nameEn} · {e.nameAr}
        </option>
      ))}
    </Select>
  );
}
