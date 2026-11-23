import { describe, expect, it } from 'vitest';
import type { Entity } from '../src/api.ts';
import {
  afterReview,
  inlineKeyAction,
  lookupOffer,
  newNameButtons,
  newEntityOption,
  recheckMessage,
  rememberedSpellings,
  rememberKey,
  siblingsChoice,
  siblingsLabel,
  siblingsMessage,
  unitStateLabel,
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

describe('the other listings from the same message', () => {
  it('names how many listings the choice is about', () => {
    expect(siblingsLabel(24)).toBe(
      'Use this project, developer and area for the other 24 listings from this message',
    );
    expect(siblingsLabel(1)).toBe(
      'Use this project, developer and area for the other listing from this message',
    );
  });

  it('sends the choice only when there are siblings and the first box is ticked', () => {
    expect(siblingsChoice({ count: 0, apply: true, approve: true }, 'approve')).toBeUndefined();
    expect(siblingsChoice({ count: 3, apply: false, approve: true }, 'approve')).toBeUndefined();
    expect(siblingsChoice({ count: 3, apply: true, approve: false }, 'save')).toEqual({
      apply: true,
      approve: false,
    });
    expect(siblingsChoice({ count: 3, apply: true, approve: true }, 'approve')).toEqual({
      apply: true,
      approve: true,
    });
  });

  it('"Approve them too" goes only with Approve, and nothing goes with Not a listing', () => {
    expect(siblingsChoice({ count: 3, apply: true, approve: true }, 'save')).toEqual({
      apply: true,
      approve: false,
    });
    expect(siblingsChoice({ count: 3, apply: true, approve: true }, 'reject')).toBeUndefined();
  });

  it('confirms how many were updated', () => {
    expect(siblingsMessage(24)).toBe('Updated 24 other listings from this message');
    expect(siblingsMessage(1)).toBe('Updated 1 other listing from this message');
    expect(siblingsMessage(0)).toBeNull();
    expect(siblingsMessage(undefined)).toBeNull();
  });
});

describe('Review feedback', () => {
  it('confirms and returns to the queue after a decision on the single-listing page', () => {
    expect(afterReview('approve', true)).toEqual({ message: 'Approved ✓', backToQueue: true });
    expect(afterReview('reject', true)).toEqual({
      message: 'Marked as not a listing ✓',
      backToQueue: true,
    });
  });
  it('confirms but stays put in the normal queue and after Save', () => {
    expect(afterReview('approve', false).backToQueue).toBe(false);
    expect(afterReview('save', true)).toEqual({ message: 'Saved ✓', backToQueue: false });
  });
  it('labels units that are not waiting', () => {
    expect(unitStateLabel({ needsReview: false, status: 'active' })).toBe('Already checked');
    expect(unitStateLabel({ needsReview: false, status: 'stale' })).toBe('Already checked');
    expect(unitStateLabel({ needsReview: false, status: 'withdrawn' })).toBe(
      'Withdrawn (not a listing)',
    );
    expect(unitStateLabel({ needsReview: true, status: 'active' })).toBeNull();
  });
});

describe('what to do with an answer from Gemini’s memory', () => {
  const emaar = {
    id: 5,
    nameEn: 'Emaar Misr',
    nameAr: 'إعمار مصر',
    aliases: [{ alias: 'إعمار' }],
    unitCount: 0,
  } as Entity;

  it('uses the known developer, matching any spelling', () => {
    const use = { kind: 'use', id: 5, name: 'Emaar Misr' };
    expect(lookupOffer('  emaar MISR ', [emaar])).toEqual(use);
    expect(lookupOffer('إعمار', [emaar])).toEqual(use);
    expect(lookupOffer('إعمار مصر', [emaar])).toEqual(use);
  });

  it('offers a new entry for a name nobody knows', () => {
    expect(lookupOffer('Palm Hills', [emaar])).toEqual({ kind: 'new', name: 'Palm Hills' });
    expect(lookupOffer('Palm Hills', undefined)).toEqual({ kind: 'new', name: 'Palm Hills' });
  });

  it('offers nothing without an answer', () => {
    expect(lookupOffer(null, [emaar])).toBeNull();
    expect(lookupOffer('   ', [emaar])).toBeNull();
  });
});

describe('one "+ New" button when the written name and Gemini agree', () => {
  it('shows one button for the same name', () => {
    expect(newNameButtons('Aknan Developments', 'Aknan Developments')).toEqual({
      written: 'Aknan Developments',
      lookup: null,
    });
  });

  it('ignores case, and takes Gemini spelling when the written one is all lower or upper case', () => {
    expect(newNameButtons('Taj misr', 'Taj Misr')).toEqual({ written: 'Taj misr', lookup: null });
    expect(newNameButtons('taj  misr', 'Taj Misr')).toEqual({ written: 'Taj Misr', lookup: null });
    expect(newNameButtons('TAJ MISR', 'Taj Misr')).toEqual({ written: 'Taj Misr', lookup: null });
  });

  it('keeps both buttons for different names, and works with only one of them', () => {
    expect(newNameButtons('Palm Hills', 'Emaar')).toEqual({
      written: 'Palm Hills',
      lookup: 'Emaar',
    });
    expect(newNameButtons(undefined, 'Emaar')).toEqual({ written: null, lookup: 'Emaar' });
    expect(newNameButtons('Emaar', null)).toEqual({ written: 'Emaar', lookup: null });
  });
});
