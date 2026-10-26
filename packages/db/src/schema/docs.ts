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
      derived_text:
        'Text found in the file: vision transcription of an image, PDF text (vision for scanned pages), or spreadsheet cells. Extraction reads it with the message.',
      derived_method:
        '`vision`, `pdf`, `spreadsheet`, `skipped` (voice note, video, unsupported type) or `failed`.',
      derived_at: 'When the text was read.',
      derived_error: 'Why reading failed or was skipped.',
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
  extraction_runs: {
    description:
      'Every model call (classification or extraction): request, answer, tokens, cost, latency. Reprocessing adds new rows and never deletes old ones.',
    columns: {
      id: 'Identity primary key.',
      message_id: 'The message the model read.',
      media_file_id: 'For `transcribe` calls: the image or PDF that was read.',
      purpose:
        '`transcribe` (copy text out of an image or PDF page), `classify` (what the message is about) or `extract` (copy out units).',
      prompt_version: 'Version string of the prompt used, e.g. `extract-2026-10-26.1`.',
      provider: '`gemini`, `groq`, `openrouter`, `cerebras`.',
      model: 'Model name at the provider.',
      request: 'The request body as sent (no API key). Contact details are removed before sending.',
      raw_output: 'The answer from the model, unchanged.',
      parsed: 'The answer after validation, when valid.',
      input_tokens: 'Tokens sent.',
      output_tokens: 'Tokens received.',
      cost_usd: 'Cost in USD (0 on free tiers; null when the price of the model is unknown).',
      latency_ms: 'Time the call took.',
      status: '`ok`, `invalid` (answer failed validation), `error`, `rate_limited` or `timeout`.',
      error: 'Error or validation message.',
      created_at: 'When the call was made.',
    },
  },
  units: {
    description:
      'One row per unit offering: the 26 Primary Units template columns, then internal columns.',
    columns: {
      id: 'Identity primary key.',
      category:
        'Template: Category (Residential, Commercial, Administrative, Medical). Inferred from unit type when not stated.',
      developer_id:
        'Template: Developer (exported as the English name). Filled from the project when only the project was named.',
      project_id: 'Template: Project (exported as the English name).',
      city_id: 'Template: City (exported as the English name).',
      unit_type: 'Template: Unit Type.',
      unit_code: 'Template: Unit Code, only when the message names a specific unit.',
      floor: 'Template: Floor, normalized: `Ground`, `Roof`, `3`, or a range `1-5`.',
      finishing_specs: 'Template: Finishing Specs.',
      min_area: 'Template: Min Area (m²). A single size fills Min and Max.',
      max_area: 'Template: Max Area (m²). Empty for "starting from".',
      land_area: 'Template: Land Area (m²).',
      garden_area: 'Template: Garden Area (m²).',
      outdoor_area: 'Template: Outdoor Area (m²), terrace or roof.',
      min_price:
        'Template: Min Price, in minor units (piastres/cents) of `price_currency`. 650000000 EGP = EGP 6.5M.',
      max_price: 'Template: Max Price, minor units. Empty for "starting from".',
      delivery_year: 'Template: Delivery Year. Empty for ready-to-move units.',
      maintenance: 'Template: Maintenance, as stated (percent or amount).',
      maintenance_currency: 'Template: Maintenance Currency: `EGP`, `USD` or `%`.',
      cash_discount: 'Template: Cash Discount, as stated.',
      cash_discount_currency: 'Template: Cash Discount Currency, for fixed amounts.',
      cash_discount_type: 'Template: Cash Discount Type: `Percentage` or `Fixed amount`.',
      down_payment:
        'Template: Down Payment, percent 0-100 (computed from the amount when only an amount was stated).',
      installments_count:
        'Template: Installments Count = years x payments per year, computed in code.',
      bedrooms: 'Template: Bedrooms.',
      bathrooms: 'Template: Bathrooms.',
      notes:
        'Template: Notes. Short English note; the export adds "Ready to move" and USD conversion notes.',
      status: '`active`, `stale` (not seen for a while), `sold` or `withdrawn`.',
      price_currency:
        'Currency the prices were stated in (`EGP` or `USD`). The export converts USD to EGP.',
      down_payment_amount:
        'Down payment as an amount (minor units), when the message stated an amount.',
      installment_years: 'Length of the payment plan in years.',
      installment_frequency: '`monthly`, `quarterly`, `semi-annual` or `annual`.',
      ready_to_move: 'True for ready-to-move units.',
      confidence:
        '0-1, computed in code from which key fields were found and how well names matched.',
      needs_review: 'True when the review queue should check this unit.',
      review_reasons: 'Plain-English reasons for review, e.g. `No price`.',
      extras: 'Other data, e.g. names not in the entity list under `unmatched`.',
      sold_by_message_id:
        'The sold notice that marked the unit sold, if any (lets reprocessing undo it).',
      extraction_run_id: 'The latest model call that created or updated it.',
      first_seen_at: 'When the unit was first posted (earliest source message).',
      last_seen_at:
        'When the unit was last posted or updated (latest source message). Units not seen for STALE_AFTER_DAYS become `stale`.',
      created_at: 'When the row was created.',
      updated_at: 'When the row was last changed.',
    },
  },
  unit_sources: {
    description:
      'Every message that mentioned a unit: the original listing, reposts in other groups, price updates and sold notices. Dedup keeps one unit with many sources.',
    columns: {
      unit_id: 'The unit.',
      message_id: 'The message that mentioned it.',
      role: '`listing` (posted or reposted), `price_update` or `sold`.',
      created_at: 'When the link was made.',
    },
  },
  unit_prices: {
    description:
      'Price history: one row each time the price or payment terms of a unit were seen to change (the first listing included). Reposts with the same terms add no row.',
    columns: {
      id: 'Identity primary key.',
      unit_id: 'The unit.',
      min_price: 'Min price, minor units of `price_currency`.',
      max_price: 'Max price, minor units.',
      price_currency: '`EGP` or `USD`.',
      down_payment: 'Down payment percent.',
      down_payment_amount: 'Down payment amount (minor units), when stated.',
      installments_count: 'Number of installments.',
      installment_years: 'Length of the plan in years.',
      installment_frequency: '`monthly`, `quarterly`, `semi-annual` or `annual`.',
      cash_discount: 'Cash discount, as stated.',
      cash_discount_type: '`Percentage` or `Fixed amount`.',
      cash_discount_currency: 'Currency of a fixed cash discount.',
      observed_at: 'When the message stating these terms was posted.',
      source_message_id: 'The message that stated them.',
      created_at: 'When the row was created.',
    },
  },
  users: {
    description:
      'People who can log in: the owner (Phase 5), firm admins and agents (Phase 6). Managed by Better Auth.',
    columns: {
      id: 'Random ID set by Better Auth.',
      name: 'Display name.',
      email: 'Login e-mail. Unique.',
      email_verified: 'Whether the e-mail was verified (not used yet).',
      image: 'Profile picture URL (not used).',
      role: '`owner`, `firm_admin` or `agent`. Only the owner can use the admin pages.',
      phone: 'Phone number (Phase 7: links chat accounts).',
      created_at: 'When the row was created.',
      updated_at: 'When the row was last changed.',
    },
  },
  sessions: {
    description: 'Logged-in sessions (cookie tokens). Deleted on logout or expiry.',
    columns: {
      id: 'Random ID.',
      user_id: 'Who is logged in.',
      token: 'Session token stored in the browser cookie. Secret.',
      expires_at: 'When the session ends.',
      ip_address: 'IP address at login.',
      user_agent: 'Browser at login.',
      created_at: 'When the row was created.',
      updated_at: 'When the row was last changed.',
    },
  },
  accounts: {
    description:
      'Login methods per user. For e-mail and password, `provider_id` is `credential` and `password` holds the scrypt hash.',
    columns: {
      id: 'Random ID.',
      user_id: 'The user.',
      account_id: 'ID at the provider (the user ID for passwords).',
      provider_id: '`credential` for e-mail and password.',
      access_token: 'Unused (social logins).',
      refresh_token: 'Unused.',
      id_token: 'Unused.',
      access_token_expires_at: 'Unused.',
      refresh_token_expires_at: 'Unused.',
      scope: 'Unused.',
      password: 'Password hash (scrypt). Never the password itself.',
      created_at: 'When the row was created.',
      updated_at: 'When the row was last changed.',
    },
  },
  verifications: {
    description:
      'One-time codes (e-mail verification, password reset, Phase 7 chat linking). Managed by Better Auth.',
    columns: {
      id: 'Random ID.',
      identifier: 'What the code is for.',
      value: 'The code.',
      expires_at: 'When it stops working.',
      created_at: 'When the row was created.',
      updated_at: 'When the row was last changed.',
    },
  },
  review_corrections: {
    description:
      'Every change made in the review queue, field by field. Corrected units become eval cases.',
    columns: {
      id: 'Identity primary key.',
      unit_id: 'The unit reviewed.',
      message_id: 'The message the unit was extracted from (for eval export).',
      action:
        '`edit` (a field changed), `approve` (checked and correct) or `reject` (not a real listing).',
      field: 'For edits: which field (unit field name).',
      before: 'For edits: the value before.',
      after: 'For edits: the value after.',
      reviewer_id: 'Who made the change.',
      created_at: 'When.',
    },
  },
  audit_log: {
    description: 'Who did what: logins, failed logins, exports and admin actions.',
    columns: {
      id: 'Identity primary key.',
      user_id: 'Who (empty for failed logins).',
      action:
        'What, e.g. `login`, `login_failed`, `review.approve`, `groups.watch`, `settings.update`.',
      target: 'What it was done to, e.g. `unit:42`.',
      details: 'Extra details (no passwords).',
      ip_address: 'From which IP address.',
      created_at: 'When.',
    },
  },
  settings: {
    description: 'Settings the owner changes from the admin page.',
    columns: {
      key: 'Setting name, e.g. `usd_egp_rate`.',
      value: 'Its value (JSON).',
      updated_by: 'Who last changed it.',
      updated_at: 'When.',
    },
  },
};
