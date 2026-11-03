<script setup lang="ts">
import { computed } from "vue";
import { MEDSTOP_OUTCOME_LABELS, MEDSTOP_ORDER_REASONS, type MedstopOrderReason, type MedstopResultRow, type MedstopTestOutcome } from "@silvicom/shared";
import { AppButton as BaseButton, DataTable, type DataTableColumn, DataWorkspace, FilterBar, TablePagination, useQueryState } from "@silvicom/ui";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import ListIntro from "@/features/drugAlcohol/ListIntro.vue";
import PersonCell from "@/features/drugAlcohol/PersonCell.vue";
import { KIND_OPTIONS, KINDS, kindText, useProgramList } from "@/features/drugAlcohol/useProgramList";
import { BADGE_BASE, medstopOutcomeTone } from "@/lib/badges";
import { formatDate } from "@/lib/format";

/**
 * Results (MEDSTOP-PLAN.md §7A.3, §6 F-5, MS2c) — testing records, so mounted only for a reader the
 * API sent them to (`canReadTestingRecords`). One list; "Found on the first read" (D-MS5's history) is
 * a choice of WHICH list, not a second table under the first — the owner's review found two stacked
 * tables confusing. That choice is Show, so "Clear filters" keeps it (§5.5 rule 5).
 */
const props = defineProps<{ recent: MedstopResultRow[]; history: MedstopResultRow[]; canOrder?: boolean }>();
/**
 * MSO3 (D-MSO4): a negative-dilute DRUG result offers "Order a recollection" to whoever reads it AND may order.
 * It never orders anything by itself and never blocks: the office decides, and decides whether it is observed.
 * Only a reason the drawer orders is offered (an "OTHER" test has no reason to repeat it under).
 */
const emit = defineEmits<{ recollect: [row: { testId: string; medstopId: string; name: string; reason: MedstopOrderReason; collectedOn: string | null }] }>();
const recollectable = (r: MedstopResultRow): MedstopOrderReason | null => {
  const reason = (r.reason ?? "").toUpperCase() as MedstopOrderReason;
  return props.canOrder && r.source === "test" && r.kind === "drug" && r.outcome === "negative_dilute" && r.person.medstopId && MEDSTOP_ORDER_REASONS.includes(reason)
    ? reason
    : null;
};
function recollect(r: MedstopResultRow): void {
  const reason = recollectable(r);
  if (reason) emit("recollect", { testId: r.medstopId, medstopId: r.person.medstopId!, name: r.person.name, reason, collectedOn: r.collectedOn });
}

const LISTS = {
  recent: {
    label: "Needs review",
    why: "Positive, refused, dilute or unrecognised results from Med-Stop in the last year. A positive or refusal keeps the driver off dispatch until a return-to-duty record dated on or after the test is on file.",
    empty: "No results need review.",
  },
  history: {
    label: "Found on the first read",
    why: "Positives and refusals from before Silvicom 360 was watching. Nothing was done with them automatically: check each person is either gone or has a return-to-duty record on file.",
    empty: "None.",
  },
} as const;

const qs = useQueryState("results");
const show = qs.param("show", ["recent", "history"], "recent");
const list = computed(() => LISTS[show.value as keyof typeof LISTS]);
const showOptions = computed(() => [
  { value: "recent", label: `${LISTS.recent.label} (${props.recent.length})` },
  { value: "history", label: `${LISTS.history.label} (${props.history.length})` },
]);
const kind = qs.param("test", KINDS);
const OUTCOMES = Object.keys(MEDSTOP_OUTCOME_LABELS) as MedstopTestOutcome[];
const outcome = qs.param("result", OUTCOMES);
// Only the results this list holds are offered: a "Negative" choice on a list of positives finds nothing.
const outcomeOptions = computed(() =>
  OUTCOMES.filter((o) => source.value.some((r) => r.outcome === o)).map((o) => ({ value: o, label: MEDSTOP_OUTCOME_LABELS[o] })),
);

const columns: DataTableColumn[] = [
  { key: "name", label: "Person", sortable: true, cellClass: "font-medium text-ink" },
  { key: "test", label: "Test" },
  { key: "collectedOn", label: "Collected", sortable: true },
  { key: "outcome", label: "Result" },
];
const source = computed(() => (show.value === "history" ? props.history : props.recent));
// Keyed by source too: a test and an order are numbered by Med-Stop separately and may share an id.
const tableRows = computed(() => source.value.map((r) => ({ ...r, key: `${r.source}:${r.medstopId}`, name: r.person.name, driverId: r.person.driverId })));
const { search, page, sort, onSort, filtered, pageRows, activeCount, clearAll, pageSize } = useProgramList({
  scope: "results",
  qs,
  rows: tableRows,
  columns,
  text: (r) => [r.name, r.reason],
  narrow: (r) => (!kind.value || r.kind === kind.value) && (!outcome.value || r.outcome === outcome.value),
  filters: () => ({ test: kind.value, result: outcome.value }),
});
</script>

<template>
  <div class="space-y-3">
    <ListIntro :text="list.why" />
    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search person or reason…"
        :count="filtered.length"
        count-label="results"
        :active-count="activeCount"
        @clear-all="clearAll"
      >
        <template #filters>
          <FilterSelect v-model="show" label="Show" :options="showOptions" />
          <FilterSelect v-model="kind" label="Test" :options="[...KIND_OPTIONS]" />
          <FilterSelect v-model="outcome" label="Result" :options="outcomeOptions" />
        </template>
      </FilterBar>
      <DataTable
        embedded
        :columns="columns"
        :rows="pageRows"
        row-key="key"
        :sort="sort"
        :empty-text="activeCount ? 'No result matches that.' : list.empty"
        @sort="onSort"
      >
        <template #cell-name="{ row }">
          <PersonCell :person="row.person" />
        </template>
        <template #cell-test="{ row }">
          {{ kindText(row.kind) }}{{ row.reason ? ` · ${row.reason.toLowerCase()}` : "" }}
          <!-- §7A.16: no specimen, so no test — the day in "Collected" is the visit's. -->
          <span v-if="row.source === 'order'" class="block text-xs text-ink-muted">Refused before a specimen was collected</span>
        </template>
        <template #cell-collectedOn="{ row }">{{ row.collectedOn ? formatDate(row.collectedOn) : "—" }}</template>
        <template #cell-outcome="{ row }">
          <span :class="[BADGE_BASE, medstopOutcomeTone(row.outcome)]">{{ MEDSTOP_OUTCOME_LABELS[row.outcome as MedstopTestOutcome] }}</span>
          <BaseButton v-if="recollectable(row)" size="sm" variant="link" class="ml-2" @click="recollect(row)">Order a recollection</BaseButton>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="pageSize" :total="filtered.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
