import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import { api, type Entity, type EntityKind } from '../api.ts';
import {
  Badge,
  Button,
  Card,
  cx,
  ErrorNote,
  Input,
  Label,
  Loading,
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
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['entities'] });

  return (
    <>
      <PageTitle
        title="Places & names"
        subtitle="Projects, developers and areas, with every spelling that should be recognised as each."
      />
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
          className="ml-auto w-56"
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
            <EntityCard key={entity.id} kind={kind} entity={entity} onChange={refresh} />
          ))}
          {list.data?.length === 0 && <p className="text-sm text-slate-500">Nothing found.</p>}
        </div>
        <CreateEntity kind={kind} onCreated={refresh} />
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
  onChange: () => Promise<void>;
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
    onSuccess: () => onChange(),
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
          <span dir="rtl" className="font-normal text-slate-500">
            · {entity.nameAr}
          </span>
        </span>
      }
      actions={
        <span className="flex items-center gap-2">
          <Badge>{entity.unitCount} units</Badge>
          <Button variant="ghost" onClick={() => setEditing(!editing)}>
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
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
              a.source === 'seed'
                ? 'border-slate-200 dark:border-slate-700'
                : 'border-sky-300 dark:border-sky-800',
            )}
          >
            <span dir="auto">{a.alias}</span>
            {editing && (
              <button
                type="button"
                aria-label={`Remove ${a.alias}`}
                className="text-slate-400 hover:text-red-600"
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
        <div className="mt-4 space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800">
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
            Rename (old names stay as spellings)
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
              Merge
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

function CreateEntity({ kind, onCreated }: { kind: EntityKind; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ nameEn: '', nameAr: '', developerId: '', cityId: '' });
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
      api(`/api/admin/entities/${kind}`, {
        method: 'POST',
        body: {
          nameEn: form.nameEn,
          nameAr: form.nameAr,
          ...(kind === 'project'
            ? { developerId: Number(form.developerId), cityId: Number(form.cityId) }
            : {}),
        },
      }),
    onSuccess: async () => {
      setForm({ nameEn: '', nameAr: '', developerId: '', cityId: '' });
      await onCreated();
    },
  });
  const label = KINDS.find((k) => k.kind === kind)?.label.toLowerCase() ?? kind;

  return (
    <Card title={`Add to ${label}`} className="h-fit">
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
                onChange={(e) => setForm({ ...form, developerId: e.target.value })}
              >
                <option value="">Choose</option>
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
                onChange={(e) => setForm({ ...form, cityId: e.target.value })}
              >
                <option value="">Choose</option>
                {cities.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameEn}
                  </option>
                ))}
              </Select>
            </Label>
          </>
        )}
        <ErrorNote error={create.error} />
        <Button type="submit" disabled={create.isPending}>
          Add
        </Button>
      </form>
    </Card>
  );
}
