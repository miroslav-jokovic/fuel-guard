import { APPLICATION_ROW_LISTS, type ApplicationEdit, type ApplicationPath, type ApplicationRowList } from "./applicationReviewContract.js";
import { APPLICANT_IDENTITY_KEYS } from "./applicantIdentity.js";
import { questionnaireForApplicant, type QuestionnaireQuestion } from "./questionnaireContract.js";

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
 *
 * ── AND THE ROWS OF THE OTHER LISTS (Q-AM15 (a), owner 2026-11-11) ────────────────────────────
 * The same rule now holds for every list of objects in `APPLICATION_ROW_LISTS` (addresses, licences,
 * equipment, accidents, convictions): `withRowKeys` gives a keyless row a key on the office's first
 * write, a correction is logged as `[list, "<key>", column]`, and `add_row` / `remove_row` name the row
 * by key. Before, those rows were named by position, and when the DRIVER deleted or reordered one on
 * their phone after a correction, nothing was logged, so the card and 3.1 pointed it at the wrong row.
 * The other names are plain strings with nowhere to hold a key, so they stay positional and replayed
 * (`currentEditPaths`) — APPLICATION-FIX-PLAN Q-AM22.
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

/** The lists whose rows are objects and so carry a `key` (Q-AM15). `other_names` is a list of strings. */
export const KEYED_ROW_LISTS: readonly ApplicationRowList[] = APPLICATION_ROW_LISTS.filter((l) => l !== "other_names");
const KEYED = new Set<string>(KEYED_ROW_LISTS);
export const isKeyedRowList = (list: unknown): list is ApplicationRowList => KEYED.has(String(list));

/** Every row of every keyed list with a key — a missing one minted by `mint`. A copy; the input is untouched. */
export function withRowKeys(payload: Record<string, unknown>, mint: () => string): Record<string, unknown> {
  let out = payload;
  for (const list of KEYED_ROW_LISTS) {
    if (!Array.isArray(payload[list])) continue;
    const rows = rowsOf(payload, list);
    if (rows.every((r) => !r || typeof r !== "object" || r.key)) continue;
    out = { ...out, [list]: rows.map((r) => (r && typeof r === "object" && !r.key ? { ...r, key: mint() } : r)) };
  }
  return out;
}

/**
 * The position of the row a segment names in a keyed list: a key is looked up, and a number reaches only
 * a row that was keyless when the office read it (`keyless` — the list BEFORE `withRowKeys`), the AW1 rule.
 */
function rowIndex(rows: readonly Row[], keyless: readonly Row[], segment: string | number | undefined): number | EditRefusal {
  if (typeof segment === "string") {
    const at = rows.findIndex((r) => r?.key === segment);
    return at >= 0 ? at : refuse("That row is no longer on the application. Reload it and try again.");
  }
  if (typeof segment === "number" && keyless[segment] && !keyless[segment]!.key) return segment;
  return refuse("Rows are changed by their own reference now. Reload the application and try again.");
}

/**
 * The path an office correction sends for a row the card found by its place (Q-AM15): the row's key in
 * place of its index, when the draft's row has one. A keyless row keeps its index, which the API accepts
 * for exactly that row (`rowIndex`). Every other path is returned as given.
 */
export function keyedEditPath(path: ApplicationPath, payload: unknown): ApplicationPath {
  const [list, at, ...rest] = path;
  if (!isKeyedRowList(list) || typeof at !== "number" || !payload || typeof payload !== "object") return path;
  const key = rowsOf(payload as Record<string, unknown>, list)[at]?.key;
  return typeof key === "string" && key !== "" ? ([list, key, ...rest] as ApplicationPath) : path;
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
 * Apply one edit to the draft. `payload` must already have passed through `withEmployerKeys` and
 * `withRowKeys`; `original` is the payload as read, for the keyless rule (`employerIndex`, `rowIndex`).
 */
export function applyApplicationEdit(
  payload: Record<string, unknown>,
  original: Record<string, unknown>,
  edit: ApplicationEdit,
  /** A new row's key when `add_row` sent none — the caller's, as for `withEmployerKeys`. */
  mint: () => string,
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
      if (!isKeyedRowList(edit.list)) {
        const next = { ...payload, [edit.list]: [...list, edit.row] };
        return { payload: next, logPath: [edit.list, list.length], before: null, after: edit.row };
      }
      // Q-AM15: the new row is named by its key from the start — the form's own if it minted one.
      if (!edit.row || typeof edit.row !== "object" || Array.isArray(edit.row)) return refuse("That is not a valid row.");
      const given = (edit.row as Row).key;
      if (given !== undefined && given !== null && (typeof given !== "string" || given === "")) return refuse("That is not a valid row.");
      if (typeof given === "string" && list.some((r) => r?.key === given)) return refuse("That row is already on the application.");
      const row = typeof given === "string" ? (edit.row as Row) : { ...(edit.row as Row), key: mint() };
      const next = { ...payload, [edit.list]: [...list, row] };
      return { payload: next, logPath: [edit.list, String(row.key)], before: null, after: row };
    }
    case "remove_answer_row": {
      const table = answerTable(edit.question);
      if (!table) return refuse("That question is not a table. Reload the application and try again.");
      const rows = tableRows(payload, edit.question);
      if (edit.index >= rows.length) return refuse("That row is no longer on the application. Reload it and try again.");
      const next = draftWithValueAt(payload, [DRAFT_ANSWERS, edit.question], rows.filter((_, i) => i !== edit.index));
      return {
        payload: next as Record<string, unknown>,
        logPath: [DRAFT_ANSWERS, edit.question, edit.index],
        before: rows[edit.index],
        after: null,
      };
    }
    case "remove_row": {
      const list = rowsOf(payload, edit.list);
      const keyed = isKeyedRowList(edit.list);
      const at = keyed
        ? rowIndex(list, rowsOf(original, edit.list), edit.key ?? edit.index)
        : (edit.index !== undefined && edit.index < list.length ? edit.index : refuse("That row is no longer on the application. Reload it and try again."));
      if (typeof at !== "number") return at;
      // The current home is the one row every application must have, and on a v2 link its street is
      // Part 1's: it is corrected, never removed.
      if (edit.list === "addresses" && at === currentAddressAt(list)) {
        return refuse("This is where they live now. Correct its answers instead of removing it.");
      }
      const next = { ...payload, [edit.list]: list.filter((_, i) => i !== at) };
      // A row the caller did not key (`withRowKeys` skipped) is still named by its place, never "undefined".
      const named = keyed && typeof list[at]!.key === "string" ? String(list[at]!.key) : at;
      return { payload: next, logPath: [edit.list, named], before: list[at], after: null };
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
      if (path[0] === DRAFT_ANSWERS && path.length === 3) {
        const refused = answerRowRefusal(payload, path[1]!, path[2]!, edit.value);
        if (refused) return refused;
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
      if (isKeyedRowList(path[0]) && path.length >= 2) {
        const list = rowsOf(payload, String(path[0]));
        const at = rowIndex(list, rowsOf(original, String(path[0])), path[1]);
        if (typeof at !== "number") return at;
        // ⚠ A whole-row `set` would replace the row's key with whatever was sent; the key is the row's, kept.
        const value = path.length === 2 && edit.value && typeof edit.value === "object" && !Array.isArray(edit.value)
          ? { ...(edit.value as Row), key: list[at]!.key }
          : edit.value;
        const writePath = [path[0]!, at, ...path.slice(2)];
        return {
          payload: draftWithValueAt(payload, writePath, value) as Record<string, unknown>,
          logPath: [path[0]!, typeof list[at]!.key === "string" ? String(list[at]!.key) : at, ...path.slice(2)] as ApplicationPath,
          before: draftValueAt(payload, writePath),
          after: value,
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

/** The draft keeps the carrier's answers under one key (`toDraftPayload`), not the filed `questionnaire_answers`. */
export const DRAFT_ANSWERS = "questionnaire";

/** A carrier question answered as a table (education, references), or null. From the questionnaire, never a list. */
export function answerTable(id: string | number): QuestionnaireQuestion | null {
  const q = questionnaireForApplicant().questions.find((x) => x.id === id);
  return q && q.kind === "table" ? q : null;
}

const tableRows = (payload: Record<string, unknown>, id: string): Row[] => {
  const v = draftValueAt(payload, [DRAFT_ANSWERS, id]);
  return Array.isArray(v) ? (v as Row[]) : [];
};

/**
 * A whole table row written by `set` at `["questionnaire", question, i]` (F3c part 2). The draft schema
 * holds the questionnaire as an open record, so it cannot check this — the row is checked here against
 * the question's own columns: an existing row or the next one (never a hole), no more rows than the
 * question asks for, an object of its columns and nothing else, and not wholly blank (filing drops a
 * blank row, `cleanQuestionnaire`, so the driver would read an addition that never files).
 */
function answerRowRefusal(payload: Record<string, unknown>, id: string | number, at: string | number, value: unknown): EditRefusal | null {
  const table = answerTable(id);
  if (!table) return null;
  if (typeof at !== "number") return refuse("A row of this answer is named by its place. Reload the application and try again.");
  const rows = tableRows(payload, String(id));
  if (at > rows.length) return refuse("That row is no longer on the application. Reload it and try again.");
  if (at === rows.length && table.maxRows !== undefined && rows.length >= table.maxRows) {
    return refuse(`This question takes at most ${table.maxRows} rows.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return refuse("That is not a valid answer for this field.");
  const columns = new Set((table.columns ?? []).map((c) => c.id));
  const cells = Object.entries(value as Row);
  if (cells.some(([k]) => !columns.has(k))) return refuse("That is not a valid answer for this field.");
  const filled = cells.some(([, v]) => (typeof v === "string" && v.trim() !== "") || typeof v === "number" || v === true);
  if (!filled) return refuse("Fill in at least one answer, or remove the row instead.");
  return null;
}

/** Said by the API and shown beside the answer list, so the office is sent to the one place that sticks. */
export const IDENTITY_IS_CORRECTED_ELSEWHERE =
  "The date of birth and licence are corrected under \"Date of birth and licence\" in the hiring checklist's \"Permissions signed\" step — a change here would be replaced by that record.";

export const isEditRefusal = (v: unknown): v is EditRefusal =>
  typeof v === "object" && v !== null && (v as { code?: unknown }).code === "invalid_edit";
