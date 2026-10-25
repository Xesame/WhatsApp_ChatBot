# @reb/whatsapp

Everything that talks to WhatsApp (through [Baileys](https://github.com/WhiskeySockets/Baileys)). Capture uses it now; the query bot will reuse it in Phase 7 with its own account.

| File                | What it does                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/connection.ts` | `WhatsAppConnection`: pairs the number (QR or pairing code), stays connected, reconnects with backoff, hands incoming messages to a callback in order, reports groups, records status |
| `src/auth-store.ts` | Stores the WhatsApp login keys in Postgres (`wa_auth`)                                                                                                                                |
| `src/parse.ts`      | `parseMessage()`: turns a raw WhatsApp message into what capture stores (text, caption, quoted ID, media reference, edit, deletion) or a reason to ignore it                          |
| `src/sender.ts`     | Picks a stable sender ID and hashes it with the secret salt                                                                                                                           |
| `src/media.ts`      | Downloads and decrypts a media file from its stored reference                                                                                                                         |
| `src/status.ts`     | Writes connection status to `wa_connections`                                                                                                                                          |

**Why it is designed this way**

- **Login keys live in Postgres, not files.** Baileys' file store is meant for demos. In Postgres the session is backed up with everything else and survives rebuilding the container. Losing it only means pairing again.
- **The sender's identity never leaves this package.** `parseMessage` returns a salted HMAC-SHA256 hash, never the phone number, the LID or the display name (`pushName`). WhatsApp now identifies people by a private "LID" and sometimes also their phone number; we prefer the LID so one person always gets one hash.
- **Only group messages from other people are kept.** Private chats, status updates, the scraper's own messages, stickers, reactions, polls and system notices are ignored.
- **Edits and deletions are understood.** An edit becomes a new message pointing at the original (`edit_of_wa_message_id`). Brokers often edit a price instead of reposting. "Delete for everyone" marks the original as deleted but keeps it.
- **Reconnects back off**: 1 s, 2 s, 4 s ... up to 60 s, with random jitter. Special cases:
  - _restart required_ (normal right after pairing): reconnect immediately.
  - _logged out_ (unlinked from the phone, or banned): the saved keys are cleared and a new QR code is shown.
  - _connection replaced_ (a second capture is running with the same number): wait a full minute and log an error.
- **No message is dropped because of a short database outage.** If saving a batch fails, it is retried for about two minutes in arrival order. WhatsApp has already acknowledged the messages by then, so after that they are logged as lost (by ID only).
- **Not "online".** The scraper connects as a linked device that doesn't mark itself online, so the phone keeps getting notifications and the account looks normal.
- **Health:** `/health` fails only when the connection has been down for more than 5 minutes. Waiting for pairing counts as healthy.
