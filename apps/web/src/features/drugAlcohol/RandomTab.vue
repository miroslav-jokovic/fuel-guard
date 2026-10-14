<script setup lang="ts">
import { computed, ref } from "vue";
import type { PoolPace, RandomDraw, RandomDrawState } from "@silvicom/shared";
import { AppButton as BaseButton, AppCard as BaseCard } from "@silvicom/ui";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import StatCard from "@/components/ui/StatCard.vue";
import TablePagination from "@/components/TablePagination.vue";
import { useClientPage } from "@/composables/useClientPage";
import PersonCell from "@/features/drugAlcohol/PersonCell.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";

/**
 * Random selections (MEDSTOP-PLAN.md §7A.3, D-MSUX18) — the pool year's draws, all of them: who is due
 * now, who is drawn ahead, who was tested, and which draws ended without a test. The owner asked for
 * the complete list by default; "Due now" is one choice of the Show filter, and it is the DER's to-do.
 * Only ever mounted for a reader the API sent selections to (admin, safety_manager).
 */
const props = defineProps<{ draws: RandomDraw[]; pools: PoolPace[]; canOrder: boolean }>();
// UX3: "Order test" on a due draw not yet ordered — the drawer takes it as the seed (§7A.4).
const emit = defineEmits<{ order: [selection: RandomDraw] }>();

const STATE: Record<RandomDrawState, { label: string; tone: string }> = {
  due: { label: "Due now", tone: "warning" },
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

// One table, filtered (the Results tab's pattern): each choice is a set of states.
const SHOW: { value: string; label: string; states: RandomDrawState[] | null }[] = [
  { value: "all", label: "All draws", states: null },
  { value: "due", label: "Due now", states: ["due"] },
  { value: "upcoming", label: "Upcoming", states: ["upcoming"] },
  { value: "tested", label: "Tested", states: ["tested"] },
  { value: "lost", label: "Not tested", states: ["cancelled", "expired", "other"] },
  { value: "alternates", label: "Alternates", states: ["alternate", "alternate_unused"] },
];
const show = ref("all");
const listed = (states: RandomDrawState[] | null) => (states ? props.draws.filter((d) => states.includes(d.state)) : props.draws);
const options = computed(() => SHOW.map((o) => ({ value: o.value, label: `${o.label} (${listed(o.states).length})` })));
const shown = computed(() => listed(SHOW.find((o) => o.value === show.value)?.states ?? null));

const columns: DataTableColumn[] = [
  { key: "name", label: "Driver", cellClass: "font-medium text-ink" },
  { key: "service", label: "Test" },
  { key: "selectedOn", label: "Selected" },
  { key: "state", label: "Status" },
  { key: "daysSince", label: "Waiting", numeric: true },
  { key: "ordered", label: "Order" },
];
const tableRows = computed(() => shown.value.map((s) => ({ ...s, name: s.person.name })));
const { page, pageRows, total, paged, pageSize } = useClientPage(tableRows);
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
          Random draws this year <span class="ml-1 font-normal text-ink-muted">{{ shown.length }}</span>
        </h2>
        <p class="mt-1 text-xs text-ink-muted">
          Everyone Med-Stop drew this year, including draws scheduled ahead. A driver goes for the test as soon as they are told, never before their draw date. Only admins and safety managers see this list.
        </p>
      </div>
      <DataTable embedded dense :sticky-header="false" :columns="columns" :rows="pageRows" row-key="selectionId" empty-text="No random draws this year.">
        <template #cell-name="{ row }"><PersonCell :person="row.person" /></template>
        <template #cell-service="{ row }">{{ testLabel(row.service) }}</template>
        <template #cell-selectedOn="{ row }">{{ formatDate(row.selectedOn) }}</template>
        <template #cell-state="{ row }">
          <span :class="[BADGE_BASE, toneClass(STATE[row.state as RandomDrawState].tone)]">{{ stateLabel(row) }}</span>
        </template>
        <template #cell-daysSince="{ row }">{{ row.state !== "due" ? "—" : row.daysSince === 0 ? "today" : `${row.daysSince} d` }}</template>
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
