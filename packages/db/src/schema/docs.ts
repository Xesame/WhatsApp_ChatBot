/**
 * Plain-English description of every table and column.
 *
 * `pnpm docs` reads this together with the Drizzle schema to generate
 * docs/generated/database.md, and fails if any table or column is missing
 * here. Adding a column therefore forces you to document it.
 */
export const tableDocs: Record<string, { description: string; columns: Record<string, string> }> = {
  cities: {
    description: 'Canonical cities and areas (New Cairo, Sheikh Zayed, North Coast, ...).',
    columns: {
      id: 'Identity primary key.',
      name_en: 'Official English name. Used in exports. Unique.',
      name_ar: 'Official Arabic name.',
      created_at: 'When the row was created.',
      updated_at: 'When the row was last changed.',
    },
  },
  developers: {
    description: 'Canonical real estate developers (Emaar Misr, SODIC, Palm Hills, ...).',
    columns: {
      id: 'Identity primary key.',
      name_en: 'Official English name. Used in exports. Unique.',
      name_ar: 'Official Arabic name.',
      created_at: 'When the row was created.',
      updated_at: 'When the row was last changed.',
    },
  },
  projects: {
    description: 'Canonical projects (compounds). Each belongs to one developer and one city.',
    columns: {
      id: 'Identity primary key.',
      name_en: 'Official English name. Used in exports. Unique per developer.',
      name_ar: 'Official Arabic name.',
      developer_id: 'The developer that builds this project.',
      city_id: 'The city or area the project is in.',
      created_at: 'When the row was created.',
      updated_at: 'When the row was last changed.',
    },
  },
  entity_aliases: {
    description:
      'Alternate spellings (Arabic, English, abbreviations) mapped to one city, developer or project. Exactly one of the three entity columns is set.',
    columns: {
      id: 'Identity primary key.',
      alias: 'The spelling as written, kept for display and review.',
      alias_normalized:
        'The spelling after normalizeName(): lowercase, unified Arabic letters, no diacritics or punctuation. Matching uses this column.',
      city_id: 'Set when the alias names a city.',
      developer_id: 'Set when the alias names a developer.',
      project_id: 'Set when the alias names a project.',
      source:
        'Where the alias came from: `seed` (seed data), `manual` (added by the owner), `review` (learned from a review-queue correction).',
      created_at: 'When the alias was added.',
    },
  },
  wa_groups: {
    description:
      'Every WhatsApp group the scraper number is in. Only groups with `watched = true` have their messages stored.',
    columns: {
      id: 'Identity primary key.',
      jid: 'WhatsApp group ID (ends in `@g.us`). Unique.',
      name: 'Group name as shown in WhatsApp. Updated when it changes.',
      watched: 'Whether messages from this group are captured. New groups start unwatched.',
      source_type: 'Who posts in the group: `developer` or `broker`. Set by the owner.',
      is_member: 'False once the scraper number has left or been removed from the group.',
      last_message_at: 'When the last stored message from this group was received.',
      added_at: 'When capture first saw the group.',
      updated_at: 'When the row was last changed.',
    },
  },
  messages: {
    description:
      'Raw messages from watched groups, stored once and never changed by processing except for `status`, `error` and `attempts`.',
    columns: {
      id: 'Identity primary key.',
      group_id: 'The group the message was posted in.',
      wa_message_id: 'WhatsApp message ID. Unique per group, which prevents duplicates.',
      sender_hash:
        "HMAC-SHA256 of the sender's WhatsApp ID with SENDER_HASH_SALT. The same sender always gets the same hash; the phone number cannot be recovered from it.",
      sent_at: 'When the sender posted the message (WhatsApp timestamp).',
      text: 'Message text or media caption, as written. Null for media without a caption.',
      quoted_wa_message_id: 'WhatsApp ID of the message this one replies to, if any.',
      edit_of_wa_message_id:
        'For an edit: WhatsApp ID of the original message. The edited text is stored as a new row.',
      media_type: '`none`, `image`, `video`, `audio` (including voice notes) or `document`.',
      is_forwarded: 'Whether WhatsApp marked the message as forwarded.',
      deleted_at: 'When the sender deleted the message for everyone. The row is kept.',
      status:
        'Processing state: `pending` → `processing` → `processed`, or `skipped` (not a listing) / `failed`.',
      error: 'Why processing failed or was skipped.',
      attempts: 'How many times processing has been attempted.',
      enqueued_at: 'When the `preprocess` job was queued. Null while media is still downloading.',
      created_at: 'When capture stored the message.',
      updated_at: 'When the row was last changed.',
    },
  },
  media_files: {
    description:
      'The image, video, voice note or document attached to a message. Identical files are stored once on disk (named by hash).',
    columns: {
      id: 'Identity primary key.',
      message_id: 'The message the file belongs to (one file per message).',
      kind: '`image`, `video`, `audio` or `document`.',
      mime_type: 'File type reported by WhatsApp, e.g. `image/jpeg`, `application/pdf`.',
      file_name: 'Original file name, for documents.',
      size_bytes: 'File size in bytes.',
      sha256: 'SHA-256 of the file contents (hex). The same flyer in three groups has one hash.',
      path: 'Location relative to MEDIA_DIR, e.g. `ab/cd/abcd...e9.jpg`.',
      status:
        '`pending` (not downloaded yet), `downloaded`, `failed` (gave up after retries) or `skipped` (too large).',
      attempts: 'Download attempts so far.',
      error: 'Last download error.',
      media_ref: 'What WhatsApp needs to download the file again. Contains no sender data.',
      created_at: 'When the row was created.',
      downloaded_at: 'When the file was saved to disk.',
    },
  },
  wa_auth: {
    description:
      'WhatsApp login keys for each account. Losing this table means pairing the number again. **Secret**: anyone with these rows can act as the WhatsApp account.',
    columns: {
      account: '`scraper` (capture) or, from Phase 7, `query-bot`.',
      category: 'Key type used by Baileys (`creds`, `pre-key`, `session`, ...).',
      key_id: 'Key identifier within the category.',
      value: 'The key, as JSON (binary values base64-encoded).',
      updated_at: 'When the key was last written.',
    },
  },
  wa_connections: {
    description: 'Current connection status of each WhatsApp account.',
    columns: {
      account: '`scraper` or `query-bot`.',
      state:
        '`starting`, `awaiting_pairing` (QR or pairing code shown), `open`, `reconnecting`, `logged_out` or `stopped`.',
      qr: 'The current pairing QR code (as text) while awaiting pairing.',
      pairing_code: 'The current 8-character pairing code, when pairing by phone number.',
      last_connected_at: 'When the connection last opened.',
      last_disconnected_at: 'When the connection last closed.',
      last_disconnect_reason: 'Why it last closed, e.g. `connectionLost (408)`.',
      last_message_at: 'When the last message was received from any group.',
      updated_at: 'When the status last changed.',
    },
  },
};
