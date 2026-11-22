import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Entity, type EntityKind, type UnitView } from '../api.ts';
import { Button } from '../ui.tsx';
import { CreateEntity } from './Entities.tsx';
import { lookupOffer, newNameButtons, rememberKey, spellingsToOffer } from './learning.ts';

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
  onPickOther,
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
  /** A developer / area added inside the New project form: set it on the unit too. */
  onPickOther?: (kind: 'developer' | 'city', id: number) => void;
}) {
  const queryClient = useQueryClient();
  // The little "new ..." form: the name it starts with.
  const [creating, setCreating] = useState<{ name: string } | null>(null);
  const written = view.learning.written[kind];
  const suggestion = view.learning.suggested[kind];
  const chosen = entities?.find((e) => String(e.id) === value);
  const offers = value !== loadedValue ? spellingsToOffer(written, chosen) : [];
  const newName = written[0];
  // Gemini's answer for an empty developer / area (the project is never looked up).
  const answer = kind === 'project' || value !== '' ? null : (view.learning.lookup?.[kind] ?? null);
  const offer = kind === 'project' ? null : lookupOffer(answer, entities);
  // One "+ New" button when the written name and Gemini's answer are the same name.
  const buttons = newNameButtons(newName, offer?.kind === 'new' ? offer.name : null);
  // The New project form: a developer / area Gemini named that we do not have
  // is offered by its name when the message did not write one.
  const lookedUp = view.learning.lookup;
  const offerNew =
    kind === 'project'
      ? {
          developer:
            view.learning.written.developer[0] ??
            (defaults?.developerId === '' ? (lookedUp?.developer ?? undefined) : undefined),
          city:
            view.learning.written.city[0] ??
            (defaults?.cityId === '' ? (lookedUp?.city ?? undefined) : undefined),
        }
      : undefined;

  return (
    <div className="mt-1 space-y-1 text-xs">
      {suggestion && String(suggestion.id) !== value && (
        <Button variant="quiet" size="sm" onClick={() => onPick(suggestion.id)}>
          Use {suggestion.name}
        </Button>
      )}
      {offer && answer && !creating && (
        <div className="text-muted">
          <p dir="auto">Gemini thinks: {answer} (from memory, check)</p>
          {offer.kind === 'use' ? (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                onPick(offer.id);
              }}
            >
              Use {offer.name}
            </Button>
          ) : buttons.lookup ? (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => setCreating({ name: buttons.lookup ?? offer.name })}
            >
              + New {WORD[kind]} named “{buttons.lookup}”
            </Button>
          ) : null}
        </div>
      )}
      {value === '' && buttons.written && !creating && (
        <div>
          <Button
            variant="quiet"
            size="sm"
            onClick={() => setCreating({ name: buttons.written ?? '' })}
          >
            + New {WORD[kind]} named “{buttons.written}”
          </Button>
        </div>
      )}
      {offers.map((alias) => (
        <label key={alias} className="flex items-start gap-1.5 text-muted">
          <input
            type="checkbox"
            className="mt-0.5 accent-graphite"
            checked={!unticked.has(rememberKey(kind, alias))}
            onChange={() => onToggle(rememberKey(kind, alias))}
          />
          <span dir="auto">
            Remember “{alias}” as a spelling of {chosen?.nameEn}
          </span>
        </label>
      ))}
      {creating && (
        <div className="rounded-control border border-line bg-bone p-2">
          <CreateEntity
            kind={kind}
            title={`New ${WORD[kind]}`}
            offerNew={offerNew}
            onRelatedCreated={onPickOther}
            initial={{ nameEn: creating.name, nameAr: creating.name, ...defaults }}
            onCreated={async (id) => {
              // Refresh the lists first so the drop-down knows the new entry.
              await queryClient.invalidateQueries({ queryKey: ['entities'] });
              onPick(id);
              setCreating(null);
            }}
          />
          <Button variant="quiet" size="sm" className="mt-1" onClick={() => setCreating(null)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
