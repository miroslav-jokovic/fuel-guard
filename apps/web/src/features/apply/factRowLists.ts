import {
  APPLICANT_FACTS,
  APPLICATION_ROW_LISTS,
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

/** The add form's questions: the catalogue's columns for the list, in its order, as the card asks them. */
export function rowColumns(list: ApplicationRowList, index: number): RowColumn[] {
  if (isStringList(list)) return [{ column: "", input: "text", label: describeField([list, index]) }];
  const prefix = `application.${list}[].`;
  return APPLICANT_FACTS.filter((f) => f.path.startsWith(prefix)).map((f) => {
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
 * The lists the office may add to and remove from on this application. On a v2 link the licences are
 * Part 1's whole list and filing drops the draft's copy, so they are not the draft's to change (the
 * API refuses the same). `APPLICATION_ROW_LISTS` order.
 */
export const editableLists = (v2: boolean): ApplicationRowList[] =>
  APPLICATION_ROW_LISTS.filter((l) => !(v2 && l === "additional_licences"));

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
