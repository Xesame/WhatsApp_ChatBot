import type { RawUnit } from '@reb/schema';
import { describe, expect, it } from 'vitest';
import {
  appearsIn,
  isNameReason,
  normalizeUnit,
  scoreConfidence,
  type NormalizeContext,
} from '../src/index.ts';

const blank: RawUnit = {
  category: null,
  developer: null,
  project: null,
  city: null,
  unit_type: null,
  unit_code: null,
  floor: null,
  finishing: null,
  bedrooms: null,
  bathrooms: null,
  area: null,
  land_area: null,
  garden_area: null,
  outdoor_area: null,
  price: null,
  delivery: null,
  maintenance: null,
  down_payment: null,
  installments: null,
  cash_discount: null,
  notes: null,
  evidence: { project: null, unit_type: null, area: null, price: null },
};

const MESSAGE =
  'ميفيدا التجمع شقة 3 غرف 150 متر الدور التالت نص تشطيب يبدأ من 9.5 مليون مقدم 10% على 8 سنين ربع سنوي صيانة 8% استلام 2028';

const ctx = (overrides: Partial<NormalizeContext> = {}): NormalizeContext => ({
  sourceText: MESSAGE,
  sentAt: new Date('2026-10-26T00:00:00Z'),
  developer: null,
  project: { id: 7, name: 'Mivida', similarity: 1, developerId: 2, cityId: 1 },
  city: { id: 1, name: 'New Cairo', similarity: 1 },
  suggestions: { developer: null, project: null, city: null },
  ...overrides,
});

const raw: RawUnit = {
  ...blank,
  project: 'ميفيدا',
  city: 'التجمع',
  unit_type: 'Apartment',
  finishing: 'Semi-finished',
  floor: 'الدور التالت',
  bedrooms: '3 غرف',
  area: '150 متر',
  price: 'يبدأ من 9.5 مليون',
  down_payment: 'مقدم 10%',
  installments: 'على 8 سنين ربع سنوي',
  maintenance: 'صيانة 8%',
  delivery: 'استلام 2028',
  evidence: { project: 'ميفيدا', unit_type: 'شقة', area: '150 متر', price: 'يبدأ من 9.5 مليون' },
};

describe('normalizeUnit', () => {
  it('turns raw phrases into template values, computing everything in code', () => {
    const unit = normalizeUnit(raw, ctx());
    expect(unit).toMatchObject({
      category: 'Residential',
      developerId: 2, // from the matched project
      projectId: 7,
      cityId: 1,
      unitType: 'Apartment',
      floor: '3',
      finishingSpecs: 'Semi-finished',
      minArea: 150,
      maxArea: 150,
      minPrice: 950_000_000, // EGP 9.5M in piastres
      maxPrice: null, // "starting from": Min only
      priceCurrency: 'EGP',
      deliveryYear: 2028,
      downPayment: 10,
      installmentYears: 8,
      installmentFrequency: 'quarterly',
      installmentsCount: 32,
      maintenance: 8,
      maintenanceCurrency: '%',
      bedrooms: 3,
      readyToMove: false,
    });
    expect(unit.confidence).toBe(1);
    expect(unit.needsReview).toBe(false);
  });

  it('drops values that are not in the message (no invention) and asks for review', () => {
    const unit = normalizeUnit({ ...raw, price: '12 مليون', developer: 'Emaar' }, ctx());
    expect(unit.minPrice).toBeNull();
    expect(unit.reviewReasons).toEqual(
      expect.arrayContaining([
        'Dropped developer "Emaar": not found in the message',
        'Dropped price "12 مليون": not found in the message',
        'No price',
      ]),
    );
    expect(unit.needsReview).toBe(true);
  });

  it('accepts values written with different digits or spacing than the message', () => {
    expect(appearsIn('١٥٠ متر', MESSAGE)).toBe(true);
    expect(appearsIn('9.5مليون', 'السعر 9.5 مليون')).toBe(true);
    expect(appearsIn('Mountain View', MESSAGE)).toBe(false);
  });

  it('flags evidence that is not a real quote', () => {
    const unit = normalizeUnit(
      { ...raw, evidence: { ...raw.evidence, price: 'السعر 9 مليون' } },
      ctx(),
    );
    expect(unit.reviewReasons).toContain('Evidence for price is not a quote from the message');
  });

  it('reads a bare "6.5" price as millions, but asks for review', () => {
    const unit = normalizeUnit(
      { ...raw, price: 'السعر 6.5' },
      ctx({ sourceText: `${MESSAGE} السعر 6.5` }),
    );
    expect(unit.minPrice).toBe(650_000_000);
    expect(unit.reviewReasons).toContain('Price had no "million"/"thousand"; read as millions');
  });

  it('keeps USD prices in USD and flags them', () => {
    const unit = normalizeUnit(
      { ...raw, price: '250,000 $' },
      ctx({ sourceText: `${MESSAGE} 250,000 $` }),
    );
    expect(unit).toMatchObject({
      priceCurrency: 'USD',
      minPrice: 25_000_000,
      maxPrice: 25_000_000,
    });
    expect(unit.reviewReasons).toContain('Priced in USD');
  });

  it('computes the down-payment percent from an amount and keeps the amount', () => {
    const text = 'شقة 150 متر السعر 10 مليون مقدم مليون';
    const unit = normalizeUnit(
      { ...raw, price: 'السعر 10 مليون', down_payment: 'مقدم مليون', area: '150 متر' },
      ctx({ sourceText: text }),
    );
    expect(unit).toMatchObject({ downPayment: 10, downPaymentAmount: 100_000_000 });
  });

  it('marks ready-to-move units and leaves the delivery year empty', () => {
    const unit = normalizeUnit(
      { ...raw, delivery: 'استلام فوري' },
      ctx({ sourceText: `${MESSAGE} استلام فوري` }),
    );
    expect(unit).toMatchObject({ readyToMove: true, deliveryYear: null });
  });

  it('records unknown names for review and keeps them in extras', () => {
    const unit = normalizeUnit(
      { ...raw, project: 'كمبوند جديد' },
      ctx({ sourceText: `${MESSAGE} كمبوند جديد`, project: null, city: null }),
    );
    expect(unit.projectId).toBeNull();
    expect(unit.extras).toMatchObject({ unmatched: { project: 'كمبوند جديد', city: 'التجمع' } });
    expect(unit.confidence).toBeLessThan(0.7);
    expect(unit.needsReview).toBe(true);
  });

  it('notes a fuzzy name match', () => {
    const unit = normalizeUnit(
      raw,
      ctx({ project: { id: 7, name: 'Mivida', similarity: 0.62, developerId: 2, cityId: 1 } }),
    );
    expect(unit.reviewReasons).toContain('project "ميفيدا" matched "Mivida" by similarity (0.62)');
  });

  it("prefers the project's developer and city when they conflict", () => {
    const unit = normalizeUnit(raw, ctx({ city: { id: 9, name: 'Sheikh Zayed', similarity: 1 } }));
    expect(unit.cityId).toBe(1);
    expect(unit.reviewReasons).toContain(
      'Project "Mivida" is not in "Sheikh Zayed"; used the project\'s city',
    );
  });

  it('infers category from unit type when not stated', () => {
    expect(normalizeUnit({ ...raw, unit_type: 'Clinic' }, ctx()).category).toBe('Medical');
    expect(normalizeUnit({ ...raw, unit_type: 'Office' }, ctx()).category).toBe('Administrative');
  });

  it('flags an implausible price per square metre', () => {
    const text = 'شقة 150 متر السعر 90 الف';
    const unit = normalizeUnit(
      { ...raw, price: 'السعر 90 الف', area: '150 متر' },
      ctx({ sourceText: text }),
    );
    expect(unit.reviewReasons.some((r) => r.startsWith('Price per m²'))).toBe(true);
  });
});

describe('names', () => {
  it('suggests instead of attaching a weak match', () => {
    const text = 'Zomra East شقة 150 متر السعر 9.5 مليون';
    const unit = normalizeUnit(
      { ...raw, project: 'Zomra East', city: null, price: 'السعر 9.5 مليون' },
      ctx({
        sourceText: text,
        project: null,
        city: null,
        suggestions: {
          developer: null,
          project: { id: 7, name: 'ZED East', similarity: 0.43 },
          city: null,
        },
      }),
    );
    expect(unit.projectId).toBeNull();
    expect(unit.extras.unmatched).toMatchObject({ project: 'Zomra East' });
    expect((unit.extras.suggested as { project: { id: number } }).project.id).toBe(7);
    expect(unit.reviewReasons).toContain(
      'project "Zomra East" is not in the known list (closest: ZED East, 0.43)',
    );
  });

  it('records names as written', () => {
    const text = 'Taj misr Dejoya 2 R8 شقة 150 متر السعر 9.5 مليون';
    const unit = normalizeUnit(
      {
        ...raw,
        developer: 'Taj misr',
        project: 'Dejoya 2 R8',
        city: null,
        price: 'السعر 9.5 مليون',
      },
      ctx({ sourceText: text, project: null, city: null }),
    );
    expect(unit.extras.written).toEqual({
      developer: ['Taj misr'],
      project: ['Dejoya 2 R8'],
      city: [],
    });
  });

  it('recognises name reasons', () => {
    for (const reason of [
      'project "X" is not in the known list',
      'project "X" matched "Y" by similarity (0.77)',
      'Developer "A" does not build "B"; used the project\'s developer',
      'Project "B" is not in "C"; used the project\'s city',
    ]) {
      expect(isNameReason(reason)).toBe(true);
    }
    expect(isNameReason('No area')).toBe(false);
    expect(isNameReason('Price per m² (4132 EGP) looks wrong')).toBe(false);
  });

  it('scores confidence like before', () => {
    expect(normalizeUnit(raw, ctx()).confidence).toBe(1);
    expect(
      scoreConfidence({
        projectSimilarity: 1,
        developerPart: 1,
        hasUnitType: true,
        priceFactor: 1,
        hasArea: true,
      }),
    ).toBe(1);
    expect(
      scoreConfidence({
        projectSimilarity: 0.4,
        developerPart: 0.6,
        hasUnitType: false,
        priceFactor: 0.6,
        hasArea: true,
      }),
    ).toBe(0.54);
  });
});
