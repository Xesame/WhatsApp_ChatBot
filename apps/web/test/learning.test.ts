import { describe, expect, it } from 'vitest';
import type { Entity } from '../src/api.ts';
import { recheckMessage, rememberedSpellings, rememberKey } from '../src/pages/learning.ts';

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
