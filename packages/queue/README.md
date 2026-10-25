# @reb/queue

The job queue: [pg-boss](https://github.com/timgit/pg-boss), which keeps jobs in Postgres (schema `pgboss`), so there is no Redis to run.

| Export                                               | What it does                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `jobPayloads`                                        | Every job type and the shape of its data (Zod). Payloads carry only IDs.                                          |
| `queueSettings`                                      | Retries and retention per queue                                                                                   |
| `startQueue(url, { supervise })`                     | Starts pg-boss and creates the queues. Only the worker supervises (maintenance, retries); capture only adds jobs. |
| `enqueueInTransaction(boss, client, queue, payload)` | Adds a job inside the caller's transaction, so it exists only if that transaction commits                         |

**Queues**

| Queue        | Added by                         | Payload         | Retries                  | Kept while waiting |
| ------------ | -------------------------------- | --------------- | ------------------------ | ------------------ |
| `preprocess` | capture, once per stored message | `{ messageId }` | 8, backing off from 30 s | 60 days            |

Phase 1 has no consumer yet: jobs wait in Postgres until the worker's pipeline handlers arrive (Phases 2 and 3).

**Why pg-boss manages its own tables.** pg-boss creates and upgrades the `pgboss` schema itself on start, matched to its version. Those tables are not part of our Drizzle migrations; upgrading pg-boss upgrades them.
