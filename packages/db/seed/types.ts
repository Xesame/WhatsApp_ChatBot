/** Shape of the starter seed data. The English and Arabic names are added as aliases automatically. */
export interface SeedEntity {
  nameEn: string;
  nameAr: string;
  /** Extra spellings people use in the groups: abbreviations, Franco-Arabic, old names. */
  aliases: string[];
}

export interface SeedProject extends SeedEntity {
  /** Must equal a developer's `nameEn`. */
  developer: string;
  /** Must equal a city's `nameEn`. */
  city: string;
}
