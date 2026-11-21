import { describe, expect, it } from 'vitest';
import type { Entity } from '../src/api.ts';
import {
  inlineKeyAction,
  newEntityOption,
  recheckMessage,
  rememberedSpellings,
  rememberKey,
} from '../src/pages/learning.ts';

describe('remembering spellings from Review', () => {
  const zomra: Entity = {
    id: 7,
    nameEn: 'Zomra East Residence',
    nameAr: 'زمرة ايست ريزيدنس',
    aliases: [],
    unitCount: 0,
  };
  const base = {
    values: { projectId: '7', developerId: '', cityId: '' },
    initial: { projectId: '', developerId: '', cityId: '' },
    lists: { project: [zomra] },
    written: { project: ['Zomra East'], developer: [], city: [] },
  };

  it('sends a ticked spelling for a changed name', () => {
    expect(rememberedSpellings({ ...base, unticked: new Set() })).toEqual([
      { kind: 'project', alias: 'Zomra East' },
    ]);
  });

  it('never sends a spelling the person unticked', () => {
    const unticked = new Set([rememberKey('project', 'Zomra East')]);
    expect(rememberedSpellings({ ...base, unticked })).toEqual([]);
  });

  it('offers nothing when the name was not changed', () => {
    expect(rememberedSpellings({ ...base, initial: base.values, unticked: new Set() })).toEqual([]);
  });

  it('describes a re-check in plain words', () => {
    expect(recheckMessage({ checked: 12, cleared: 3 })).toBe(
      'Re-checked 12 waiting units, 3 cleared',
    );
  });
});

describe('the "+ New developer / area" option in the New project form', () => {
  const dubaiMisr: Entity = {
    id: 3,
    nameEn: 'Dubai Misr',
    nameAr: 'دبي مصر',
    aliases: [{ alias: 'DM Developments' }],
    unitCount: 0,
  } as Entity;

  it('is offered with the written name when no developer matches', () => {
    expect(newEntityOption('developer', 'Palm Hills', [dubaiMisr])).toEqual({
      label: '+ New developer named “Palm Hills”',
      name: 'Palm Hills',
    });
  });

  it('is not offered when the written name is already a known developer or spelling', () => {
    expect(newEntityOption('developer', '  dubai MISR ', [dubaiMisr])).toBeNull();
    expect(newEntityOption('developer', 'dm developments', [dubaiMisr])).toBeNull();
  });

  it('reads "+ New area…" with an empty name when the unit has no written name', () => {
    expect(newEntityOption('city', undefined, [])).toEqual({ label: '+ New area…', name: '' });
  });
});

describe('keys inside the inline new developer / area box', () => {
  it('Enter saves when both names are filled in', () => {
    expect(inlineKeyAction('Enter', 'Dubai Misr', 'دبي مصر', false)).toBe('save');
  });

  it('Enter never saves an empty name, and never while saving', () => {
    expect(inlineKeyAction('Enter', '  ', 'x', false)).toBe('none');
    expect(inlineKeyAction('Enter', 'x', '', false)).toBe('none');
    expect(inlineKeyAction('Enter', 'x', 'y', true)).toBe('none');
  });

  it('Escape cancels and other keys are left alone', () => {
    expect(inlineKeyAction('Escape', 'x', 'y', false)).toBe('cancel');
    expect(inlineKeyAction('a', 'x', 'y', false)).toBeNull();
  });
});
