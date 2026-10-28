<script setup lang="ts">
import { computed, watch } from "vue";
import {
  AppBadge,
  AppButton as BaseButton,
  DataTable,
  DataWorkspace,
  FilterBar,
  TablePagination,
  type DataTableColumn,
  useQueryState,
} from "@silvicom/ui";
import type { AnnualDisagreementDto } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import InspectionExpiryCell from "@/features/maintenance/InspectionExpiryCell.vue";
import { useAnnualDisagreementsQuery } from "@/features/maintenance/useShopBacklog";

/**
 * Annual dates to check — the trucks and trailers whose annual inspection FleetPal and our record
 * disagree on (DISPATCH-BOARD-V2-PLAN Q-DBV2, ruled 2026-10-16: "the record, with a disagreement shown
 * to the shop manager"). The list behind the Shop card's figure.
 *
 * The dispatch board's annual chip reads OUR record (from McLeod's inspection date, or an inspection
 * filed here). FleetPal's annual PM is read for nothing but this page, so the shop can see which of
 * the two is wrong and correct it where it lives. Which rows appear is the shared rule
 * (`annualDisagreement`): the two verdicts differ, or the dates are more than the 30-day warning window
 * apart. The server sends them most pressing first — verdicts that differ, then the widest gap — and
 * the page keeps that order: there is nothing to sort by that says more.
 *
 * ── WHAT EACH DIRECTION USUALLY MEANS ────────────────────────────────────────────────────────────
 * Measured 2026-10-16, most gaps were FleetPal about a year BEHIND ours: this year's inspection is on
 * our record and FleetPal's schedule was never marked done. FleetPal AHEAD is the reverse — an
 * inspection FleetPal holds that never reached our record, which is the case that can make the board
 * call a truck overdue when it is not. The "What to check" column says which, in those words.
 *
 * Both dates are judged on the board's day (UTC), as the server judged them, so a badge here matches
 * the chip on the board.
 */

const PAGE_SIZE = 20;
const qs = useQueryState();
const search = qs.param("search");
const TYPE_OPTIONS = [
  { value: "", label: "Trucks and trailers" },
  { value: "tractor", label: "Trucks" },
  { value: "trailer", label: "Trailers" },
];
const type = qs.param("type", TYPE_OPTIONS.map((o) => o.value));
const activeFilterCount = computed(() => [search.value.trim(), type.value].filter(Boolean).length);
const clearFilters = () => qs.set({ search: undefined, type: undefined });

const annuals = useAnnualDisagreementsQuery();
const today = new Date().toISOString().slice(0, 10);

const rows = computed(() => {
  const term = search.value.trim().toLowerCase();
  return (annuals.data.value ?? [])
    .filter((r) => !type.value || r.subjectType === type.value)
    .filter((r) => !term || r.unitNumber.toLowerCase().includes(term));
});
const page = qs.page();
watch([search, type], () => (page.value = 1));
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const COLUMNS: DataTableColumn[] = [
  { key: "unitNumber", label: "Unit", card: "title", cellClass: "font-medium text-ink", width: "sm" },
  { key: "ours", label: "Our record", card: "none", width: "md" },
  { key: "fleetpal", label: "FleetPal", card: "none", width: "md" },
  { key: "gapDays", label: "Apart", card: "meta", numeric: true, width: "sm" },
  { key: "check", label: "What to check", card: "sentence", width: "2xl" },
];

/** The fix, in the shop's words, from which side is later. */
function whatToCheck(r: AnnualDisagreementDto): string {
  if (r.gapDays == null) return "No annual on our record. Record the unit's last inspection.";
  return r.gapDays > 0
    ? "FleetPal has a later inspection. Check that it reached our record."
    : "FleetPal's schedule is behind our record. Mark the inspection done in FleetPal.";
}
const apart = (days: number | null) => (days == null ? "—" : `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"}`);
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      description="Trucks and trailers whose annual inspection date in FleetPal disagrees with our record. Dispatch uses our date."
    />

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search truck or trailer…"
        :count="rows.length"
        count-label="trucks and trailers"
        :active-count="activeFilterCount"
        @clear-all="clearFilters"
      >
        <template #filters>
          <FilterSelect v-model="type" label="Type" :options="TYPE_OPTIONS" />
        </template>
      </FilterBar>

      <DataTable
        embedded
        :columns="COLUMNS"
        :rows="pageRows"
        row-key="unitId"
        :nowrap="false"
        :loading="annuals.isLoading.value"
        :error="annuals.isError.value ? 'Could not load the annual dates.' : null"
        @retry="() => annuals.refetch()"
      >
        <template #cell-unitNumber="{ row }">
          <!-- The register for that unit, where an inspection is filed or found. -->
          <BaseButton variant="link" :to="{ name: 'annual-inspections', query: { type: row.subjectType === 'tractor' ? undefined : 'trailer', search: row.unitNumber } }">
            {{ row.unitNumber }}
          </BaseButton>
          <span class="block text-xs text-ink-muted">{{ row.subjectType === "tractor" ? "Truck" : "Trailer" }}</span>
        </template>
        <template #cell-ours="{ row }"><InspectionExpiryCell :expires-on="row.ourExpiresOn" :today="today" /></template>
        <template #cell-fleetpal="{ row }"><InspectionExpiryCell :expires-on="row.fleetpalDueOn" :today="today" /></template>
        <template #cell-gapDays="{ row }">{{ apart(row.gapDays) }}</template>
        <template #cell-check="{ row }">
          <!-- Cells wrap rather than widen: unwrapped, this sentence ran the table to 1,658 px at a 1,440 px
               screen (browser pass, 2026-10-16). -->
          <p class="text-ink-secondary">{{ whatToCheck(row) }}</p>
          <!-- The rows that change what the board says, named, since they are why this list exists. -->
          <div v-if="row.ours !== row.fleetpal" class="mt-1"><AppBadge tone="caution">Dispatch would use a different date</AppBadge></div>
        </template>
        <template #empty>
          <p v-if="activeFilterCount">No truck or trailer matches that.</p>
          <p v-else>FleetPal and our record agree on every annual inspection date.</p>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
