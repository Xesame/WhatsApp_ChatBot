import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Entity, type EntityKind, type UnitView } from '../api.ts';
import { Button } from '../ui.tsx';
import { CreateEntity } from './Entities.tsx';
import { rememberKey, spellingsToOffer } from './learning.ts';

/**
 * The "teach the system" controls on the Review page: next to Project,
 * Developer and City they offer to remember how the message spelled a name,
 * to use the system's closest guess, or to add a name that is truly new.
 * Nothing here decides anything: the person ticks, clicks, and saves.
 */

/** What each kind is called in the sentences on this page. */
const WORD: Record<EntityKind, string> = {
  project: 'project',
  developer: 'developer',
  city: 'area',
};

/** The list of entities of one kind. Same cache entry the drop-downs use. */
export function useEntities(kind: EntityKind) {
  return useQuery({
    queryKey: ['entities', kind, ''],
    queryFn: () => api<Entity[]>(`/api/admin/entities/${kind}`),
    staleTime: 60_000,
  });
}

export function LearnControls({
  kind,
  view,
  value,
  loadedValue,
  entities,
  unticked,
  onToggle,
  onPick,
  defaults,
}: {
  kind: EntityKind;
  view: UnitView;
  /** The field as it is now / as it was loaded (entity ids as text). */
  value: string;
  loadedValue: string;
  entities: Entity[] | undefined;
  /** Spellings the person unticked (keys from `rememberKey`). */
  unticked: Set<string>;
  onToggle: (key: string) => void;
  /** Sets the field to this entity id. */
  onPick: (id: number) => void;
  /** Pre-filled developer / city for a new project. */
  defaults?: { developerId: string; cityId: string };
}) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const written = view.learning.written[kind];
  const suggestion = view.learning.suggested[kind];
  const chosen = entities?.find((e) => String(e.id) === value);
  const offers = value !== loadedValue ? spellingsToOffer(written, chosen) : [];
  const newName = written[0];

  return (
    <div className="mt-1 space-y-1 text-xs">
      {suggestion && String(suggestion.id) !== value && (
        <Button
          variant="secondary"
          className="!px-2 !py-0.5 !text-xs"
          onClick={() => onPick(suggestion.id)}
        >
          Use {suggestion.name}
        </Button>
      )}
      {value === '' && newName && !creating && (
        <div>
          <Button
            variant="ghost"
            className="!px-1 !py-0.5 !text-xs"
            onClick={() => setCreating(true)}
          >
            + New {WORD[kind]} named “{newName}”
          </Button>
        </div>
      )}
      {offers.map((alias) => (
        <label key={alias} className="flex items-start gap-1.5 text-slate-600 dark:text-slate-400">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={!unticked.has(rememberKey(kind, alias))}
            onChange={() => onToggle(rememberKey(kind, alias))}
          />
          <span dir="auto">
            Remember “{alias}” as a spelling of {chosen?.nameEn}
          </span>
        </label>
      ))}
      {creating && newName && (
        <div className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
          <CreateEntity
            kind={kind}
            title={`New ${WORD[kind]}`}
            initial={{ nameEn: newName, nameAr: newName, ...defaults }}
            onCreated={async (id) => {
              // Refresh the lists first so the drop-down knows the new entry.
              await queryClient.invalidateQueries({ queryKey: ['entities'] });
              onPick(id);
              setCreating(false);
            }}
          />
          <Button variant="ghost" className="mt-1 !text-xs" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
