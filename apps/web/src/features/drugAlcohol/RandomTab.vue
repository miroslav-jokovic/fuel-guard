<script setup lang="ts">
import { computed } from "vue";
import type { DrawDispatch, PoolPace, RandomDraw, RandomDrawPeriod, RandomDrawState } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  DataTable,
  type DataTableColumn,
  DataWorkspace,
  FilterBar,
  StatCard,
  TablePagination,
  useQueryState,
} from "@silvicom/ui";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import ListIntro from "@/features/drugAlcohol/ListIntro.vue";
import PersonCell from "@/features/drugAlcohol/PersonCell.vue";
import { kindText, useProgramList } from "@/features/drugAlcohol/useProgramList";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";

/**
 * Random selections (MEDSTOP-PLAN.md §7A.3, §7A.18) — the pool year's draws, opening on the current
 * quarter's (D-MSUX19): the office's own list is one quarter's names, alternates aside, and that is
 * what the tab shows first. "To test" is the DER's to-do across the year; "Whole year" is D-MSUX18's
 * complete list. Only ever mounted for a reader the API sent selections to (admin, safety_manager).
 */
const props = defineProps<{
  draws: RandomDraw[];
  currentPeriod: RandomDrawPeriod | null;
  dispatch: Record<string, DrawDispatch>;
  pools: PoolPace[];
  canOrder: boolean;
}>();
// UX3: "Order test" on every due draw not yet ordered — the drawer takes it as the seed (§7A.4).
// Due includes a draw Med-Stop dated later in the current quarter (D-MSUX19).
const emit = defineEmits<{ order: [selection: RandomDraw] }>();

const STATE: Record<RandomDrawState, { label: string; tone: string }> = {
  due: { label: "To test", tone: "warning" },
  upcoming: { label: "Upcoming", tone: "info" },
  tested: { label: "Tested", tone: "success" },
  alternate: { label: "Alternate", tone: "neutral" },
  alternate_unused: { label: "Alternate, not used", tone: "neutral" },
  // Both count against the year's rate (`poolPace`'s lost draws).
  cancelled: { label: "Cancelled", tone: "caution" },
  expired: { label: "Expired, not tested", tone: "caution" },
  other: { label: "", tone: "neutral" },
};
const stateLabel = (d: RandomDraw) => (d.state === "other" ? d.medstopStatus ?? "Unknown" : STATE[d.state].label);

// One table, filtered (the Results tab's pattern): each choice is a test on a draw.
const TESTS = ["drug", "alcohol"] as const;
const testOptions = TESTS.map((t) => ({ value: t, label: kindText(t) }));
const ALTERNATE: RandomDrawState[] = ["alternate", "alternate_unused"];
const periodName = computed(() => (props.currentPeriod?.months === 3 ? "quarter" : props.currentPeriod?.months === 1 ? "month" : "period"));
const SHOW = computed<{ value: string; label: string; keep: (d: RandomDraw) => boolean }[]>(() => [
  { value: "period", label: `This ${periodName.value}`, keep: (d) => d.period === "current" && !ALTERNATE.includes(d.state) },
  { value: "due", label: "To test", keep: (d) => d.state === "due" },
  { value: "upcoming", label: "Later periods", keep: (d) => d.state === "upcoming" },
  { value: "tested", label: "Tested", keep: (d) => d.state === "tested" },
  { value: "lost", label: "Not tested", keep: (d) => ["cancelled", "expired", "other"].includes(d.state) },
  { value: "alternates", label: "Alternates", keep: (d) => ALTERNATE.includes(d.state) },
  { value: "all", label: "Whole year", keep: () => true },
]);
/**
 * Show picks WHICH list of draws this is (a queue, not a filter: §5.5 rule 5), so "Clear filters"
 * keeps it and it is not counted. No pool covers today (between pool years): there is no current
 * period, so the year is the view.
 */
const qs = useQueryState("random");
const show = qs.param("show", ["period", "due", "upcoming", "tested", "lost", "alternates", "all"], props.currentPeriod ? "period" : "all");
const test = qs.param("test", TESTS);
const choice = computed(() => SHOW.value.find((o) => o.value === show.value) ?? SHOW.value[SHOW.value.length - 1]!);
const options = computed(() =>
  SHOW.value
    .filter((o) => o.value !== "period" || props.currentPeriod)
    .map((o) => ({ value: o.value, label: `${o.label} (${props.draws.filter(o.keep).length})` })),
);
/** Which draw "This quarter" is, said in the caption: the Show label has no room for two dates. */
const intro = computed(() =>
  [
    props.currentPeriod ? `This ${periodName.value}'s draw runs ${formatDate(props.currentPeriod.startsOn)} – ${formatDate(props.currentPeriod.endsOn)}.` : null,
    "Med-Stop draws each quarter's names when the quarter opens and dates them across it. Every open draw can be ordered now; a driver goes for the test as soon as they are told. Alternates are listed under Show. Only admins and safety managers see this list.",
  ]
    .filter(Boolean)
    .join(" "),
);

const columns: DataTableColumn[] = [
  { key: "name", label: "Driver", sortable: true, cellClass: "font-medium text-ink" },
  { key: "dispatch", label: "Dispatcher" },
  { key: "service", label: "Test" },
  { key: "selectedOn", label: "Selected", sortable: true },
  { key: "state", label: "Status" },
  { key: "daysSince", label: "Waiting", sortable: true, numeric: true },
  { key: "ordered", label: "Ordered" },
];
const tableRows = computed(() => props.draws.map((s) => ({ ...s, name: s.person.name, dispatcher: dispatchLines(s.person.driverId) })));
type Row = (typeof tableRows.value)[number];
const list = useProgramList<Row>({
  scope: "random",
  qs,
  rows: tableRows,
  columns,
  text: (r) => [r.name, r.dispatcher?.who, r.dispatcher?.sub],
  narrow: (r) => choice.value.keep(r) && (!test.value || r.service === test.value),
  filters: () => ({ test: test.value }),
});
const { search, page, sort, onSort, filtered, pageRows, activeCount, clearAll, pageSize } = list;
/**
 * Whom the DER calls to take the driver off the road (§7A.19). The fleet's dispatcher first; a load
 * dispatched by a colleague is said beside it. Until an office links the fleet (Settings › McLeod
 * fleets) the load's dispatcher is the one name there is, and the line says why it is that one.
 */
function dispatchLines(driverId: string | null): { who: string; sub: string } | null {
  const d = driverId ? props.dispatch[driverId] : undefined;
  if (!d) return null;
  const truck = `Truck ${d.unitNumber}`;
  if (d.fleetDispatcher) {
    const other = d.loadDispatcher && d.loadDispatcher !== d.fleetDispatcher ? ` · load dispatched by ${d.loadDispatcher}` : "";
    return { who: d.fleetDispatcher, sub: `${truck}${other}` };
  }
  if (d.loadDispatcher) return { who: d.loadDispatcher, sub: `${truck} · dispatching its load` };
  if (d.fleetCode) return { who: `Fleet ${d.fleetCode}`, sub: `${truck} · fleet not linked to a dispatcher` };
  return { who: "—", sub: `${truck} · in no fleet, no load` };
}

const paceSub = (pool: PoolPace) =>
  pool.testsOwed === 0
    ? `Target ${pool.targetPercent}% met`
    : `${pool.testsOwed} more ${pool.testsOwed === 1 ? "test" : "tests"} needed for ${pool.targetPercent}% by ${pool.endsOn ? formatDate(pool.endsOn) : "year end"} · ${pool.scheduledTests} drawn ahead`;
// The rate is not good or bad until the year ends; fewer draws ahead than tests owed is what is bad now.
const paceTone = (pool: PoolPace) =>
  pool.testsOwed === 0 ? "text-success-700" : pool.scheduledTests < pool.testsOwed ? "text-danger-700" : undefined;
</script>

<template>
  <div class="space-y-3">
    <div v-if="pools.length > 0" class="grid grid-cols-1 gap-4 pb-3 sm:grid-cols-2">
      <StatCard
        v-for="pool in pools"
        :key="pool.service + pool.poolYear"
        :label="`${pool.label} random rate, ${pool.poolYear}`"
        :value="`${pool.currentPercent.toFixed(1)}%`"
        :sub="paceSub(pool)"
        :sub-tone="paceTone(pool)"
      />
    </div>

    <ListIntro :text="intro" />
    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search driver, dispatcher, truck…"
        :count="filtered.length"
        count-label="random draws"
        :active-count="activeCount"
        @clear-all="clearAll"
      >
        <template #filters>
          <FilterSelect v-model="show" label="Show" :options="options" />
          <FilterSelect v-model="test" label="Test" :options="testOptions" />
        </template>
      </FilterBar>
      <DataTable
        embedded
        :columns="columns"
        :rows="pageRows"
        row-key="selectionId"
        :sort="sort"
        :empty-text="activeCount ? 'No random draw matches that.' : show === 'period' ? `No random draws this ${periodName}.` : 'No random draws.'"
        @sort="onSort"
      >
        <template #cell-name="{ row }"><PersonCell :person="row.person" /></template>
        <template #cell-dispatch="{ row }">
          <template v-if="row.dispatcher">
            <span class="text-ink">{{ row.dispatcher.who }}</span>
            <span class="block text-xs text-ink-muted">{{ row.dispatcher.sub }}</span>
          </template>
          <span v-else-if="row.person.driverId" class="text-ink-muted">No truck</span>
          <span v-else class="text-ink-muted">—</span>
        </template>
        <template #cell-service="{ row }">{{ kindText(row.service) }}</template>
        <template #cell-selectedOn="{ row }">{{ formatDate(row.selectedOn) }}</template>
        <template #cell-state="{ row }">
          <span :class="[BADGE_BASE, toneClass(STATE[row.state as RandomDrawState].tone)]">{{ stateLabel(row) }}</span>
        </template>
        <template #cell-daysSince="{ row }">{{ row.state !== "due" || row.daysSince < 0 ? "—" : row.daysSince === 0 ? "today" : `${row.daysSince} d` }}</template>
        <template #cell-ordered="{ row }">
          <span v-if="row.ordered" :class="[BADGE_BASE, toneClass('info')]">Ordered</span>
          <span v-else-if="row.state === 'due'" :class="[BADGE_BASE, toneClass('warning')]">Not ordered</span>
        </template>
        <!-- UX3: the row's one action (§5.6 single-action shape), on a due draw nobody has ordered. -->
        <template v-if="canOrder" #actions="{ row }">
          <BaseButton v-if="row.state === 'due' && !row.ordered && row.person.medstopId" variant="ghost" size="sm" @click.stop="emit('order', row)">Order test</BaseButton>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="pageSize" :total="filtered.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
