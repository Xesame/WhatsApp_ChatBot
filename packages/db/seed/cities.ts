import type { SeedEntity } from './types.ts';

// Starter list for Hassan to review. Sub-areas that brokers use loosely
// (Ras El Hekma, El Alamein, Sidi Abdel Rahman) are aliases of North Coast,
// because the template's City column is coarse. Split them into their own
// cities here if firms want to filter by them.
export const cities: SeedEntity[] = [
  {
    nameEn: 'New Cairo',
    nameAr: 'القاهرة الجديدة',
    aliases: [
      'التجمع',
      'التجمع الخامس',
      'Fifth Settlement',
      '5th Settlement',
      'Tagamoa',
      'El Tagamoa',
      'Tagamo3',
      'Katameya',
      'القطامية',
    ],
  },
  {
    nameEn: 'New Capital',
    nameAr: 'العاصمة الإدارية الجديدة',
    aliases: [
      'العاصمة',
      'العاصمة الإدارية',
      'New Administrative Capital',
      'Administrative Capital',
      'NAC',
      'El Asema',
    ],
  },
  {
    nameEn: 'Mostakbal City',
    nameAr: 'مدينة المستقبل',
    aliases: ['المستقبل', 'مستقبل سيتي', 'Mostakbal', 'Future City'],
  },
  {
    nameEn: 'Shorouk City',
    nameAr: 'مدينة الشروق',
    aliases: ['الشروق', 'El Shorouk', 'Shorouk'],
  },
  {
    nameEn: 'Madinaty',
    nameAr: 'مدينتي',
    aliases: ['Madinaty City'],
  },
  {
    nameEn: 'Sheikh Zayed',
    nameAr: 'الشيخ زايد',
    aliases: ['زايد', 'El Sheikh Zayed', 'Zayed', 'Sheikh Zayed City'],
  },
  {
    nameEn: 'New Zayed',
    nameAr: 'زايد الجديدة',
    aliases: ['نيو زايد', 'New Sheikh Zayed'],
  },
  {
    nameEn: '6th of October',
    nameAr: 'السادس من أكتوبر',
    aliases: ['أكتوبر', '6 أكتوبر', 'October', '6 October', '6th October', 'October City'],
  },
  {
    nameEn: 'North Coast',
    nameAr: 'الساحل الشمالي',
    aliases: [
      'الساحل',
      'Sahel',
      'El Sahel',
      'رأس الحكمة',
      'Ras El Hekma',
      'Ras Elhekma',
      'العلمين',
      'العلمين الجديدة',
      'New Alamein',
      'El Alamein',
      'سيدي عبد الرحمن',
      'Sidi Abdel Rahman',
    ],
  },
  {
    nameEn: 'Ain Sokhna',
    nameAr: 'العين السخنة',
    aliases: ['السخنة', 'Sokhna', 'El Sokhna', 'Ain El Sokhna', 'الجلالة', 'Galala'],
  },
  {
    nameEn: 'Hurghada',
    nameAr: 'الغردقة',
    aliases: ['Ghardaqa', 'El Gouna', 'الجونة'],
  },
];
