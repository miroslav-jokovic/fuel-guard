<script setup lang="ts">
import { computed, watch } from "vue";
import { DataTable, type DataTableColumn, TablePagination } from "@silvicom/ui";
import type { UnitKitDto } from "@silvicom/shared";
import { useUnitsQuery } from "./useUnits";

/**
 * Labels' third list: trucks and trailers, each to get its own QR label (DE4; DRIVER-EQUIPMENT-AND-
 * UNIT-TAGS-PLAN.md §3, D-DE5/D-DE6).
 *
 * ── WHERE THE ROWS COME FROM ──────────────────────────────────────────────────────────────────
 * The units route the Trucks & trailers tab reads — every truck and trailer of the fleet, one response
 * (about 450 rows, under PostgREST's 1,000) — so "which units exist" has one answer here and there.
 * It does not page or search on the server, so this list searches and slices what it got, by unit
 * number or driver. A tractor is a `vehicles` row; a trailer and a reefer are `trailers` rows
 * (`unitKindOf`'s split), which is the table a label target names.
 *
 * The ticks are the page's (`LabelsPage.vue` owns the run), keyed `unit:<table>:<id>`.
 */
const props = defineProps<{ search: string; page: number; selected: Set<string> }>();
const emit = defineEmits<{ "update:selected": [Set<string>]; "update:page": [number] }>();

const UNIT_PAGE_SIZE = 50;

const { data, isLoading, isError, isFetching, refetch } = useUnitsQuery(computed(() => ({})));

const tableOf = (u: Pick<UnitKitDto, "kind">) => (u.kind === "tractor" ? "vehicle" : "trailer");
const rows = computed(() => {
  const q = props.search.trim().toLowerCase();
  const all = data.value?.units ?? [];
  return q ? all.filter((u) => u.unitNumber.toLowerCase().includes(q) || (u.inferredDriverName ?? "").toLowerCase().includes(q)) : all;
});
const shown = computed(() => rows.value.slice((props.page - 1) * UNIT_PAGE_SIZE, props.page * UNIT_PAGE_SIZE));
// The page clamps back when a search shortens the list, as the page's own two lists do.
watch(
  () => rows.value.length,
  (n) => {
    const max = Math.max(1, Math.ceil(n / UNIT_PAGE_SIZE));
    if (props.page > max) emit("update:page", max);
  },
);

const KIND_WORD: Record<UnitKitDto["kind"], string> = { tractor: "Truck", trailer: "Trailer", reefer_trailer: "Reefer" };
const columns: DataTableColumn[] = [
  { key: "unitNumber", label: "Unit", card: "title" },
  { key: "kind", label: "Kind", card: "meta" },
  { key: "inferredDriverName", label: "Driver", card: "sentence" },
];
</script>

<template>
  <!-- ui-adoption: never-empty — the empty slot below says why the list is empty. -->
  <DataTable
    embedded
    :columns="columns"
    :rows="shown"
    :loading="isLoading"
    :error="isError ? 'Could not load the trucks and trailers.' : null"
    :retrying="isFetching"
    :row-key="(r) => `unit:${tableOf(r)}:${r.unitId}`"
    selectable
    :selected="selected"
    @update:selected="emit('update:selected', $event)"
    @retry="refetch()"
  >
    <template #cell-kind="{ row }">{{ KIND_WORD[row.kind as UnitKitDto["kind"]] }}</template>
    <template #cell-inferredDriverName="{ row }">
      <span :class="row.inferredDriverName ? '' : 'text-ink-tertiary'">{{ row.inferredDriverName ?? "No driver" }}</span>
    </template>
    <template #empty>{{ search.trim() ? "No truck or trailer matches that search." : "No trucks or trailers yet." }}</template>
    <template #footer>
      <TablePagination :page="page" :page-size="UNIT_PAGE_SIZE" :total="rows.length" :loading="isLoading" @update:page="emit('update:page', $event)" />
    </template>
  </DataTable>
</template>
