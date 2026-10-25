import { describe, expect, it } from 'vitest';
import * as seedData from '../seed/index.ts';
import { spellingsOf, validateSeedData } from '../src/seed.ts';

describe('seed data', () => {
  it('has no duplicate names, unknown references or ambiguous aliases', () => {
    expect(validateSeedData(seedData)).toEqual([]);
  });

  it('covers the cities named in the build plan', () => {
    const names = seedData.cities.map((c) => c.nameEn);
    expect(names).toEqual(
      expect.arrayContaining(['New Cairo', 'Sheikh Zayed', 'New Capital', 'North Coast']),
    );
  });
});

describe('validateSeedData', () => {
  const city = { nameEn: 'New Cairo', nameAr: 'القاهرة الجديدة', aliases: ['التجمع'] };
  const developer = { nameEn: 'SODIC', nameAr: 'سوديك', aliases: [] };

  it('reports a project with an unknown developer or city', () => {
    const problems = validateSeedData({
      cities: [city],
      developers: [developer],
      projects: [{ nameEn: 'X', nameAr: 'اكس', developer: 'Nope', city: 'Nowhere', aliases: [] }],
    });
    expect(problems).toEqual([
      'project "X": unknown developer "Nope"',
      'project "X": unknown city "Nowhere"',
    ]);
  });

  it('reports an alias shared by two cities, even with different spelling', () => {
    const problems = validateSeedData({
      cities: [city, { nameEn: 'Other', nameAr: 'اخرى', aliases: ['التجمّع'] }],
      developers: [],
      projects: [],
    });
    expect(problems).toEqual(['city: alias "التجمّع" points at both "New Cairo" and "Other"']);
  });

  it('allows the same spelling for different kinds of entity', () => {
    const problems = validateSeedData({
      cities: [{ nameEn: 'Madinaty', nameAr: 'مدينتي', aliases: [] }],
      developers: [developer],
      projects: [
        { nameEn: 'Madinaty', nameAr: 'مدينتي', developer: 'SODIC', city: 'Madinaty', aliases: [] },
      ],
    });
    expect(problems).toEqual([]);
  });
});

describe('spellingsOf', () => {
  it('includes both names and de-duplicates by normalized form', () => {
    expect(
      spellingsOf({ nameEn: 'Mivida', nameAr: 'ميفيدا', aliases: ['MIVIDA', 'Mi Vida', ' '] }),
    ).toEqual([
      { alias: 'Mivida', aliasNormalized: 'mivida' },
      { alias: 'ميفيدا', aliasNormalized: 'ميفيدا' },
      { alias: 'Mi Vida', aliasNormalized: 'mi vida' },
    ]);
  });
});
