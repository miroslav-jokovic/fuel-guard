import type { ApplicationEdit, ApplicationPath } from "./applicationReviewContract.js";

/**
 * How one office edit changes the applicant's draft — pure, so the API applies exactly what is tested
 * here (HIRING-WORKFLOW-AUDIT-2026-10-31 §9 P5; §4.5, EM-1…EM-3, Q-AX7).
 *
 * ── EMPLOYER ROWS BY KEY, NEVER BY POSITION (Q-AX7) ───────────────────────────────────────────
 * Until P5 an edit said `["employers", 2, "city"]`, and removing a row was refused because every
 * correction recorded against a later row would silently re-point at its neighbour. Every employer
 * carries a stable `key` (AW1, D-AW8 — the phone calls already hang on it), so an employer path now
 * names the row by that key: `["employers", "<key>", "city"]`. The log records the key, the signing
 * screen marks the key, and a deleted row takes nothing with it but itself.
 *
 * ⚠ A draft from before AW1 can hold employers with no key. `withEmployerKeys` mints one for each such
 * row on the office's first write, so from then on every row is addressable the one way. A numeric
 * index is still accepted for a row that HAD no key when the office read it — that is the only way to
 * reach it — and is logged under the key it was just given.
 */

export interface AppliedEdit {
  payload: Record<string, unknown>;
  /** What `application_edits.path` records — employer rows by key. */
  logPath: ApplicationPath;
  before: unknown;
  after: unknown;
}

export interface EditRefusal {
  code: "invalid_edit";
  message: string;
}

const EMPLOYERS = "employers";
const GAPS = "employment_gaps";

type Row = Record<string, unknown>;

const rowsOf = (payload: Record<string, unknown>, key: string): Row[] =>
  Array.isArray(payload[key]) ? (payload[key] as Row[]) : [];

/** Every employer with a key — a missing one minted by `mint`. Returns a copy; the input is untouched. */
export function withEmployerKeys(payload: Record<string, unknown>, mint: () => string): Record<string, unknown> {
  if (!Array.isArray(payload[EMPLOYERS])) return payload;
  const employers = rowsOf(payload, EMPLOYERS).map((row) =>
    row && typeof row === "object" && !row.key ? { ...row, key: mint() } : row,
  );
  return { ...payload, [EMPLOYERS]: employers };
}

/** The value at a contract path, or undefined. */
export function draftValueAt(root: unknown, path: readonly (string | number)[]): unknown {
  let at: unknown = root;
  for (const step of path) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string | number, unknown>)[step as string | number];
  }
  return at;
}

/**
 * Write `value` at `path` in a COPY of `root` — every container on the way down is cloned, so a
 * refused edit leaves the draft exactly as the driver left it.
 */
export function draftWithValueAt(root: unknown, path: readonly (string | number)[], value: unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  const clone: Record<string | number, unknown> = Array.isArray(root)
    ? ([...root] as unknown as Record<string | number, unknown>)
    : { ...((root as Record<string, unknown>) ?? {}) };
  clone[head as string | number] = rest.length === 0 ? value : draftWithValueAt(clone[head as string | number], rest, value);
  return clone;
}

const refuse = (message: string): EditRefusal => ({ code: "invalid_edit", message });

/**
 * The position of the employer a path names. A key is looked up; a number is accepted only for a row
 * that was keyless when the office read it (`keyless` — the payload BEFORE `withEmployerKeys`).
 */
function employerIndex(
  employers: readonly Row[],
  keyless: readonly Row[],
  segment: string | number,
): number | EditRefusal {
  if (typeof segment === "string") {
    const at = employers.findIndex((e) => e?.key === segment);
    return at >= 0 ? at : refuse("That job is no longer on the application. Reload it and try again.");
  }
  if (keyless[segment] && !keyless[segment]!.key) return segment;
  return refuse("Jobs are changed by their own reference now. Reload the application and try again.");
}

/**
 * Apply one edit to the draft. `payload` must already have passed through `withEmployerKeys`;
 * `original` is the payload as read, for `employerIndex`'s keyless rule.
 */
export function applyApplicationEdit(
  payload: Record<string, unknown>,
  original: Record<string, unknown>,
  edit: ApplicationEdit,
): AppliedEdit | EditRefusal {
  const employers = rowsOf(payload, EMPLOYERS);

  switch (edit.op) {
    case "remove_employer": {
      const at = employerIndex(employers, rowsOf(original, EMPLOYERS), edit.key);
      if (typeof at !== "number") return at;
      const next = { ...payload, [EMPLOYERS]: employers.filter((_, i) => i !== at) };
      return { payload: next, logPath: [EMPLOYERS, edit.key], before: employers[at], after: null };
    }
    case "add_employer": {
      const key = edit.employer.key;
      if (typeof key !== "string" || key === "") return refuse("A new job needs its reference. Reload and try again.");
      if (employers.some((e) => e?.key === key)) return refuse("That job is already on the application.");
      const next = { ...payload, [EMPLOYERS]: [...employers, edit.employer] };
      return { payload: next, logPath: [EMPLOYERS, key], before: null, after: edit.employer };
    }
    case "explain_gap": {
      const gaps = rowsOf(payload, GAPS);
      const at = gaps.findIndex((g) => g?.from === edit.gap.from);
      const before = at >= 0 ? (gaps[at]?.explanation ?? null) : null;
      const list = at >= 0 ? gaps.map((g, i) => (i === at ? edit.gap : g)) : [...gaps, edit.gap];
      return { payload: { ...payload, [GAPS]: list }, logPath: [GAPS, edit.gap.from], before, after: edit.gap.explanation };
    }
    default: {
      // `set` — one value at one path. An employer path is resolved through its key.
      const path = [...edit.path];
      if (path[0] === EMPLOYERS && path.length >= 2) {
        const at = employerIndex(employers, rowsOf(original, EMPLOYERS), path[1]!);
        if (typeof at !== "number") return at;
        const key = String(employers[at]!.key);
        const writePath = [EMPLOYERS, at, ...path.slice(2)];
        return {
          payload: draftWithValueAt(payload, writePath, edit.value) as Record<string, unknown>,
          logPath: [EMPLOYERS, key, ...path.slice(2)] as ApplicationPath,
          before: draftValueAt(payload, writePath),
          after: edit.value,
        };
      }
      return {
        payload: draftWithValueAt(payload, path, edit.value) as Record<string, unknown>,
        logPath: edit.path,
        before: draftValueAt(payload, path),
        after: edit.value,
      };
    }
  }
}

export const isEditRefusal = (v: unknown): v is EditRefusal =>
  typeof v === "object" && v !== null && (v as { code?: unknown }).code === "invalid_edit";
