import type { DataTableColumn } from "@/components/ui/DataTable.vue";

/**
 * The per-truck table's columns, in a module rather than inside `CpmTruckTable.vue`'s `<script setup>`
 * (which can export nothing), because the tab that owns the table's sort must check a sort key read
 * from the URL against them (D-US2). Deriving the vocabulary from here means a column added to the
 * table is sortable from a link the same day, with no second list to remember.
 */
export const CPM_TRUCK_COLUMNS: DataTableColumn[] = [
  { key: "tractor_unit", label: "Truck", cellClass: "font-mono text-xs", sortable: true },
  { key: "loads", label: "Loads", numeric: true, sortable: true },
  { key: "miles", label: "Miles driven", numeric: true, sortable: true },
  { key: "revenue", label: "Earned", numeric: true, sortable: true },
  { key: "revenuePerMile", label: "Earned / mile", numeric: true, sortable: true },
];

export const CPM_TRUCK_SORT_KEYS = CPM_TRUCK_COLUMNS.filter((c) => c.sortable).map((c) => c.key);
