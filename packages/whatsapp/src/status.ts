import { waConnections, type Db } from '@reb/db';

export type ConnectionState = (typeof waConnections.$inferSelect)['state'];

export interface ConnectionStatus {
  state: ConnectionState;
  qr?: string | null;
  pairingCode?: string | null;
  lastConnectedAt?: Date | null;
  lastDisconnectedAt?: Date | null;
  lastDisconnectReason?: string | null;
  lastMessageAt?: Date | null;
}

/** Writes the current status of an account to `wa_connections`. */
export async function saveConnectionStatus(
  db: Db,
  account: string,
  status: ConnectionStatus,
): Promise<void> {
  const values = { account, ...status, updatedAt: new Date() };
  await db
    .insert(waConnections)
    .values(values)
    .onConflictDoUpdate({ target: waConnections.account, set: values });
}
