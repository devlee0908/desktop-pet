// Pure rules for the unread dot and the notification queue (checked by tools/check_unread.ts).
import type { Level, Note } from "./bubble";

export type Stored = Note & { read: boolean };
const RANK: Record<Level, number> = { info: 0, success: 1, warning: 2, error: 3 };

/** Colour of the dot by the cat's head, or null for no dot: unread notifications the cat is not about
 *  to show (those are in the queue badge). Only reading (or deleting) clears it, not opening the inbox. */
export function dotLevel(stored: Stored[], pending: ReadonlySet<string>): Level | null {
  let worst: Level | null = null;
  for (const n of stored) {
    if (n.read || pending.has(n.id)) continue;
    if (worst === null || RANK[n.level] > RANK[worst]) worst = n.level;
  }
  return worst;
}

/** Queued notifications still worth showing: not deleted and not already read (e.g. in the inbox). */
export function stillWanted(queue: Note[], stored: Stored[]): Note[] {
  const unread = new Set(stored.filter((n) => !n.read).map((n) => n.id));
  return queue.filter((n) => unread.has(n.id));
}
