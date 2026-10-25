import { waAuth, type Db } from '@reb/db';
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from 'baileys';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * WhatsApp login state stored in Postgres (`wa_auth`), one set per account.
 *
 * Baileys ships a file-based store but warns against using it in production.
 * Keeping the keys in Postgres means they are covered by the same backups as
 * everything else and survive the container being rebuilt. Values are stored
 * as JSON with binary data base64-encoded (Baileys' BufferJSON format).
 */

const CREDS = { category: 'creds', keyId: 'creds' } as const;

const toJson = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, BufferJSON.replacer)) as unknown;
const fromJson = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value), BufferJSON.reviver) as unknown;

export interface AuthStore {
  state: AuthenticationState;
  /** Persist the credentials after Baileys changes them ('creds.update'). */
  saveCreds: () => Promise<void>;
  /** Delete everything for this account, e.g. after WhatsApp logs it out. */
  clear: () => Promise<void>;
}

export async function loadAuthStore(db: Db, account: string): Promise<AuthStore> {
  const [stored] = await db
    .select({ value: waAuth.value })
    .from(waAuth)
    .where(
      and(
        eq(waAuth.account, account),
        eq(waAuth.category, CREDS.category),
        eq(waAuth.keyId, CREDS.keyId),
      ),
    );
  const creds: AuthenticationCreds = stored
    ? (fromJson(stored.value) as AuthenticationCreds)
    : initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const result: Record<string, SignalDataTypeMap[T]> = {};
        if (ids.length === 0) return result;
        const rows = await db
          .select({ keyId: waAuth.keyId, value: waAuth.value })
          .from(waAuth)
          .where(
            and(eq(waAuth.account, account), eq(waAuth.category, type), inArray(waAuth.keyId, ids)),
          );
        for (const row of rows) {
          let value = fromJson(row.value) as SignalDataTypeMap[T];
          if (type === 'app-state-sync-key') {
            value = proto.Message.AppStateSyncKeyData.fromObject(
              value as object,
            ) as unknown as SignalDataTypeMap[T];
          }
          result[row.keyId] = value;
        }
        return result;
      },
      set: async (data) => {
        const upserts: { category: string; keyId: string; value: unknown }[] = [];
        const deletes: { category: string; keyId: string }[] = [];
        for (const [category, entries] of Object.entries(data)) {
          for (const [keyId, value] of Object.entries(entries as Record<string, unknown>)) {
            if (value === null || value === undefined) deletes.push({ category, keyId });
            else upserts.push({ category, keyId, value: toJson(value) });
          }
        }
        await db.transaction(async (tx) => {
          for (const row of upserts) {
            await tx
              .insert(waAuth)
              .values({ account, ...row })
              .onConflictDoUpdate({
                target: [waAuth.account, waAuth.category, waAuth.keyId],
                set: { value: row.value, updatedAt: new Date() },
              });
          }
          for (const row of deletes) {
            await tx
              .delete(waAuth)
              .where(
                and(
                  eq(waAuth.account, account),
                  eq(waAuth.category, row.category),
                  eq(waAuth.keyId, row.keyId),
                ),
              );
          }
        });
      },
    },
  };

  return {
    state,
    saveCreds: async () => {
      const value = toJson(state.creds);
      await db
        .insert(waAuth)
        .values({ account, ...CREDS, value })
        .onConflictDoUpdate({
          target: [waAuth.account, waAuth.category, waAuth.keyId],
          set: { value, updatedAt: new Date() },
        });
    },
    clear: async () => {
      await db.delete(waAuth).where(eq(waAuth.account, account));
    },
  };
}
