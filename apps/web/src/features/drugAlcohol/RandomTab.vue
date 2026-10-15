<script setup lang="ts">
import { computed, ref } from "vue";
import type { DrawDispatch, PoolPace, RandomDraw, RandomDrawPeriod, RandomDrawState } from "@silvicom/shared";
import { AppButton as BaseButton, AppCard as BaseCard } from "@silvicom/ui";
import { DataTable } from "@silvicom/ui";
import { type DataTableColumn } from "@silvicom/ui";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import StatCard from "@/components/ui/StatCard.vue";
import { TablePagination } from "@silvicom/ui";
import { useClientPage } from "@/composables/useClientPage";
import PersonCell from "@/features/drugAlcohol/PersonCell.vue";
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
// No pool covers today (between pool years): there is no current period, so the year is the view.
const show = ref(props.currentPeriod ? "period" : "all");
const choice = computed(() => SHOW.value.find((o) => o.value === show.value) ?? SHOW.value[SHOW.value.length - 1]!);
const options = computed(() =>
  SHOW.value
    .filter((o) => o.value !== "period" || props.currentPeriod)
    .map((o) => ({ value: o.value, label: `${o.label} (${props.draws.filter(o.keep).length})` })),
);
const shown = computed(() => props.draws.filter(choice.value.keep));
const heading = computed(() =>
  show.value === "period" && props.currentPeriod
    ? `This ${periodName.value}'s draw, ${formatDate(props.currentPeriod.startsOn)} – ${formatDate(props.currentPeriod.endsOn)}`
    : `Random draws: ${choice.value.label.toLowerCase()}`,
);

const columns: DataTableColumn[] = [
  { key: "name", label: "Driver", cellClass: "font-medium text-ink" },
  { key: "dispatch", label: "Dispatcher" },
  { key: "service", label: "Test" },
  { key: "selectedOn", label: "Selected" },
  { key: "state", label: "Status" },
  { key: "daysSince", label: "Waiting", numeric: true },
  { key: "ordered", label: "Order" },
];
const tableRows = computed(() => shown.value.map((s) => ({ ...s, name: s.person.name, dispatcher: dispatchLines(s.person.driverId) })));
const { page, pageRows, total, paged, pageSize } = useClientPage(tableRows);
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
const testLabel = (s: RandomDraw["service"]) => (s === "drug" ? "Drug" : s === "alcohol" ? "Alcohol" : "Other");

const paceSub = (pool: PoolPace) =>
  pool.testsOwed === 0
    ? `Target ${pool.targetPercent}% met`
    : `${pool.testsOwed} more ${pool.testsOwed === 1 ? "test" : "tests"} needed for ${pool.targetPercent}% by ${pool.endsOn ? formatDate(pool.endsOn) : "year end"} · ${pool.scheduledTests} drawn ahead`;
// The rate is not good or bad until the year ends; fewer draws ahead than tests owed is what is bad now.
const paceTone = (pool: PoolPace) =>
  pool.testsOwed === 0 ? "text-success-700" : pool.scheduledTests < pool.testsOwed ? "text-danger-700" : undefined;
</script>

<template>
  <div class="space-y-6">
    <div v-if="pools.length > 0" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <StatCard
        v-for="pool in pools"
        :key="pool.service + pool.poolYear"
        :label="`${pool.label} random rate, ${pool.poolYear}`"
        :value="`${pool.currentPercent.toFixed(1)}%`"
        :sub="paceSub(pool)"
        :sub-tone="paceTone(pool)"
      />
    </div>

    <FilterSelect v-if="draws.length > 0" v-model="show" label="Show" :options="options" />

    <BaseCard as="section" padding="none">
      <div class="px-6 pt-5 pb-3">
        <h2 class="text-sm font-semibold text-ink">
          {{ heading }} <span class="ml-1 font-normal text-ink-muted">{{ shown.length }}</span>
        </h2>
        <p class="mt-1 text-xs text-ink-muted">
          Med-Stop draws each quarter's names when the quarter opens and dates them across it. Every open draw can be ordered now; a driver goes for the test as soon as they are told. Alternates are listed under Show. Only admins and safety managers see this list.
        </p>
      </div>
      <DataTable embedded dense :sticky-header="false" :columns="columns" :rows="pageRows" row-key="selectionId" :empty-text="show === 'period' ? `No random draws this ${periodName}.` : 'No random draws.'">
        <template #cell-name="{ row }"><PersonCell :person="row.person" /></template>
        <template #cell-dispatch="{ row }">
          <template v-if="row.dispatcher">
            <span class="text-ink">{{ row.dispatcher.who }}</span>
            <span class="block text-xs text-ink-muted">{{ row.dispatcher.sub }}</span>
          </template>
          <span v-else-if="row.person.driverId" class="text-ink-muted">No truck</span>
          <span v-else class="text-ink-muted">—</span>
        </template>
        <template #cell-service="{ row }">{{ testLabel(row.service) }}</template>
        <template #cell-selectedOn="{ row }">{{ formatDate(row.selectedOn) }}</template>
        <template #cell-state="{ row }">
          <span :class="[BADGE_BASE, toneClass(STATE[row.state as RandomDrawState].tone)]">{{ stateLabel(row) }}</span>
        </template>
        <template #cell-daysSince="{ row }">{{ row.state !== "due" || row.daysSince < 0 ? "—" : row.daysSince === 0 ? "today" : `${row.daysSince} d` }}</template>
        <template #cell-ordered="{ row }">
          <template v-if="row.state === 'due'">
            <BaseButton v-if="canOrder && !row.ordered && row.person.medstopId" size="sm" @click="emit('order', row)">Order test</BaseButton>
            <span v-else :class="[BADGE_BASE, toneClass(row.ordered ? 'info' : 'warning')]">{{ row.ordered ? "Ordered" : "Not ordered" }}</span>
          </template>
          <span v-else-if="row.ordered" :class="[BADGE_BASE, toneClass('info')]">Ordered</span>
        </template>
        <template v-if="paged" #footer>
          <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="page = $event" />
        </template>
      </DataTable>
    </BaseCard>
  </div>
</template>
