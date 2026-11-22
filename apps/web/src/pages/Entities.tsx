import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { Link } from 'react-router';
import { api, type Entity, type EntityKind } from '../api.ts';
import { inlineKeyAction, newEntityOption, recheckMessage, type Recheck } from './learning.ts';
import {
  Badge,
  Button,
  Card,
  cx,
  ErrorNote,
  Input,
  Label,
  Loading,
  Note,
  PageTitle,
  Select,
} from '../ui.tsx';

const KINDS: { kind: EntityKind; label: string }[] = [
  { kind: 'project', label: 'Projects' },
  { kind: 'developer', label: 'Developers' },
  { kind: 'city', label: 'Cities & areas' },
];

/**
 * The names the system recognises. Adding a spelling here ("ميفيدا",
 * "mivida", "MV") makes future messages using it match; merging removes a
 * duplicate that was created by mistake.
 */
export function Entities() {
  const [kind, setKind] = useState<EntityKind>('project');
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['entities', kind, search],
    queryFn: () =>
      api<Entity[]>(
        `/api/admin/entities/${kind}${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`,
      ),
  });
  // After a change the server checks waiting units again; its counts are shown here.
  const [recheck, setRecheck] = useState<Recheck | null>(null);
  const changed = async (result: unknown) => {
    const counts = (result as { recheck?: Recheck } | null | undefined)?.recheck;
    if (counts) setRecheck(counts);
    // Waiting units may have been fixed: refresh the review queue and counts too.
    void queryClient.invalidateQueries({ queryKey: ['review'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
    await queryClient.invalidateQueries({ queryKey: ['entities'] });
  };

  return (
    <>
      <PageTitle
        title="Places & names"
        subtitle="Projects, developers and areas, with every spelling that should be recognised as each."
      />
      {recheck && (
        <Note tone="success" className="mb-4">
          {recheckMessage(recheck)}
        </Note>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {KINDS.map((k) => (
          <Button
            key={k.kind}
            variant={k.kind === kind ? 'primary' : 'secondary'}
            onClick={() => setKind(k.kind)}
          >
            {k.label}
          </Button>
        ))}
        <Input
          className="ms-auto w-56"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {list.isPending && <Loading />}
          <ErrorNote error={list.error} />
          {list.data?.map((entity) => (
            <EntityCard key={entity.id} kind={kind} entity={entity} onChange={changed} />
          ))}
          {list.data?.length === 0 && (
            <p className="text-sm text-muted">
              Nothing found. Try another search, or add it with the form on the side.
            </p>
          )}
        </div>
        <CreateEntity kind={kind} onCreated={(_id, counts) => changed({ recheck: counts })} />
      </div>
    </>
  );
}

function EntityCard({
  kind,
  entity,
  onChange,
}: {
  kind: EntityKind;
  entity: Entity;
  /** Called with the server's answer (it carries the re-check counts). */
  onChange: (result: unknown) => Promise<void>;
}) {
  const [alias, setAlias] = useState('');
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState({ nameEn: entity.nameEn, nameAr: entity.nameAr });
  const [mergeInto, setMergeInto] = useState('');
  const others = useQuery({
    queryKey: ['entities', kind, ''],
    queryFn: () => api<Entity[]>(`/api/admin/entities/${kind}`),
    enabled: mergeInto !== '' || editing,
  });

  const call = useMutation({
    mutationFn: (request: { path: string; method: string; body?: unknown }) =>
      api(request.path, request),
    onSuccess: (result) => onChange(result),
  });
  const base = `/api/admin/entities/${kind}/${entity.id}`;

  const addAlias = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!alias.trim()) return;
    call.mutate(
      { path: `${base}/aliases`, method: 'POST', body: { alias } },
      { onSuccess: () => setAlias('') },
    );
  };

  return (
    <Card
      title={
        <span>
          {entity.nameEn}{' '}
          <span dir="rtl" className="font-normal text-muted">
            · {entity.nameAr}
          </span>
        </span>
      }
      actions={
        <span className="flex items-center gap-2">
          <Badge>{entity.unitCount} units</Badge>
          <Button variant="quiet" size="sm" onClick={() => setEditing(!editing)}>
            {editing ? 'Close' : 'Edit'}
          </Button>
        </span>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {entity.aliases.map((a) => (
          <span
            key={a.id}
            className={cx(
              'inline-flex items-center gap-1 rounded-control border px-2 py-0.5 text-xs',
              a.source === 'seed'
                ? 'border-line bg-bone'
                : 'border-lime-ink/40 bg-lime-soft text-lime-ink',
            )}
          >
            <span dir="auto">{a.alias}</span>
            {a.source === 'review' && a.reviewUnitId !== null && (
              <Link
                to={`/review?unit=${a.reviewUnitId}`}
                className="text-muted underline hover:text-ink"
              >
                from review of unit {a.reviewUnitId}
              </Link>
            )}
            {editing && (
              <button
                type="button"
                aria-label={`Remove ${a.alias}`}
                className="text-muted hover:text-danger-ink"
                onClick={() =>
                  call.mutate({ path: `/api/admin/aliases/${a.id}`, method: 'DELETE' })
                }
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={addAlias}>
        <Input
          dir="auto"
          placeholder="Add a spelling, e.g. ميفيدا or MV"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={call.isPending}>
          Add
        </Button>
      </form>
      {editing && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <div className="grid grid-cols-2 gap-2">
            <Label text="English name">
              <Input
                value={names.nameEn}
                onChange={(e) => setNames({ ...names, nameEn: e.target.value })}
              />
            </Label>
            <Label text="Arabic name">
              <Input
                dir="rtl"
                value={names.nameAr}
                onChange={(e) => setNames({ ...names, nameAr: e.target.value })}
              />
            </Label>
          </div>
          <Button
            variant="secondary"
            disabled={call.isPending}
            onClick={() => call.mutate({ path: base, method: 'PATCH', body: names })}
          >
            Rename, keeping old names as spellings
          </Button>
          <div className="flex items-end gap-2">
            <Label
              text="This is a duplicate of…"
              hint="Its units, projects and spellings move over, then this one is deleted."
            >
              <Select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
                <option value="">Choose</option>
                {others.data
                  ?.filter((o) => o.id !== entity.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nameEn} · {o.nameAr}
                    </option>
                  ))}
              </Select>
            </Label>
            <Button
              variant="danger"
              disabled={!mergeInto || call.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Merge “${entity.nameEn}” into the selected entry? This cannot be undone.`,
                  )
                ) {
                  call.mutate({
                    path: `${base}/merge`,
                    method: 'POST',
                    body: { intoId: Number(mergeInto) },
                  });
                }
              }}
            >
              Merge into it
            </Button>
          </div>
        </div>
      )}
      <div className="mt-2">
        <ErrorNote error={call.error} />
      </div>
    </Card>
  );
}

/**
 * The "add a project / developer / area" form. Also used by the Review page
 * ("+ New project named …"), which passes the written name as `initial` and
 * gets the new id back in `onCreated`.
 */
export function CreateEntity({
  kind,
  onCreated,
  initial,
  title,
  offerNew,
  onRelatedCreated,
}: {
  kind: EntityKind;
  /** Gets the new id, and the re-check counts the server sends back. */
  onCreated: (id: number, recheck?: Recheck) => Promise<void> | void;
  initial?: { nameEn?: string; nameAr?: string; developerId?: string; cityId?: string };
  title?: string;
  /**
   * Review page only: also offer "+ New developer / area" inside a project
   * form. Holds the unit's written names (undefined when it has none).
   * Places & names leaves this out, so its form is unchanged.
   */
  offerNew?: { developer?: string; city?: string };
  /** Called after a developer / area was added from inside this form. */
  onRelatedCreated?: (kind: 'developer' | 'city', id: number) => void;
}) {
  const blank = { nameEn: '', nameAr: '', developerId: '', cityId: '', ...initial };
  const [form, setForm] = useState(blank);
  // Which little "new developer / area" form is open inside this one.
  const [adding, setAdding] = useState<'developer' | 'city' | null>(null);
  const developers = useQuery({
    queryKey: ['entities', 'developer', ''],
    queryFn: () => api<Entity[]>('/api/admin/entities/developer'),
    enabled: kind === 'project',
  });
  const cities = useQuery({
    queryKey: ['entities', 'city', ''],
    queryFn: () => api<Entity[]>('/api/admin/entities/city'),
    enabled: kind === 'project',
  });
  const create = useMutation({
    mutationFn: () =>
      api<{ id: number; recheck?: Recheck }>(`/api/admin/entities/${kind}`, {
        method: 'POST',
        body: {
          nameEn: form.nameEn,
          nameAr: form.nameAr,
          ...(kind === 'project'
            ? { developerId: Number(form.developerId), cityId: Number(form.cityId) }
            : {}),
        },
      }),
    onSuccess: async ({ id, recheck }) => {
      setForm(blank);
      await onCreated(id, recheck);
    },
  });
  const devOption = offerNew
    ? newEntityOption('developer', offerNew.developer, developers.data)
    : null;
  const cityOption = offerNew ? newEntityOption('city', offerNew.city, cities.data) : null;
  const related = (which: 'developer' | 'city') => (id: number) => {
    setForm((f) => ({ ...f, [which === 'developer' ? 'developerId' : 'cityId']: String(id) }));
    setAdding(null);
    onRelatedCreated?.(which, id);
  };
  const label = KINDS.find((k) => k.kind === kind)?.label.toLowerCase() ?? kind;

  return (
    <Card title={title ?? `Add to ${label}`} className="h-fit">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Label text="English name">
          <Input
            required
            value={form.nameEn}
            onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
          />
        </Label>
        <Label text="Arabic name">
          <Input
            required
            dir="rtl"
            value={form.nameAr}
            onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
          />
        </Label>
        {kind === 'project' && (
          <>
            <Label text="Developer">
              <Select
                required
                value={form.developerId}
                onChange={(e) => {
                  if (e.target.value === NEW) setAdding('developer');
                  else setForm({ ...form, developerId: e.target.value });
                }}
              >
                <option value="">Choose</option>
                {devOption && <option value={NEW}>{devOption.label}</option>}
                {developers.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nameEn}
                  </option>
                ))}
              </Select>
            </Label>
            <Label text="City / area">
              <Select
                required
                value={form.cityId}
                onChange={(e) => {
                  if (e.target.value === NEW) setAdding('city');
                  else setForm({ ...form, cityId: e.target.value });
                }}
              >
                <option value="">Choose</option>
                {cityOption && <option value={NEW}>{cityOption.label}</option>}
                {cities.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameEn}
                  </option>
                ))}
              </Select>
            </Label>
            {adding && (
              <AddRelated
                key={adding}
                kind={adding}
                name={(adding === 'developer' ? devOption : cityOption)?.name ?? ''}
                onCreated={related(adding)}
                onCancel={() => setAdding(null)}
              />
            )}
          </>
        )}
        <ErrorNote error={create.error} />
        <Button type="submit" disabled={create.isPending}>
          Add {kind === 'city' ? 'area' : kind}
        </Button>
      </form>
    </Card>
  );
}

/** Value of the "+ New …" choice in the lists (never a real id). */
const NEW = 'new';

/**
 * The small form inside the New project form for a developer or area that
 * does not exist yet. Not a <form> (it sits inside one): it saves with its
 * own button, through the same create call as everywhere else.
 */
function AddRelated({
  kind,
  name,
  onCreated,
  onCancel,
}: {
  kind: 'developer' | 'city';
  name: string;
  onCreated: (id: number) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [nameEn, setNameEn] = useState(name);
  const [nameAr, setNameAr] = useState(name);
  const create = useMutation({
    mutationFn: () =>
      api<{ id: number }>(`/api/admin/entities/${kind}`, {
        method: 'POST',
        body: { nameEn, nameAr },
      }),
    onSuccess: async ({ id }) => {
      // Refresh the lists first so the drop-downs know the new entry.
      await queryClient.invalidateQueries({ queryKey: ['entities'] });
      onCreated(id);
    },
  });
  const word = kind === 'developer' ? 'developer' : 'area';
  // Enter here must never reach the New project form around this box.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const action = inlineKeyAction(e.key, nameEn, nameAr, create.isPending);
    if (e.key === 'Enter' || action === 'cancel') e.preventDefault();
    if (e.key === 'Enter') e.stopPropagation();
    if (action === 'save') create.mutate();
    else if (action === 'cancel') onCancel();
  };
  return (
    <div className="space-y-2 rounded-control border border-line bg-bone p-2">
      <p className="text-xs font-semibold">New {word}</p>
      <Label text="English name">
        <Input value={nameEn} onKeyDown={onKeyDown} onChange={(e) => setNameEn(e.target.value)} />
      </Label>
      <Label text="Arabic name">
        <Input
          dir="rtl"
          value={nameAr}
          onKeyDown={onKeyDown}
          onChange={(e) => setNameAr(e.target.value)}
        />
      </Label>
      <ErrorNote error={create.error} />
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={create.isPending || !nameEn.trim() || !nameAr.trim()}
          onClick={() => create.mutate()}
        >
          Save {word}
        </Button>
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
