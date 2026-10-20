/**
 * The truck and trailer file catalogue — WHAT a unit's file is made of (UNIT-FILES-PLAN §4, D-UF1).
 * The judgement is `fileEngine.ts`; the unit's own rules (which items apply, what evidence each has,
 * McLeod's typed dates) are `unitFile.ts`. This is the vocabulary, and it is separate for the same
 * reason `dqCatalogue.ts` is: it changes when the regulation or the carrier's paperwork changes, not
 * when we find a bug.
 *
 * Deliberately absent: maintenance records (§396.3) — FleetPal's, read and linked on the unit's page,
 * never a file item (D-INV10); roadside inspection reports — their own subject since 0476, linked the
 * same way. A file item is a paper the office files and an auditor asks for by name.
 */
import type { FileItemSpecBase, FileRecurrence } from "./fileEngine.js";

/** A unit is a tractor or a trailer — `documents`/`certifications` call a truck a `tractor`. */
export const UNIT_SUBJECT_TYPES = ["tractor", "trailer"] as const;
export type UnitSubjectType = (typeof UNIT_SUBJECT_TYPES)[number];

/** `vehicles.ownership_type` / `trailers.ownership_type` (0099/0100) — mirrors their CHECKs. */
export const OWNERSHIP_TYPES = ["owned", "leased", "owner_operator"] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

export const OWNERSHIP_LABELS: Record<OwnershipType, string> = {
  owned: "Owned",
  leased: "Leased",
  owner_operator: "Owner-operator",
};

/** The groups a unit's file is shown in, in display order. */
export const EQUIPMENT_GROUPS = ["registration", "ownership", "insurance", "inspections"] as const;
export type EquipmentGroup = (typeof EQUIPMENT_GROUPS)[number];

export const EQUIPMENT_GROUP_LABELS: Record<EquipmentGroup, string> = {
  registration: "Registration & permits",
  ownership: "Ownership",
  insurance: "Insurance",
  inspections: "Inspections",
};

/** The unit-row columns McLeod writes a date into — shown as "date only" when no paper exists (D-UF3). */
export type UnitDateColumn = "registration_expires_at" | "dot_annual_inspection_expires_at";

export interface EquipmentItemSpec extends FileItemSpecBase {
  group: EquipmentGroup;
  recurrence: FileRecurrence;
  /**
   * `certification`: proved by a current, dated `certifications` row of one of `evidenceKinds`.
   * `document`: proved by the scan alone — a paper that never expires (a title, 0490).
   */
  source: "certification" | "document";
  evidenceKinds: readonly string[];
  /** Which units the item applies to at all. */
  subjects: readonly UnitSubjectType[];
  /**
   * The ownership types it applies to; absent = every unit. While a unit's ownership is unknown the
   * item is neither required nor missing — it is "set ownership to check" (D-UF11), because demanding
   * a title from a leased truck is the "reporting a lawful file as incomplete" failure D-PSP1 named.
   */
  ownership?: readonly OwnershipType[];
  /**
   * One fleet paper covers every unit (D-UF6): an `organization` certification of the same kind
   * satisfies the item when the unit has none of its own. A unit's own row wins — a truck with its
   * own policy is covered by that policy, not by the fleet's.
   */
  fleetWide?: boolean;
  /** Part of the roadside set — what must be in the cab, and what the driver app carries (UF10). */
  roadside: boolean;
  /** McLeod's typed date for the same fact, read only when no paper exists (D-UF3). */
  unitDateColumn?: UnitDateColumn;
  /** The retention rule, as text. Shown, never acted on. */
  retention: string;
}

export const EQUIPMENT_ITEMS: readonly EquipmentItemSpec[] = [
  {
    key: "registration",
    label: "Registration / IRP cab card",
    citation: "State registration law; IRP Art. IV",
    group: "registration",
    recurrence: "expiry",
    source: "certification",
    // An apportioned unit's registration IS its cab card; a state-plated trailer has a plain one.
    evidenceKinds: ["registration", "irp"],
    subjects: ["tractor", "trailer"],
    roadside: true,
    unitDateColumn: "registration_expires_at",
    retention: "While the unit is in service.",
  },
  {
    key: "permit",
    label: "Permits",
    citation: "As issued (state, oversize, hazmat)",
    group: "registration",
    recurrence: "expiry",
    source: "certification",
    evidenceKinds: ["permit"],
    subjects: ["tractor", "trailer"],
    // Tracked when a unit holds one; never "missing", because most units hold none.
    advisory: true,
    roadside: true,
    retention: "For the permit's term.",
  },
  {
    key: "title",
    label: "Title",
    citation: "State titling law",
    group: "ownership",
    recurrence: "one_time",
    source: "document",
    evidenceKinds: ["title"],
    subjects: ["tractor", "trailer"],
    ownership: ["owned"],
    roadside: false,
    retention: "While the carrier owns the unit.",
  },
  {
    key: "lease",
    label: "Lease agreement",
    citation: "§376.11–§376.12",
    group: "ownership",
    recurrence: "expiry",
    source: "certification",
    evidenceKinds: ["lease"],
    subjects: ["tractor", "trailer"],
    ownership: ["leased", "owner_operator"],
    // §376.11(c)(2): a copy of the lease is carried in the equipment for as long as it runs.
    roadside: true,
    retention: "Three years after the lease ends (Part 379, Appendix A).",
  },
  {
    key: "insurance",
    label: "Insurance",
    citation: "§387.7",
    group: "insurance",
    recurrence: "expiry",
    source: "certification",
    evidenceKinds: ["insurance"],
    subjects: ["tractor", "trailer"],
    fleetWide: true,
    roadside: true,
    retention: "While the policy is in force.",
  },
  {
    key: "ifta",
    label: "IFTA licence",
    citation: "IFTA Articles of Agreement",
    group: "registration",
    recurrence: "expiry",
    source: "certification",
    evidenceKinds: ["ifta"],
    // IFTA licenses the qualified motor vehicle that burns the fuel; a trailer carries no decal.
    subjects: ["tractor"],
    fleetWide: true,
    roadside: true,
    retention: "Four years, with the fuel-tax records it licenses.",
  },
  {
    key: "annual_inspection",
    label: "Annual inspection",
    citation: "§396.17, §396.21",
    group: "inspections",
    // Written by the inspection's finalize with its own `expires_at` (a fail expires on the day), so
    // the certification's date is the answer, never arithmetic on the inspection date.
    recurrence: "expiry",
    source: "certification",
    evidenceKinds: ["annual_inspection"],
    subjects: ["tractor", "trailer"],
    roadside: true,
    unitDateColumn: "dot_annual_inspection_expires_at",
    retention: "14 months from the report date (§396.21(b)).",
  },
];

/** The kinds a fleet-wide paper can be filed as on the organization (D-UF6). */
export const FLEET_WIDE_UNIT_KINDS: readonly string[] = [
  ...new Set(EQUIPMENT_ITEMS.filter((i) => i.fleetWide).flatMap((i) => i.evidenceKinds)),
];
