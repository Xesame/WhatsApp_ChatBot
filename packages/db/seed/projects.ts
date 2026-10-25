import type { SeedProject } from './types.ts';

// Starter list of well-known projects. `developer` and `city` must match a
// `nameEn` in developers.ts and cities.ts (a test checks this).
//
// Projects with the same brand in two cities (iCity, Palm Hills) get
// distinct English names and city-specific aliases, so an alias never points
// at two projects.
export const projects: SeedProject[] = [
  // Talaat Moustafa Group
  {
    nameEn: 'Madinaty',
    nameAr: 'مدينتي',
    developer: 'Talaat Moustafa Group',
    city: 'Madinaty',
    aliases: [],
  },
  {
    nameEn: 'Al Rehab',
    nameAr: 'الرحاب',
    developer: 'Talaat Moustafa Group',
    city: 'New Cairo',
    aliases: ['Rehab', 'Rehab City', 'مدينة الرحاب'],
  },
  {
    nameEn: 'Noor City',
    nameAr: 'نور',
    developer: 'Talaat Moustafa Group',
    city: 'New Capital',
    aliases: ['Noor', 'مدينة نور'],
  },
  {
    nameEn: 'Celia',
    nameAr: 'سيليا',
    developer: 'Talaat Moustafa Group',
    city: 'New Capital',
    aliases: [],
  },
  {
    nameEn: 'SouthMED',
    nameAr: 'ساوث ميد',
    developer: 'Talaat Moustafa Group',
    city: 'North Coast',
    aliases: ['South Med', 'ساوث ميد الساحل'],
  },

  // Emaar Misr
  {
    nameEn: 'Mivida',
    nameAr: 'ميفيدا',
    developer: 'Emaar Misr',
    city: 'New Cairo',
    aliases: ['ميفدا', 'Mi Vida'],
  },
  {
    nameEn: 'Marassi',
    nameAr: 'مراسي',
    developer: 'Emaar Misr',
    city: 'North Coast',
    aliases: ['مراسى'],
  },
  {
    nameEn: 'Cairo Gate',
    nameAr: 'كايرو جيت',
    developer: 'Emaar Misr',
    city: 'Sheikh Zayed',
    aliases: [],
  },
  {
    nameEn: 'Belle Vie',
    nameAr: 'بيل في',
    developer: 'Emaar Misr',
    city: 'New Zayed',
    aliases: ['Bellevie', 'بل في'],
  },

  // SODIC
  { nameEn: 'Villette', nameAr: 'فيليت', developer: 'SODIC', city: 'New Cairo', aliases: [] },
  {
    nameEn: 'Eastown',
    nameAr: 'إيستاون',
    developer: 'SODIC',
    city: 'New Cairo',
    aliases: ['East Town', 'ايست تاون'],
  },
  {
    nameEn: 'SODIC West',
    nameAr: 'سوديك ويست',
    developer: 'SODIC',
    city: 'Sheikh Zayed',
    aliases: [],
  },
  {
    nameEn: 'The Estates',
    nameAr: 'ذا استيتس',
    developer: 'SODIC',
    city: 'Sheikh Zayed',
    aliases: ['Estates SODIC', 'ذا إستيتس'],
  },
  { nameEn: 'VYE', nameAr: 'فاي', developer: 'SODIC', city: 'New Zayed', aliases: ['Vye Sodic'] },
  {
    nameEn: 'June',
    nameAr: 'جون',
    developer: 'SODIC',
    city: 'North Coast',
    aliases: ['June Sodic'],
  },
  {
    nameEn: 'Caesar',
    nameAr: 'سيزار',
    developer: 'SODIC',
    city: 'North Coast',
    aliases: ['Caesar Bay'],
  },

  // Palm Hills Developments
  {
    nameEn: 'Palm Hills New Cairo',
    nameAr: 'بالم هيلز القاهرة الجديدة',
    developer: 'Palm Hills Developments',
    city: 'New Cairo',
    aliases: ['PHNC', 'بالم هيلز التجمع'],
  },
  {
    nameEn: 'Palm Hills October',
    nameAr: 'بالم هيلز أكتوبر',
    developer: 'Palm Hills Developments',
    city: '6th of October',
    aliases: [],
  },
  {
    nameEn: 'Badya',
    nameAr: 'باديا',
    developer: 'Palm Hills Developments',
    city: '6th of October',
    aliases: ['Badya Palm Hills'],
  },
  {
    nameEn: 'Hacienda Bay',
    nameAr: 'هاسيندا باي',
    developer: 'Palm Hills Developments',
    city: 'North Coast',
    aliases: ['هاسيندا بي'],
  },
  {
    nameEn: 'Hacienda West',
    nameAr: 'هاسيندا ويست',
    developer: 'Palm Hills Developments',
    city: 'North Coast',
    aliases: [],
  },

  // Mountain View
  {
    nameEn: 'Mountain View iCity New Cairo',
    nameAr: 'ماونتن فيو آي سيتي التجمع',
    developer: 'Mountain View',
    city: 'New Cairo',
    aliases: ['iCity New Cairo', 'آي سيتي التجمع', 'MV iCity New Cairo'],
  },
  {
    nameEn: 'Mountain View iCity October',
    nameAr: 'ماونتن فيو آي سيتي أكتوبر',
    developer: 'Mountain View',
    city: '6th of October',
    aliases: ['iCity October', 'آي سيتي أكتوبر', 'MV iCity October'],
  },
  {
    nameEn: 'Mountain View Hyde Park',
    nameAr: 'ماونتن فيو هايد بارك',
    developer: 'Mountain View',
    city: 'New Cairo',
    aliases: ['MV Hyde Park'],
  },
  {
    nameEn: 'Mountain View Ras El Hekma',
    nameAr: 'ماونتن فيو رأس الحكمة',
    developer: 'Mountain View',
    city: 'North Coast',
    aliases: ['MV Ras El Hekma'],
  },
  {
    nameEn: 'Aliva',
    nameAr: 'أليفا',
    developer: 'Mountain View',
    city: 'Mostakbal City',
    aliases: ['Aliva Mountain View'],
  },

  // Ora Developers
  {
    nameEn: 'ZED East',
    nameAr: 'زد إيست',
    developer: 'Ora Developers',
    city: 'New Cairo',
    aliases: ['Zed New Cairo', 'زد التجمع'],
  },
  {
    nameEn: 'ZED West',
    nameAr: 'زد ويست',
    developer: 'Ora Developers',
    city: 'Sheikh Zayed',
    aliases: ['ZED Sheikh Zayed', 'Zed Towers', 'زد زايد'],
  },
  {
    nameEn: 'Silversands',
    nameAr: 'سيلفر ساندز',
    developer: 'Ora Developers',
    city: 'North Coast',
    aliases: ['Silver Sands'],
  },
  {
    nameEn: 'Solana',
    nameAr: 'سولانا',
    developer: 'Ora Developers',
    city: 'New Zayed',
    aliases: ['Solana West', 'Solana Ora'],
  },

  // Hyde Park Developments
  {
    nameEn: 'Hyde Park New Cairo',
    nameAr: 'هايد بارك التجمع',
    developer: 'Hyde Park Developments',
    city: 'New Cairo',
    aliases: ['هايد بارك القاهرة الجديدة'],
  },
  {
    nameEn: 'Seashore',
    nameAr: 'سي شور',
    developer: 'Hyde Park Developments',
    city: 'North Coast',
    aliases: ['Sea Shore', 'Seashore Hyde Park'],
  },

  // Tatweer Misr
  {
    nameEn: 'Il Monte Galala',
    nameAr: 'إل مونت جلالة',
    developer: 'Tatweer Misr',
    city: 'Ain Sokhna',
    aliases: ['Monte Galala', 'مونت جلالة', 'ال مونتي جلاله'],
  },
  {
    nameEn: 'Fouka Bay',
    nameAr: 'فوكا باي',
    developer: 'Tatweer Misr',
    city: 'North Coast',
    aliases: ['Fouka', 'فوكا'],
  },
  {
    nameEn: 'Bloomfields',
    nameAr: 'بلوم فيلدز',
    developer: 'Tatweer Misr',
    city: 'Mostakbal City',
    aliases: ['Bloom Fields'],
  },
  {
    nameEn: 'D-Bay',
    nameAr: 'دي باي',
    developer: 'Tatweer Misr',
    city: 'North Coast',
    aliases: ['DBay'],
  },

  // Hassan Allam Properties
  {
    nameEn: 'Swan Lake Residences',
    nameAr: 'سوان ليك ريزيدنس',
    developer: 'Hassan Allam Properties',
    city: 'New Cairo',
    aliases: ['Swan Lake', 'سوان ليك'],
  },
  {
    nameEn: 'Haptown',
    nameAr: 'هاب تاون',
    developer: 'Hassan Allam Properties',
    city: 'Mostakbal City',
    aliases: ['Hap Town'],
  },
  {
    nameEn: 'Seazen',
    nameAr: 'سيزن',
    developer: 'Hassan Allam Properties',
    city: 'North Coast',
    aliases: ['Seazen North Coast'],
  },

  // La Vista Developments
  {
    nameEn: 'La Vista City',
    nameAr: 'لافيستا سيتي',
    developer: 'La Vista Developments',
    city: 'New Capital',
    aliases: ['لا فيستا سيتي'],
  },
  {
    nameEn: 'El Patio Oro',
    nameAr: 'الباتيو أورو',
    developer: 'La Vista Developments',
    city: 'New Cairo',
    aliases: ['Patio Oro', 'باتيو اورو'],
  },
  {
    nameEn: 'La Vista Bay',
    nameAr: 'لافيستا باي',
    developer: 'La Vista Developments',
    city: 'North Coast',
    aliases: ['Lavista Bay'],
  },

  // Madinet Masr
  {
    nameEn: 'Taj City',
    nameAr: 'تاج سيتي',
    developer: 'Madinet Masr',
    city: 'New Cairo',
    aliases: ['Taj', 'تاج'],
  },
  {
    nameEn: 'Sarai',
    nameAr: 'سراي',
    developer: 'Madinet Masr',
    city: 'Mostakbal City',
    aliases: ['Sarai New Cairo', 'سراى'],
  },

  // Misr Italia Properties
  {
    nameEn: 'IL Bosco',
    nameAr: 'البوسكو',
    developer: 'Misr Italia Properties',
    city: 'New Capital',
    aliases: ['Il Bosco City', 'ال بوسكو'],
  },
  {
    nameEn: 'Kai Sokhna',
    nameAr: 'كاي السخنة',
    developer: 'Misr Italia Properties',
    city: 'Ain Sokhna',
    aliases: ['Kai', 'كاي'],
  },

  // Others
  {
    nameEn: 'Fifth Square',
    nameAr: 'فيفث سكوير',
    developer: 'Al Marasem',
    city: 'New Cairo',
    aliases: ['5th Square', 'Fifth Square Al Marasem'],
  },
  {
    nameEn: 'Etapa',
    nameAr: 'إيتابا',
    developer: 'City Edge Developments',
    city: 'Sheikh Zayed',
    aliases: ['ايتابا'],
  },
  {
    nameEn: 'North Edge',
    nameAr: 'نورث إيدج',
    developer: 'City Edge Developments',
    city: 'North Coast',
    aliases: ['North Edge Towers', 'نورث ايدج'],
  },
  {
    nameEn: 'El Gouna',
    nameAr: 'الجونة',
    developer: 'Orascom Development',
    city: 'Hurghada',
    aliases: ['Gouna'],
  },
  {
    nameEn: 'O West',
    nameAr: 'أو ويست',
    developer: 'Orascom Development',
    city: '6th of October',
    aliases: ['OWest', 'او ويست'],
  },
  {
    nameEn: 'Neopolis',
    nameAr: 'نيوبوليس',
    developer: 'Wadi Degla Developments',
    city: 'Mostakbal City',
    aliases: [],
  },
  {
    nameEn: 'District 5',
    nameAr: 'ديستركت 5',
    developer: 'Marakez',
    city: 'New Cairo',
    aliases: ['D5', 'District Five'],
  },
  {
    nameEn: 'Jefaira',
    nameAr: 'جفيرا',
    developer: 'Inertia',
    city: 'North Coast',
    aliases: ['جيفيرا'],
  },
  {
    nameEn: 'Azha North Coast',
    nameAr: 'أزها الساحل',
    developer: 'Madaar',
    city: 'North Coast',
    aliases: ['Azha Sahel', 'ازها الساحل الشمالي'],
  },
  {
    nameEn: 'Azha Ain Sokhna',
    nameAr: 'أزها السخنة',
    developer: 'Madaar',
    city: 'Ain Sokhna',
    aliases: ['Azha Sokhna'],
  },
  {
    nameEn: 'New Giza',
    nameAr: 'نيو جيزة',
    developer: 'New Giza',
    city: '6th of October',
    aliases: ['NEWGIZA'],
  },
];
