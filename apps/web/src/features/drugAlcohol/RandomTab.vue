<script setup lang="ts">
import type { DueSelection, PoolPace } from "@silvicom/shared";
import { AppCard as BaseCard } from "@silvicom/ui";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import StatCard from "@/components/ui/StatCard.vue";
import PersonCell from "@/features/drugAlcohol/PersonCell.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";

/**
 * Random selections (MEDSTOP-PLAN.md §7A.3) — the DER's to-do list: who Med-Stop drew, how long they
 * have waited, and whether a test is ordered. Only ever mounted for a reader the API sent selections
 * to (admin, safety_manager). Nothing dated after today is in the data at all (R4).
 */
defineProps<{ due: DueSelection[]; reserves: DueSelection[]; pools: PoolPace[] }>();

const columns: DataTableColumn[] = [
  { key: "name", label: "Driver", cellClass: "font-medium text-ink" },
  { key: "service", label: "Test" },
  { key: "selectedOn", label: "Selected" },
  { key: "daysSince", label: "Waiting", numeric: true },
  { key: "ordered", label: "Order" },
];
const rows = (list: DueSelection[]) => list.map((s) => ({ ...s, name: s.person.name }));
const testLabel = (s: DueSelection["service"]) => (s === "drug" ? "Drug" : s === "alcohol" ? "Alcohol" : "Other");

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

    <BaseCard as="section" padding="none">
      <div class="px-6 pt-5 pb-3">
        <h2 class="text-sm font-semibold text-ink">Selected, not yet tested</h2>
        <p class="mt-1 text-xs text-ink-muted">
          A selected driver goes for the test as soon as they are told. Only admins and safety managers see this list.
        </p>
      </div>
      <DataTable embedded dense :sticky-header="false" :columns="columns" :rows="rows(due)" row-key="selectionId" empty-text="No one is waiting on a random test.">
        <template #cell-name="{ row }"><PersonCell :person="row.person" /></template>
        <template #cell-service="{ row }">{{ testLabel(row.service) }}</template>
        <template #cell-selectedOn="{ row }">{{ formatDate(row.selectedOn) }}</template>
        <template #cell-daysSince="{ row }">{{ row.daysSince === 0 ? "today" : `${row.daysSince} d` }}</template>
        <template #cell-ordered="{ row }">
          <span :class="[BADGE_BASE, toneClass(row.ordered ? 'info' : 'warning')]">{{ row.ordered ? "Ordered" : "Not ordered" }}</span>
        </template>
      </DataTable>
    </BaseCard>

    <BaseCard v-if="reserves.length > 0" as="section" padding="none">
      <div class="px-6 pt-5 pb-3">
        <h2 class="text-sm font-semibold text-ink">Alternates</h2>
        <p class="mt-1 text-xs text-ink-muted">Med-Stop's reserve draws, used only when a selected driver cannot be tested.</p>
      </div>
      <DataTable embedded dense :sticky-header="false" :columns="columns.filter((c) => c.key !== 'ordered')" :rows="rows(reserves)" row-key="selectionId" empty-text="">
        <template #cell-name="{ row }"><PersonCell :person="row.person" /></template>
        <template #cell-service="{ row }">{{ testLabel(row.service) }}</template>
        <template #cell-selectedOn="{ row }">{{ formatDate(row.selectedOn) }}</template>
        <template #cell-daysSince="{ row }">{{ row.daysSince === 0 ? "today" : `${row.daysSince} d` }}</template>
      </DataTable>
    </BaseCard>
  </div>
</template>
