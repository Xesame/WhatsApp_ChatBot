import type { SeedEntity } from './types.ts';

// Starter list, reviewed by Hassan on 2026-10-25. Well-known sub-areas
// (Katameya, Galala, El Gouna, and the North Coast areas Ras El Hekma,
// New Alamein and Sidi Abdel Rahman) are their own cities so firms can filter
// by them. "North Coast" stays for posts that only say "الساحل".
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
    aliases: ['الساحل', 'Sahel', 'El Sahel'],
  },
  {
    nameEn: 'Ras El Hekma',
    nameAr: 'رأس الحكمة',
    aliases: ['Ras Elhekma', 'Ras El Hikma', 'راس الحكمه'],
  },
  {
    nameEn: 'New Alamein',
    nameAr: 'العلمين الجديدة',
    aliases: ['العلمين', 'El Alamein', 'Alamein', 'New Alamein City'],
  },
  {
    nameEn: 'Sidi Abdel Rahman',
    nameAr: 'سيدي عبد الرحمن',
    aliases: ['Sidi Abdelrahman', 'Sidi Abd El Rahman'],
  },
  {
    nameEn: 'Ain Sokhna',
    nameAr: 'العين السخنة',
    aliases: ['السخنة', 'Sokhna', 'El Sokhna', 'Ain El Sokhna'],
  },
  {
    nameEn: 'Galala City',
    nameAr: 'مدينة الجلالة',
    aliases: ['الجلالة', 'Galala', 'El Galala'],
  },
  {
    nameEn: 'Hurghada',
    nameAr: 'الغردقة',
    aliases: ['Ghardaqa'],
  },
  {
    nameEn: 'El Gouna',
    nameAr: 'الجونة',
    aliases: ['Gouna'],
  },
  {
    nameEn: 'Katameya',
    nameAr: 'القطامية',
    aliases: ['Kattameya', 'Katameya Heights'],
  },
];
