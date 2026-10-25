# @reb/ingest

Stores what capture receives: messages, media files, groups, and queues each stored message for the worker. It has no WhatsApp code in it, so it is tested against a real database without a phone.

| File              | What it does                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ingestor.ts` | `Ingestor`: saves parsed messages, downloads their media, queues `preprocess` jobs exactly once, and catches up after a restart (`sweep`) |
| `src/files.ts`    | Streams a media file to disk while hashing it; stores it at a path made from its hash                                                     |
| `src/groups.ts`   | Group list sync, watch/unwatch, source type, and the in-memory watched-groups cache                                                       |

**Guarantees and why**

- **Nothing from an unwatched group is stored.** The group itself is recorded (so it shows in `groups list`) but its messages are dropped. Watch/unwatch changes reach a running capture within 30 seconds (the cache refresh).
- **Each message is stored once and queued once.** Messages are unique per group and WhatsApp ID, so a redelivered message is ignored. Queuing marks `messages.enqueued_at` and adds the job in the same transaction, and only if `enqueued_at` was empty. However many times capture retries, there is one job.
- **Text messages** are saved and queued in a single transaction: there is never a message without a job, or a job without a message.
- **Media messages** are saved first with the file marked `pending`. The file is downloaded in the background (3 at a time), then the message is queued, so the worker always finds the file on disk.
- **Failed downloads** are retried by a sweep every 5 minutes, up to 5 attempts. After that the file is marked `failed` and the message is queued anyway, because its caption may still hold the listing.
- **Size limit:** files over `MEDIA_MAX_BYTES` are not downloaded (status `skipped`). A download that turns out bigger than announced is stopped at the limit.
- **Identical files are stored once.** Files are named by SHA-256 (`ab/cd/abcd...ef.jpg`), so the same flyer posted in five groups takes disk space once. Paths contain no group or sender details.
- **Crash recovery:** on every start, `sweep` resumes unfinished downloads and queues any stored message that was never queued.
