import {
  APPLICANT_FACTS,
  APPLICATION_ROW_LISTS,
  partOneCorrectionSchema,
  partOneLicencesWith,
  type ApplicationEdit,
  type OtherLicenceRow,
  type PartOneCorrection,
  type PartOneFactsView,
  sectionOwningPath,
  type ApplicationRowList,
  type ApplicationSection,
  type FactInput,
} from "@silvicom/shared";
import { CHOICES, currentAddressIndex, pathKey, type FactChoice, type FactRow } from "./applicantFactRows";
import { emptyAccident, emptyAddress, emptyEquipment, emptyLicence, emptyViolation } from "./draftShape";
import { FIELD_LABEL_KEYS, describeField } from "./fieldLabels";

/**
 * The rows of the card's lists, added and removed (F3c part 2, E2): addresses, other names, licences,
 * equipment, accidents and convictions — `APPLICATION_ROW_LISTS`, the lists the edit contract names.
 *
 * ── A NEW ROW IS TYPED WHOLE, FROM THE CATALOGUE ──────────────────────────────────────────────
 * The add form's questions are the catalogue's columns for that list, each with its own input kind —
 * the same controls the card corrects them with — so a column added to the catalogue is a question
 * here without anybody remembering. It opens holding the driver's own blank row (`emptyAddress` …),
 * which is the shape their phone saves: blanks are `""`, never `null`, because `fromDraftPayload`
 * trims them and a null takes the driver's own page down (the F3 browser pass).
 *
 * The whole row is sent as one `add_row`: a row added blank and then filled answer by answer would be
 * refused by the draft schema at the first step (a city is `min(1)`), and would be eight lines on the
 * driver's 3.1 for one act.
 */

export interface RowColumn {
  column: string;
  input: FactInput;
  label: string;
  choices?: readonly FactChoice[];
}

/** The driver's own blank row for each list — the shape their phone saves. */
const BLANK: Readonly<Record<ApplicationRowList, () => unknown>> = {
  addresses: emptyAddress,
  other_names: () => "",
  additional_licences: emptyLicence,
  equipment_experience: emptyEquipment,
  accidents: emptyAccident,
  violations: emptyViolation,
};
export const blankRow = (list: ApplicationRowList): unknown => {
  const row = BLANK[list]();
  return typeof row === "object" && row !== null ? { ...row } : row;
};

/** A list of plain strings: its one "column" is the row itself. */
export const isStringList = (list: ApplicationRowList): boolean => list === "other_names";

/**
 * Which writer holds a list's rows. On a v2 link the other licences are Part 1's whole list (filing
 * drops the draft's copy), so they are added and removed through Part 1's correction; every other
 * list, and every list on a legacy link, is the draft's.
 */
export const listDoor = (list: ApplicationRowList, v2: boolean): "draft" | "part_one" =>
  v2 && list === "additional_licences" ? "part_one" : "draft";

/** Part 1 never asks an other licence's `kind`, so a v2 licence row does not either. */
const PART_ONE_SKIPS = new Set(["kind"]);

/** The add form's questions: the catalogue's columns for the list, in its order, as the card asks them. */
export function rowColumns(list: ApplicationRowList, index: number, v2 = false): RowColumn[] {
  if (isStringList(list)) return [{ column: "", input: "text", label: describeField([list, index]) }];
  const prefix = `application.${list}[].`;
  const partOne = listDoor(list, v2) === "part_one";
  return APPLICANT_FACTS.filter((f) => f.path.startsWith(prefix) && !(partOne && PART_ONE_SKIPS.has(f.path.slice(prefix.length)))).map((f) => {
    const column = f.path.slice(prefix.length);
    const choices = CHOICES()[column];
    return { column, input: f.input, label: describeField([list, index, column]), ...(choices ? { choices } : {}) };
  });
}

/** "Address", "Accident" — the list's own noun, from the labels the driver read. */
export const rowNoun = (list: ApplicationRowList): string => FIELD_LABEL_KEYS.ROWS[list]?.noun ?? list;

/** Where the list sits on the card: the section its answers belong to. */
export const listSection = (list: ApplicationRowList): ApplicationSection =>
  sectionOwningPath(isStringList(list) ? [list, 0] : [list, 0, rowColumns(list, 0)[0]!.column]) ?? "review";

/**
 * The lists the office may add to and remove from now, in `APPLICATION_ROW_LISTS` order: each list's
 * door must be open — the draft's from the office's Send to the first packet mark, Part 1's while the
 * office screens (`ApplicantFactsCard`'s `draftOpen` / `recordOpen`).
 */
export const editableLists = (v2: boolean, open: { draft: boolean; partOne: boolean }): ApplicationRowList[] =>
  APPLICATION_ROW_LISTS.filter((l) => (listDoor(l, v2) === "part_one" ? open.partOne : open.draft));

export interface RowChangeContext {
  revision: number;
  partOne: PartOneFactsView | null | undefined;
  /** The draft's addresses, for which one is the current home (Part 1's body carries its street). */
  addresses: unknown;
}

export type RowChange =
  | { door: "draft"; edit: ApplicationEdit }
  | { door: "part_one"; body: PartOneCorrection }
  | { problem: string };

/**
 * The request one add or remove takes, through the list's own door. A v2 licence is the whole Part 1
 * set with that one licence added or taken out (`partOneLicencesWith`), parsed by the Part 1 contract
 * here so a missing expiry or a duplicate is refused in its words before anything is sent.
 */
export function rowChange(
  list: ApplicationRowList,
  change: { add: unknown } | { remove: number },
  ctx: RowChangeContext,
): RowChange {
  if (listDoor(list, Boolean(ctx.partOne)) === "draft") {
    const edit: ApplicationEdit = "add" in change
      ? { op: "add_row", list, row: change.add, revision: ctx.revision }
      : { op: "remove_row", list, index: change.remove, revision: ctx.revision };
    return { door: "draft", edit };
  }
  const body = partOneLicencesWith(
    ctx.partOne!,
    "add" in change ? { add: change.add as OtherLicenceRow } : change,
    currentAddressIndex(ctx.addresses),
  );
  if (!body) return { problem: "That licence is no longer on the application. Reload it and try again." };
  const parsed = partOneCorrectionSchema.safeParse(body);
  return parsed.success
    ? { door: "part_one", body: parsed.data }
    : { problem: parsed.error.issues[0]?.message ?? "That licence could not be saved." };
}

/** The current home is never removed (`applyApplicationEdit` refuses it); every other row may be. */
export const rowRemovable = (list: ApplicationRowList, index: number, addresses: unknown): boolean =>
  list !== "addresses" || index !== currentAddressIndex(addresses);

/** A card block: one answer, or one row of a list with its answers together (`byRow` already orders them). */
export type FactBlock =
  | { kind: "fact"; row: FactRow }
  | { kind: "item"; list: ApplicationRowList; index: number; key: string; rows: FactRow[] };

const POSITIONAL = new Set<string>(APPLICATION_ROW_LISTS);

export function factBlocks(rows: readonly FactRow[]): FactBlock[] {
  const out: FactBlock[] = [];
  for (const row of rows) {
    const [list, at] = row.path;
    if (typeof at !== "number" || !POSITIONAL.has(String(list))) { out.push({ kind: "fact", row }); continue; }
    const last = out[out.length - 1];
    if (last?.kind === "item" && last.list === list && last.index === at) { last.rows.push(row); continue; }
    out.push({ kind: "item", list: list as ApplicationRowList, index: at, key: pathKey([list as string, at]), rows: [row] });
  }
  return out;
}
