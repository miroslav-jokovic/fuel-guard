import type { DataTableColumn } from "@/components/ui/DataTable.vue";

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
  { key: "qualification", label: "Qualification", width: "lg" },
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
