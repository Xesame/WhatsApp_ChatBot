import type { USER_ROLES } from '@reb/db';

/** The signed-in person a request acts for. Every firm function takes one. */
export interface Actor {
  userId: string;
  role: (typeof USER_ROLES)[number];
  /** Null only for the owner. */
  firmId: number | null;
}

export class NotFoundError extends Error {
  override name = 'NotFoundError';
}
/** Not allowed for this person (a different firm, or not an admin). */
export class ForbiddenError extends Error {
  override name = 'ForbiddenError';
}
/** Clashes with what exists (an e-mail already used, a limit reached). */
export class ConflictError extends Error {
  override name = 'ConflictError';
}

/** The firm whose private data this person works with. The owner has none. */
export function firmOf(actor: Actor): number {
  if (actor.firmId === null) throw new ForbiddenError('Only firm users have firm data');
  return actor.firmId;
}

/** May this person manage the users of `firmId`? The owner: any firm; a firm admin: their own. */
export function assertCanManage(actor: Actor, firmId: number): void {
  if (actor.role === 'owner') return;
  if (actor.role === 'firm_admin' && actor.firmId === firmId) return;
  throw new ForbiddenError('Not allowed to manage this firm');
}
