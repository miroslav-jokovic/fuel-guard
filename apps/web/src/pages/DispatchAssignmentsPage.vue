<script setup lang="ts">
/**
 * Dispatch → Assignments (Phase 3D, D49).
 *
 * Who is on duty right now, in which truck and trailer, since when, and what they are working.
 *
 * This is the surface that makes duty sessions (D43) useful to a human rather than only to the
 * attribution engine — and it is where dispatch closes a shift a driver forgot to end, which matters
 * because the exclusive-equipment index means that truck is otherwise locked out of the fleet until
 * the 16-hour sweeper catches it (D44.5).
 */
import { computed, ref } from "vue";
import { shiftDuration, type AssignmentRow } from "@fuelguard/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import { useAssignmentsQuery, useEndDutySession } from "@/composables/useDispatchLoads";

const toast = useToastStore();
const { data: assignments, isLoading, isError, error, refetch, isFetching } = useAssignmentsQuery();
const endShift = useEndDutySession();

const search = ref("");
const dutyFilter = ref("");
const now = Date.now();

const dutyOptions = [
  { value: "", label: "All drivers" },
  { value: "on", label: "On duty" },
  { value: "off", label: "Off duty" },
];

const rows = computed(() => {
  const term = search.value.trim().toLowerCase();
  return (assignments.value ?? [])
    .filter((a) => {
      if (dutyFilter.value === "on") return a.session_id !== null;
      if (dutyFilter.value === "off") return a.session_id === null;
      return true;
    })
    .filter((a) =>
      !term
        ? true
        : [a.driver_name, a.vehicle_unit, a.trailer_unit, a.load_ref]
            .filter(Boolean)
            .some((f) => f!.toLowerCase().includes(term)),
    );
});

const onDutyCount = computed(() => (assignments.value ?? []).filter((a) => a.session_id).length);

const columns: DataTableColumn[] = [
  { key: "driver_name", label: "Driver", sortable: true, headerClass: "min-w-[12rem]", cellClass: "font-medium text-ink" },
  { key: "duty", label: "Duty", headerClass: "min-w-[7rem]" },
  { key: "vehicle_unit", label: "Truck", sortable: true, headerClass: "min-w-[7rem]" },
  { key: "trailer_unit", label: "Trailer", headerClass: "min-w-[7rem]" },
  { key: "started_at", label: "On duty for", numeric: true, headerClass: "min-w-[8rem]" },
  { key: "load_ref", label: "Working", headerClass: "min-w-[10rem]" },
];

/** A shift past the default 16-hour timeout is one the sweeper is about to close. */
function isLong(row: AssignmentRow): boolean {
  if (!row.started_at) return false;
  return now - Date.parse(row.started_at) > 14 * 3_600_000;
}

async function end(row: AssignmentRow) {
  if (!window.confirm(`End ${row.driver_name}'s shift and release Unit ${row.vehicle_unit ?? "—"}?`)) return;
  try {
    await endShift.mutateAsync(row.driver_id);
    toast.success(`Ended ${row.driver_name}'s shift`);
  } catch (e) {
    toast.error("Could not end that shift", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader
      description="Live duty board — who is driving what, right now. Drivers confirm their own truck and trailer in the app; this is where dispatch sees it and fixes it."
    />

    <BaseCard padding="sm">
      <p class="text-sm text-ink-secondary">
        <span class="font-semibold tabular-nums text-ink">{{ onDutyCount }}</span>
        of
        <span class="tabular-nums">{{ (assignments ?? []).length }}</span>
        drivers on duty
      </p>
    </BaseCard>

    <FilterBar
      v-model:search="search"
      search-placeholder="Driver, unit, load…"
      :count="rows.length"
      count-label="drivers"
    >
      <template #filters>
        <FilterSelect v-model="dutyFilter" label="Duty" :options="dutyOptions" />
      </template>
    </FilterBar>

    <DataTable
      :columns="columns"
      :rows="rows"
      row-key="driver_id"
      :loading="isLoading"
      :error="isError ? (error as Error)?.message : undefined"
      :retrying="isFetching"
      empty-text="No drivers match these filters."
      @retry="refetch()"
    >
      <template #cell-duty="{ row }">
        <span :class="[BADGE_BASE, toneClass(row.session_id ? 'success' : 'neutral')]">
          {{ row.session_id ? "On duty" : "Off duty" }}
        </span>
      </template>

      <template #cell-vehicle_unit="{ row }">
        <span v-if="row.vehicle_unit" class="tabular-nums text-ink-secondary">{{ row.vehicle_unit }}</span>
        <span v-else class="text-ink-subtle">—</span>
      </template>

      <template #cell-trailer_unit="{ row }">
        <span v-if="row.trailer_unit" class="tabular-nums text-ink-secondary">{{ row.trailer_unit }}</span>
        <span v-else-if="row.session_id" class="text-ink-subtle">Bobtail</span>
        <span v-else class="text-ink-subtle">—</span>
      </template>

      <template #cell-started_at="{ row }">
        <span :class="isLong(row) ? 'font-medium text-caution-600' : 'text-ink-secondary'">
          {{ shiftDuration(row.started_at, now) }}
        </span>
      </template>

      <template #cell-load_ref="{ row }">
        <RouterLink
          v-if="row.load_id"
          :to="`/dispatch/loads/${row.load_id}`"
          class="font-medium text-brand-600 hover:text-brand-500"
        >
          {{ row.load_ref }}
        </RouterLink>
        <span v-else class="text-ink-subtle">—</span>
      </template>

      <template #actions="{ row }">
        <KebabMenu v-if="row.session_id">
          <button class="kebab-item" @click="end(row)">End shift</button>
        </KebabMenu>
      </template>
    </DataTable>
  </div>
</template>
