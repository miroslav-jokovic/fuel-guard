import { APPLICATION_ROW_LISTS, type ApplicationPath } from "./applicationReviewContract.js";
import { DRAFT_ANSWERS, answerTable, isKeyedRowList } from "./applicationReviewEdits.js";

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
 *
 * ── SINCE Q-AM15: KEYED ROWS ARE LOOKED UP, NOT REPLAYED ──────────────────────────────────────
 * A correction to a row of a keyed list (`isKeyedRowList`) is recorded as `[list, "<key>", column]`.
 * Its place NOW is wherever that key is in the draft the reader holds (`rows`), whoever moved it — the
 * office or the driver — and it is `gone` when the key is not there. So the replay is left with the
 * positional paths: the other names (Q-AM22), the carrier's table answers, and corrections recorded
 * before keys. ⚠ A keyed removal does not shift a POSITIONAL correction recorded before keys to the
 * same list; that pair exists only on an application open across the Q-AM15 deploy.
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

/**
 * The list a whole-row path names, as its path prefix: `["addresses"]` for `["addresses", 2]`, and —
 * F3c part 2 — `["questionnaire", "education"]` for a row of a carrier question answered as a table.
 */
function listOf(path: ApplicationPath): ApplicationPath | null {
  if (path.length >= 2 && POSITIONAL.has(String(path[0])) && typeof path[1] === "number") return [path[0]!];
  if (path.length >= 3 && path[0] === DRAFT_ANSWERS && answerTable(path[1]!) && typeof path[2] === "number") return [path[0], path[1]!];
  return null;
}

const isRowEdit = (path: ApplicationPath): boolean => {
  const list = listOf(path);
  return list !== null && path.length === list.length + 1;
};

/** A whole-row removal: `[list, i]`, a row before, nothing after. */
export const isRowRemoval = (e: ReplayableEdit): boolean =>
  isRowEdit(e.path) && e.after === null && e.before !== null && e.before !== undefined;

/**
 * Each edit's current path, in the order given. The replay itself runs oldest first by `editedAt`
 * (the review sends newest first, 3.1 oldest first); edits without a time keep their given order.
 */
export function currentEditPaths(edits: readonly ReplayableEdit[], rows?: Record<string, unknown> | null): CurrentEditPath[] {
  const order = edits
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.editedAt && b.e.editedAt ? a.e.editedAt.localeCompare(b.e.editedAt) : 0) || a.i - b.i);
  const out: CurrentEditPath[] = edits.map((e) => ({ path: [...e.path] as ApplicationPath, gone: false, removal: false }));

  order.forEach(({ e, i }, step) => {
    if (!isRowRemoval(e)) return;
    const list = listOf(e.path)!;
    const depth = list.length;
    const at = e.path[depth] as number;
    out[i] = { path: [...e.path] as ApplicationPath, gone: true, removal: true };
    for (const { i: j } of order.slice(0, step)) {
      const now = out[j]!;
      const mine = list.every((seg, k) => now.path[k] === seg) && typeof now.path[depth] === "number";
      if (now.gone || !mine) continue;
      const row = now.path[depth] as number;
      if (row === at) out[j] = { ...now, gone: true };
      else if (row > at) out[j] = { ...now, path: [...list, row - 1, ...now.path.slice(depth + 1)] as ApplicationPath };
    }
  });
  edits.forEach((e, i) => {
    const [list, key, ...rest] = e.path;
    if (!isKeyedRowList(list) || typeof key !== "string") return;
    const removal = rest.length === 0 && e.after === null && e.before !== null && e.before !== undefined;
    const held = rows && Array.isArray(rows[list as string]) ? (rows[list as string] as Array<{ key?: unknown } | null>) : null;
    const at = held ? held.findIndex((r) => r?.key === key) : -1;
    // Without the draft, a keyed path cannot be placed; it is left as recorded rather than guessed.
    if (!held) { out[i] = { path: [...e.path] as ApplicationPath, gone: removal, removal }; return; }
    out[i] = removal || at < 0
      ? { path: [...e.path] as ApplicationPath, gone: true, removal }
      : { path: [list!, at, ...rest] as ApplicationPath, gone: false, removal: false };
  });
  return out;
}
