import { HAZMAT_LOAD_STATUS_LABELS, loadTypeOf, type HazmatLoadStatus } from "@silvicom/shared";

/**
 * The Loads page's Type filter and its hazmat chip (LOADS-MIRROR-PLAN LR7, H-C1), apart from the page so
 * the page keeps to its line budget. The base type and the hazmat flag are `loadTypeOf`'s.
 */
export const TYPE_VALUES = ["Regular", "Reefer", "hazmat", "attention"];
export const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "Regular", label: "Regular" },
  { value: "Reefer", label: "Reefer" },
  { value: "hazmat", label: "Hazmat" },
  { value: "attention", label: "Hazmat — not cleared" },
];

type Typed = { equipment?: string | null; hazmat: boolean; hazmat_status?: string | null };

/** H-C1: a hazmat load "needs attention" until its record is CLEARED — including never started. */
const hazmatNeedsAttention = (load: Typed): boolean =>
  load.hazmat && load.hazmat_status !== "cleared" && load.hazmat_status !== "cancelled" && load.hazmat_status !== "superseded";

/** Does the Type filter's value (`""` = any) admit this load? */
export function matchesType(load: Typed, type: string): boolean {
  const t = loadTypeOf(load);
  if (!type) return true;
  if (type === "hazmat") return t.hazmat;
  if (type === "attention") return hazmatNeedsAttention(load);
  return t.base === type;
}

/** Chip copy + tone for the linked hazmat record's state. "Not started" is the loudest (H-C1). */
export function hazmatChipLabel(status: string | null | undefined): string {
  if (!status) return "Hazmat · not started";
  return `Hazmat · ${HAZMAT_LOAD_STATUS_LABELS[status as HazmatLoadStatus] ?? status}`;
}
export function hazmatTone(status: string | null | undefined): string {
  if (!status) return "warning";
  if (status === "cleared") return "success";
  if (status === "needs_review") return "warning";
  if (status === "rejected") return "danger";
  if (status === "submitted" || status === "extracting") return "brand";
  return "neutral"; // draft / cancelled / superseded
}
