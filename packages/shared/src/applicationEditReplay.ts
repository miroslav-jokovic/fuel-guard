import { APPLICATION_ROW_LISTS, type ApplicationPath } from "./applicationReviewContract.js";

/**
 * Where each office correction points NOW, after every row removed since (F3c part 2, E2).
 *
 * ── WHY A REPLAY ──────────────────────────────────────────────────────────────────────────────
 * The rows of `APPLICATION_ROW_LISTS` have no key (only the employers do, AW1), so an edit row records
 * a POSITION: `["addresses", 2, "city"]`. Once the office removes address 1, that correction is about
 * what is now address 2 — and a reader that trusted the recorded index would mark the wrong address
 * "corrected" on the card, and tell the driver on 3.1 that "Address 3 · City" changed when there is
 * no address 3. Q-AX7 refused employer removals for exactly this reason until the employers had keys.
 *
 * So no reader trusts a recorded index: each replays the removals, oldest first. A removal of row i
 * makes every earlier correction to row i `gone` (that row is no longer on the application) and moves
 * every earlier correction to a later row up by one. The edit rows themselves are never rewritten —
 * `application_edits` is what the office did, when it did it.
 *
 * ⚠ It sees only the OFFICE's removals. A driver deleting a row on their phone before the office's
 * correction is signed shifts it too, and that is not logged anywhere — APPLICATION-FIX-PLAN Q-AM15.
 */
export interface ReplayableEdit {
  path: ApplicationPath;
  before?: unknown;
  after?: unknown;
  editedAt?: string;
}

export interface CurrentEditPath {
  /** The path as the application holds it now — or, when `gone`, as it was recorded. */
  path: ApplicationPath;
  /** The row this correction was made to has since been removed (or this IS the removal). */
  gone: boolean;
  /** This edit is a whole-row removal (`[list, i]`, after null). */
  removal: boolean;
}

const POSITIONAL = new Set<string>(APPLICATION_ROW_LISTS);

const isRowEdit = (path: ApplicationPath): boolean =>
  path.length === 2 && POSITIONAL.has(String(path[0])) && typeof path[1] === "number";

/** A whole-row removal: `[list, i]`, a row before, nothing after. */
export const isRowRemoval = (e: ReplayableEdit): boolean =>
  isRowEdit(e.path) && e.after === null && e.before !== null && e.before !== undefined;

/**
 * Each edit's current path, in the order given. The replay itself runs oldest first by `editedAt`
 * (the review sends newest first, 3.1 oldest first); edits without a time keep their given order.
 */
export function currentEditPaths(edits: readonly ReplayableEdit[]): CurrentEditPath[] {
  const order = edits
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.editedAt && b.e.editedAt ? a.e.editedAt.localeCompare(b.e.editedAt) : 0) || a.i - b.i);
  const out: CurrentEditPath[] = edits.map((e) => ({ path: [...e.path] as ApplicationPath, gone: false, removal: false }));

  order.forEach(({ e, i }, step) => {
    if (!isRowRemoval(e)) return;
    const [list, at] = e.path as [string, number];
    out[i] = { path: [...e.path] as ApplicationPath, gone: true, removal: true };
    for (const { i: j } of order.slice(0, step)) {
      const now = out[j]!;
      if (now.gone || now.path[0] !== list || typeof now.path[1] !== "number") continue;
      if (now.path[1] === at) out[j] = { ...now, gone: true };
      else if (now.path[1] > at) out[j] = { ...now, path: [list, now.path[1] - 1, ...now.path.slice(2)] as ApplicationPath };
    }
  });
  return out;
}
