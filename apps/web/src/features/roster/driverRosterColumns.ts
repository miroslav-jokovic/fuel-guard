import { type DataTableColumn } from "@silvicom/ui";

/**
 * The roster's column catalogue.
 *
 * Its own module because two surfaces read it and neither may derive it from the other: the table
 * renders the columns the reader kept, and the column picker in the page's toolbar has to offer the
 * ones they turned off — which the table, by definition, is no longer holding. One list, two
 * readers (R3b).
 *
 * ⚠ The FIRST entry is the identifier: `useTableColumns` refuses to hide it and `DataTableCards`
 * makes it the card heading. Reordering this array is therefore a product decision, not a tidy-up.
 */
export const DRIVER_ROSTER_COLUMNS: DataTableColumn[] = [
  {
    key: "full_name",
    label: "Name",
    sortable: true,
    width: "xl",
    cellClass: "font-medium text-ink",
  },
  {
    key: "samsara_username",
    label: "Driver ID",
    sortable: true,
    width: "md",
    cellClass: "text-ink-secondary",
  },
  { key: "current_hos_status", label: "HOS status", sortable: true, width: "md" },
  {
    key: "current_hos_vehicle",
    label: "Current truck",
    width: "md",
    cellClass: "text-ink-secondary",
  },
  {
    key: "current_location",
    label: "Location",
    sortable: true,
    width: "lg",
    cellClass: "text-ink-secondary",
  },
  { key: "app_access", label: "App access", width: "md" },
  /**
   * The §391.51 file in one cell (UNIT-FILES-PLAN UF4b, D-UF7): the state chip, the newest scans,
   * "+N". It REPLACES two columns this catalogue carried until 2026-10-20 — `qualification` (the
   * OK / Blocked / Due 12d badge, D3) and `documents` (the "8/17" scans-filed count, R5, D-ROS8) —
   * because both summarised the same file from the same rollup, and a reader scanning the roster
   * asked one question of the pair: is this driver's file in order, and what is on it. The chip
   * answers the first, worst state first (`fileChip`, the same word a truck's cell uses); the thumbs
   * answer the second. Nothing is summarised twice.
   *
   * Reads `GET /api/compliance/overview`'s rollup — `state`, `counts`, `papers` — projected from the
   * very file the driver's own page renders, so the chip, the dates beside it and the page cannot
   * disagree. A stored `?hide=` that still names a removed key is harmless: `useTableColumns` keeps
   * what it finds in this list and ignores the rest.
   */
  { key: "file", label: "File", width: "lg" },
  /**
   * The three §391.51 expiry columns (R4, D-ROS9).
   *
   * They read the SAME `GET /api/compliance/overview` rollup the File cell beside them reads —
   * `DriverOverviewRow.requirements`, projected from the very file the driver's own page renders.
   * So a date here, the chip beside it and the driver page cannot disagree: there is one
   * calculation, not three. Never `drivers.cdl_expires_at`, which is a display field even when
   * McLeod is the one writing it.
   *
   * Pinned by "counts days to expiry the same way the queue does, so the two cannot disagree" in
   * packages/shared/src/dqFile.test.ts.
   */
  { key: "cdl_expiry", label: "CDL expires", width: "md" },
  { key: "medical_expiry", label: "Medical expires", width: "md" },
  { key: "hazmat_expiry", label: "Hazmat expires", width: "md" },
  {
    key: "phone",
    label: "Phone",
    width: "lg",
    cellClass: "text-ink-secondary tabular-nums",
  },
  {
    key: "vehicles",
    label: "Vehicles",
    width: "lg",
    cellClass: "text-ink-secondary",
  },
  { key: "status", label: "Status", sortable: true, width: "sm" },
];
