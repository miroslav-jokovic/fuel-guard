import { copyExpiry, deleteCopy, isLive, putCopy, readCopy } from "./deviceCopies";

/**
 * Part 2's unsent draft, kept on the phone until the server has it (AW10, C3d1b).
 *
 * ── THE DEFECT THIS CLOSES ────────────────────────────────────────────────────────────────────
 * Autosave (A2) sends the whole form at most every five seconds. A save that fails — a tunnel, a dead
 * zone — said "Not saved — check your signal. Your answers are still on this screen", and they were:
 * until the tab was closed or the phone reclaimed it, which on a phone at a truck stop is the next thing
 * that happens. Written here on every change and deleted once a save lands with nothing typed since, the
 * unsent part comes back on the next visit and is sent then.
 *
 * ── A COPY IS REPLAYED ONLY ONTO THE REVISION IT WAS TYPED ON ─────────────────────────────────
 * Each copy carries `baseRevision`, the draft revision the tab last read or saved (0376). On the next
 * visit it is put back only when the server's draft is STILL at that revision — nothing was saved since,
 * so the copy is simply newer. If the server moved on (another tab or device saved, or the office
 * corrected an answer), the copy is older than what is on file and is deleted; the page says so rather
 * than laying stale answers over newer ones, which is the whole reason 0376 counts revisions.
 *
 * ── WHAT IS KEPT, AND FOR HOW LONG (Q-AW39's rule) ────────────────────────────────────────────
 * The draft payload exactly as autosave sends it (`toDraftPayload`) — which never holds a Social Security
 * number (the contract refuses one, D-APP3) — and the section reached. Q-AW39's lifetime applies: the
 * earlier of 72 hours and the link's expiry, and every read sweeps every expired copy on the device.
 * ⚠ The payload may hold a date of birth, and D-APP16 keeps a locked draft behind the date-of-birth
 * unlock; so a copy is replayed only AFTER the page has passed that gate (`ApplyPage`'s restore), never
 * onto a locked page.
 */

/** Bumped when `DraftCopy` changes shape; a copy of another version is deleted, never read. */
export const DRAFT_COPY_VERSION = 1;
export const DRAFT_COPY_TTL_MS = 72 * 60 * 60 * 1000;

export interface DraftCopy {
  key: string;
  version: number;
  payload: Record<string, unknown>;
  section: string | null;
  /** The draft revision this copy was typed on; null for a page whose API served none (pre-C3d1b). */
  baseRevision: number | null;
  savedAt: string;
  expiresAt: string;
}

export const draftExpiry = (now: Date, linkExpiresAt: string): string => copyExpiry(now, DRAFT_COPY_TTL_MS, linkExpiresAt);

export const readDraftCopy = (key: string, now: Date = new Date()): Promise<DraftCopy | null> =>
  readCopy<DraftCopy>("partTwo", key, (row) => isLive(row, DRAFT_COPY_VERSION, now));

export const writeDraftCopy = (copy: DraftCopy): Promise<void> => putCopy("partTwo", copy);

export const clearDraftCopy = (key: string): Promise<void> => deleteCopy("partTwo", key);

/**
 * What to do with a copy found on arrival.
 *  · `same` — it holds what the server holds (a save landed after the copy was written): delete, say nothing.
 *  · `apply` — typed on the revision the server still has: put it back and send it.
 *  · `stale` — the server moved on since: delete it and tell the driver their unsent answers were dropped.
 *
 * ⚠ A copy with no revision, or a server that served none, is `stale` unless it is `same`: without a
 * revision nothing can say the copy is the newer of the two, and laying an unknown-age copy over the
 * server's draft is exactly the overwrite this exists to prevent.
 */
export type ReplayVerdict = "same" | "apply" | "stale";

export function replayVerdict(copy: DraftCopy, serverRevision: number | null, current: Record<string, unknown>): ReplayVerdict {
  if (JSON.stringify(copy.payload) === JSON.stringify(current)) return "same";
  if (copy.baseRevision !== null && serverRevision !== null && copy.baseRevision === serverRevision) return "apply";
  return "stale";
}
