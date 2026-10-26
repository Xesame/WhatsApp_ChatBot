import { waConnections, type Db } from '@reb/db';
import { toString } from 'qrcode';

export interface ConnectionView {
  account: string;
  state: (typeof waConnections.$inferSelect)['state'];
  /** The pairing QR code as an SVG image, while waiting for pairing. */
  qrSvg: string | null;
  pairingCode: string | null;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  lastDisconnectReason: string | null;
  lastMessageAt: Date | null;
  updatedAt: Date;
}

/**
 * Status of each WhatsApp number for the admin page (build plan: bot status,
 * QR pairing in the browser). Capture writes `wa_connections`; the QR code
 * is turned into an image here so the browser only displays it.
 */
export async function connectionStatus(db: Db): Promise<ConnectionView[]> {
  const rows = await db.select().from(waConnections).orderBy(waConnections.account);
  return Promise.all(
    rows.map(async (row) => ({
      account: row.account,
      state: row.state,
      qrSvg:
        row.state === 'awaiting_pairing' && row.qr
          ? await toString(row.qr, { type: 'svg', margin: 2 })
          : null,
      pairingCode: row.state === 'awaiting_pairing' ? row.pairingCode : null,
      lastConnectedAt: row.lastConnectedAt,
      lastDisconnectedAt: row.lastDisconnectedAt,
      lastDisconnectReason: row.lastDisconnectReason,
      lastMessageAt: row.lastMessageAt,
      updatedAt: row.updatedAt,
    })),
  );
}
