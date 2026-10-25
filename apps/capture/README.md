# capture

Keeps the scraper WhatsApp number connected and stores every message from watched groups. Logic lives in `packages/whatsapp` (WhatsApp) and `packages/ingest` (storage); `src/main.ts` only connects them.

**Pairing (until the admin page in Phase 5):**

```sh
docker compose logs -f capture
```

A QR code appears in the logs. On the scraper phone: WhatsApp → Settings → Linked devices → Link a device, and scan it. The QR code refreshes about every 20 seconds.

Alternatively, set `WA_PAIRING_PHONE=201xxxxxxxxx` (the scraper's own number) in `.env` and restart capture. An 8-character code is logged instead: on the phone, choose Link a device → _Link with phone number instead_ and type it.

**Choosing groups:**

```sh
docker compose exec capture node apps/capture/src/cli.ts groups list
docker compose exec capture node apps/capture/src/cli.ts groups watch 3 7 12
docker compose exec capture node apps/capture/src/cli.ts groups source developer 3
docker compose exec capture node apps/capture/src/cli.ts groups unwatch 7
```

Locally (outside Docker): `pnpm --filter @reb/capture groups list`.
