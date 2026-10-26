import { settings, type Db } from '@reb/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

/**
 * Settings the owner changes from the admin page. Each has a schema, so a
 * bad value is rejected with a clear message.
 */
export const SETTINGS = {
  /** EGP per 1 USD, used by exports to convert USD prices (EGP is the main currency). */
  usd_egp_rate: z.number().positive().max(10_000),
} as const;

export type SettingKey = keyof typeof SETTINGS;

export async function getSetting<K extends SettingKey>(
  db: Db,
  key: K,
): Promise<z.infer<(typeof SETTINGS)[K]> | undefined> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key));
  if (!row) return undefined;
  const parsed = SETTINGS[key].safeParse(row.value);
  return parsed.success ? parsed.data : undefined;
}

export async function setSetting<K extends SettingKey>(
  db: Db,
  key: K,
  value: unknown,
  userId: string | null,
): Promise<z.infer<(typeof SETTINGS)[K]>> {
  const parsed = SETTINGS[key].parse(value);
  await db
    .insert(settings)
    .values({ key, value: parsed, updatedBy: userId })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: parsed, updatedBy: userId, updatedAt: new Date() },
    });
  return parsed;
}

/** The USD→EGP rate for exports: the admin setting, else the USD_EGP_RATE fallback. */
export async function usdToEgpRate(
  db: Db,
  fallback: number | undefined,
): Promise<number | undefined> {
  return (await getSetting(db, 'usd_egp_rate')) ?? fallback;
}
