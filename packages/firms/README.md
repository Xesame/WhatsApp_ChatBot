# @reb/firms

Everything that belongs to one firm: its people, their notes, saved searches and usage. **The only code that reads or writes firm data**, so firm scoping (build plan, rule 5) lives in one place.

Every function takes an `Actor` (the signed-in person: id, role, firm) and limits itself to that person's firm. Something in another firm answers "not found", exactly like something that doesn't exist, so nothing leaks.

| Module              | What it does                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `firms.ts`          | Owner only: create firms, change plan, user limit, contract dates and status (suspending signs everyone out), list firms with users and usage                                        |
| `team.ts`           | Invite people (owner: firm admins and agents; firm admin: agents in their own firm, within the limit), list the team, remove and restore, new links, language                        |
| `links.ts`          | One-time links to set a password: invitations (7 days) and resets (1 day). Stores only the token's SHA-256; a new link replaces the old one; using it signs the person out elsewhere |
| `notes.ts`          | Private notes on listings. The author or a firm admin can delete                                                                                                                     |
| `saved-searches.ts` | Saved filters (validated with `@reb/search`). Agents see their own; firm admins see the firm's                                                                                       |
| `usage.ts`          | Logs searches, exports and listing views per firm (not the owner's own use)                                                                                                          |

Sign-in is refused for removed people, suspended firms and ended contracts by `accessProblem` in `@reb/auth`, checked at sign-in and on every API request.

Tests: `test/firms.integration.test.ts` (needs `TEST_DATABASE_URL`), plus `apps/api/test/firms.integration.test.ts` through HTTP.
