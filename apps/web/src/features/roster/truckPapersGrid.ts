import { VEHICLE_CHECK_LABELS, type VehicleCheck } from "@silvicom/shared";

/**
 * The Truck paperwork card's grid: four states by two papers (SMALL-SCREENS-PLAN.md D-SM12).
 *
 * The row names are DERIVED from the shared check labels, not written again — what is left of
 * "Annual inspection: date only, no paper" once the paper's own name is taken off. A second list of
 * four names beside `VEHICLE_CHECK_LABELS` would be the copy that drifts the day one label is
 * reworded (CLAUDE.md, "deriving beats restating").
 */
export const PAPER_STATES = ["overdue", "due", "date_only", "missing"] as const;
export const PAPERS = [
  { key: "inspection", label: "Annual inspection" },
  { key: "registration", label: "Registration" },
] as const;
export type Paper = (typeof PAPERS)[number];
export type PaperState = (typeof PAPER_STATES)[number];

export const paperCheck = (paper: Paper, state: PaperState) => `${paper.key}_${state}` as VehicleCheck;

/** "Overdue", "Due in 30 days", "Date only, no paper", "No paper, no date". */
export function paperStateLabel(paper: Paper, state: PaperState): string {
  const rest = VEHICLE_CHECK_LABELS[paperCheck(paper, state)].slice(paper.label.length).replace(/^[:\s]+/, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
