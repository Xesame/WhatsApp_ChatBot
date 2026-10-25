import type { SeedEntity } from './types.ts';

// Starter list of major developers active in the primary market.
// Hassan: add, rename or remove freely, then run `pnpm db:seed`.
export const developers: SeedEntity[] = [
  {
    nameEn: 'Talaat Moustafa Group',
    nameAr: 'مجموعة طلعت مصطفى',
    aliases: ['طلعت مصطفى', 'TMG', 'Talaat Moustafa', 'Talaat Mostafa'],
  },
  { nameEn: 'Emaar Misr', nameAr: 'إعمار مصر', aliases: ['إعمار', 'Emaar', 'Emaar Egypt'] },
  { nameEn: 'SODIC', nameAr: 'سوديك', aliases: ['Sodic Developments'] },
  {
    nameEn: 'Palm Hills Developments',
    nameAr: 'بالم هيلز',
    aliases: ['Palm Hills', 'PHD', 'بالم هيلز للتعمير'],
  },
  { nameEn: 'Mountain View', nameAr: 'ماونتن فيو', aliases: ['ماونتين فيو', 'MV', 'DMG'] },
  { nameEn: 'Ora Developers', nameAr: 'أورا', aliases: ['Ora', 'أورا للتطوير'] },
  {
    nameEn: 'Hyde Park Developments',
    nameAr: 'هايد بارك',
    aliases: ['Hyde Park', 'هايد بارك للتطوير'],
  },
  { nameEn: 'Tatweer Misr', nameAr: 'تطوير مصر', aliases: ['Tatweer'] },
  {
    nameEn: 'Hassan Allam Properties',
    nameAr: 'حسن علام',
    aliases: ['Hassan Allam', 'HAP', 'حسن علام العقارية'],
  },
  {
    nameEn: 'La Vista Developments',
    nameAr: 'لافيستا',
    aliases: ['La Vista', 'Lavista', 'لا فيستا'],
  },
  {
    nameEn: 'Madinet Masr',
    nameAr: 'مدينة مصر',
    aliases: ['MNHD', 'Madinet Nasr Housing', 'مدينة نصر للإسكان'],
  },
  {
    nameEn: 'Misr Italia Properties',
    nameAr: 'مصر إيطاليا',
    aliases: ['Misr Italia', 'مصر ايطاليا العقارية'],
  },
  { nameEn: 'Al Marasem', nameAr: 'المراسم', aliases: ['Marasem', 'Al Marasem Development'] },
  {
    nameEn: 'City Edge Developments',
    nameAr: 'سيتي إيدج',
    aliases: ['City Edge', 'سيتي ايدج'],
  },
  {
    nameEn: 'Orascom Development',
    nameAr: 'أوراسكوم للتنمية',
    aliases: ['Orascom', 'ODE', 'أوراسكوم'],
  },
  { nameEn: 'Wadi Degla Developments', nameAr: 'وادي دجلة', aliases: ['Wadi Degla'] },
  { nameEn: 'Marakez', nameAr: 'مراكز', aliases: ['Marakez Development'] },
  { nameEn: 'Inertia', nameAr: 'إنرشيا', aliases: ['Inertia Egypt', 'انيرشيا'] },
  { nameEn: 'Madaar', nameAr: 'مدار', aliases: ['Madaar Development'] },
  { nameEn: 'New Giza', nameAr: 'نيو جيزة', aliases: ['NEWGIZA'] },
];
