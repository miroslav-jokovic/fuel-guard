<script setup lang="ts">
import { computed } from "vue";
import { MEDICAL_SOURCES, MEDICAL_SOURCE_LABEL, type MedicalCardRow, type MedicalCards, type MedicalSource } from "@silvicom/shared";
import { DataTable, type DataTableColumn, DataWorkspace, FilterBar, TablePagination, useQueryState } from "@silvicom/ui";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import ListIntro from "@/features/drugAlcohol/ListIntro.vue";
import PersonCell from "@/features/drugAlcohol/PersonCell.vue";
import { useProgramList } from "@/features/drugAlcohol/useProgramList";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";

/**
 * Medical cards (MEDSTOP-PLAN.md §7A.3, UX2). The date on every row is the one the qualification
 * file keeps by the owner's rule (Q-MSUX7, 2026-10-13): a scanned card wins; without one, the
 * earliest date McLeod or Med-Stop gives. The second list is the rule's "flagged for review" — every
 * working driver whose sources disagree, each source's date beside it (D-MSUX4b). One column per
 * source, from `MEDICAL_SOURCES`, so Samba is a column the day it is connected (Q-MSUX6).
 *
 * The two lists are one workspace with Show choosing between them, as Results does (the owner's
 * review found stacked tables confusing); Show picks WHICH list, so "Clear filters" keeps it.
 */
const props = defineProps<{ medical: MedicalCards }>();

const LISTS = {
  due: {
    label: "Expiring in 60 days",
    why: "A driver may not drive on an expired card. The date is the one the qualification file keeps: a scanned card wins; otherwise the earliest date McLeod or Med-Stop gives.",
    empty: "No medical card expires in the next 60 days.",
  },
  disagree: {
    label: "Sources disagree",
    why: "Check the driver's card. Filing its scan in the qualification file settles it — a scanned card wins over every source.",
    empty: "Every source agrees on every working driver's medical card.",
  },
} as const;

const qs = useQueryState("medical");
const show = qs.param("show", ["due", "disagree"], "due");
const list = computed(() => LISTS[show.value as keyof typeof LISTS]);
const showOptions = computed(() => [
  { value: "due", label: `${LISTS.due.label} (${props.medical.due.length})` },
  { value: "disagree", label: `${LISTS.disagree.label} (${props.medical.disagree.length})` },
]);

const tone = (days: number) => (days < 0 ? "danger" : days <= 30 ? "warning" : "neutral");
/** The status choices follow the badge's own tones, so a choice finds exactly the rows drawn in it. */
const WHEN = { expired: "Expired", soon: "Within 30 days", later: "More than 30 days" } as const;
const whenOf = (days: number): keyof typeof WHEN => (days < 0 ? "expired" : days <= 30 ? "soon" : "later");
const when = qs.param("when", Object.keys(WHEN));
const whenOptions = Object.entries(WHEN).map(([value, label]) => ({ value, label }));

const BASIS = { documented: "Scanned card on file", earliest: "Earliest of the sources", agree: "All sources agree" } as const;
const basisOf = (row: MedicalCardRow): keyof typeof BASIS => (row.documented ? "documented" : row.disagree ? "earliest" : "agree");
const basis = qs.param("from", Object.keys(BASIS));
const basisOptions = Object.entries(BASIS).map(([value, label]) => ({ value, label }));

const sourceColumns: DataTableColumn[] = MEDICAL_SOURCES.map((s) => ({ key: `src-${s}`, label: MEDICAL_SOURCE_LABEL[s] }));
const DUE_COLUMNS: DataTableColumn[] = [
  { key: "name", label: "Driver", sortable: true, cellClass: "font-medium text-ink" },
  { key: "expiresOn", label: "Expires", sortable: true },
  { key: "daysLeft", label: "Days left", sortable: true, numeric: true },
  { key: "basis", label: "Date from" },
];
const DISAGREE_COLUMNS: DataTableColumn[] = [
  { key: "name", label: "Driver", sortable: true, cellClass: "font-medium text-ink" },
  { key: "expiresOn", label: "File keeps", sortable: true },
  { key: "basis", label: "Because" },
  ...sourceColumns,
];
const columns = computed(() => (show.value === "disagree" ? DISAGREE_COLUMNS : DUE_COLUMNS));

const tableRows = computed(() =>
  (show.value === "disagree" ? props.medical.disagree : props.medical.due).map((r) => ({ ...r, name: r.person.name, key: r.person.driverId })),
);
const { search, page, sort, onSort, filtered, pageRows, activeCount, clearAll, pageSize } = useProgramList({
  scope: "medical",
  qs,
  rows: tableRows,
  // Both lists' sortable keys, so a sort chosen on one is still a column on the other.
  columns: DUE_COLUMNS,
  text: (r) => [r.name],
  narrow: (r) => (!when.value || whenOf(r.daysLeft) === when.value) && (!basis.value || basisOf(r) === basis.value),
  filters: () => ({ when: when.value, from: basis.value }),
});
const sourceDate = (row: MedicalCardRow, s: MedicalSource) => row.sources.find((c) => c.source === s)?.expiresOn ?? null;
</script>

<template>
  <div class="space-y-3">
    <ListIntro :text="list.why" />
    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search driver…"
        :count="filtered.length"
        count-label="drivers"
        :active-count="activeCount"
        @clear-all="clearAll"
      >
        <template #filters>
          <FilterSelect v-model="show" label="Show" :options="showOptions" />
          <FilterSelect v-model="when" label="Card" :options="whenOptions" />
          <FilterSelect v-model="basis" label="Date from" :options="basisOptions" />
        </template>
      </FilterBar>
      <DataTable
        embedded
        :columns="columns"
        :rows="pageRows"
        row-key="key"
        :sort="sort"
        :empty-text="activeCount ? 'No driver matches that.' : list.empty"
        @sort="onSort"
      >
        <template #cell-name="{ row }"><PersonCell :person="row.person" /></template>
        <template #cell-expiresOn="{ row }">{{ formatDate(row.expiresOn) }}</template>
        <template #cell-daysLeft="{ row }">
          <span :class="[BADGE_BASE, toneClass(tone(row.daysLeft))]">{{ row.daysLeft < 0 ? `Expired ${-row.daysLeft} d ago` : row.daysLeft === 0 ? "Today" : `${row.daysLeft} d` }}</span>
        </template>
        <template #cell-basis="{ row }">{{ BASIS[basisOf(row as MedicalCardRow)] }}</template>
        <template v-for="s in MEDICAL_SOURCES" :key="s" #[`cell-src-${s}`]="{ row }">
          {{ sourceDate(row as MedicalCardRow, s) ? formatDate(sourceDate(row as MedicalCardRow, s)!) : "—" }}
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="pageSize" :total="filtered.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
