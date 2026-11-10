import type { ApplicationEdit, ApplicationPath, ApplicationRowList } from "./applicationReviewContract.js";
import { APPLICANT_IDENTITY_KEYS } from "./applicantIdentity.js";

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
    case "add_row": {
      const declared = DECLARES_NONE[edit.list];
      if (declared && payload[declared] === true) return refuse(ADD_WHILE_NONE[edit.list]!);
      const list = rowsOf(payload, edit.list);
      const next = { ...payload, [edit.list]: [...list, edit.row] };
      return { payload: next, logPath: [edit.list, list.length], before: null, after: edit.row };
    }
    case "remove_row": {
      const list = rowsOf(payload, edit.list);
      if (edit.index >= list.length) return refuse("That row is no longer on the application. Reload it and try again.");
      // The current home is the one row every application must have, and on a v2 link its street is
      // Part 1's: it is corrected, never removed.
      if (edit.list === "addresses" && edit.index === currentAddressAt(list)) {
        return refuse("This is where they live now. Correct its answers instead of removing it.");
      }
      const next = { ...payload, [edit.list]: list.filter((_, i) => i !== edit.index) };
      return { payload: next, logPath: [edit.list, edit.index], before: list[edit.index], after: null };
    }
    default: {
      // `set` — one value at one path. An employer path is resolved through its key.
      const path = [...edit.path];
      /**
       * ⚠ F0 (APPLICATION-FIX-PLAN, E1): the identity is not the draft's to hold. Every autosave and the
       * filing lay the `drivers` row over these three keys (`identityOnRecord`, D-AF8), so a correction
       * written here was reported done and then silently undone by the applicant's next save. They are
       * corrected where they live — the identity correction, which writes the row.
       */
      if ((APPLICANT_IDENTITY_KEYS as readonly unknown[]).includes(path[0])) {
        return refuse(IDENTITY_IS_CORRECTED_ELSEWHERE);
      }
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

/**
 * A list whose emptiness is its own answer ("I have had no accidents"). Adding a row while that answer
 * says none would leave the driver certifying both; the office changes that answer first, as its own
 * correction the driver reads on 3.1, rather than this op flipping it silently.
 */
const DECLARES_NONE: Partial<Record<ApplicationRowList, string>> = {
  accidents: "declares_no_accidents",
  violations: "declares_no_violations",
};
const ADD_WHILE_NONE: Partial<Record<ApplicationRowList, string>> = {
  accidents: "They said they have had no accidents. Change that answer to No first, then add the accident.",
  violations: "They said they have had no convictions. Change that answer to No first, then add the conviction.",
};

/** The current home: the first address with no `to` — the row composition files Part 1's street over. */
export function currentAddressAt(addresses: readonly unknown[]): number {
  const at = addresses.findIndex((a) => {
    const to = (a as { to?: unknown } | null)?.to;
    return Boolean(a) && typeof a === "object" && (to === null || to === undefined || (typeof to === "string" && to.trim() === ""));
  });
  return at < 0 ? 0 : at;
}

/** Said by the API and shown beside the answer list, so the office is sent to the one place that sticks. */
export const IDENTITY_IS_CORRECTED_ELSEWHERE =
  "The date of birth and licence are corrected under \"Date of birth and licence\" in the hiring checklist's \"Permissions signed\" step — a change here would be replaced by that record.";

export const isEditRefusal = (v: unknown): v is EditRefusal =>
  typeof v === "object" && v !== null && (v as { code?: unknown }).code === "invalid_edit";
