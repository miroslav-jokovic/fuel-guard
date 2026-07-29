<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { shiftDuration, LOAD_STATUS_LABELS, type AssignmentRow, type LoadStatus } from "@fuelguard/shared";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import { useAssignmentsQuery, useEndShift } from "@/features/dispatch/useAssignments";

/**
 * Dispatch → Assignments (Phase 3D). The live duty board: who is on duty, in what, for how long, and
 * what they are working. Its one action is ending a shift a driver forgot to close (D44.5), which
 * releases the truck for the next driver.
 */

const session = useSessionStore();
const toast = useToastStore();
const { data: rows, isLoading, isError, error, refetch, isFetching } = useAssignmentsQuery();
const endShift = useEndShift();

// A ticking clock so the "on duty 6h 12m" column advances without waiting for the next refetch.
const nowMs = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => (nowMs.value = Date.now()), 30_000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const search = ref("");
const filtered = computed(() =>
  (rows.value ?? []).filter((r) => {
    const t = search.value.trim().toLowerCase();
    if (!t) return true;
    return [r.driver_name, r.vehicle_unit, r.trailer_unit, r.load_ref]
      .filter((f): f is string => Boolean(f))
      .some((f) => f.toLowerCase().includes(t));
  }),
);

const onDuty = (r: AssignmentRow) => r.session_id != null;
const loadLabel = (r: AssignmentRow) =>
  r.load_ref
    ? `${r.load_ref} · ${LOAD_STATUS_LABELS[(r.load_status ?? "draft") as LoadStatus] ?? r.load_status}`
    : "—";

async function end(r: AssignmentRow) {
  try {
    await endShift.mutateAsync(r.driver_id);
    toast.success(`Ended ${r.driver_name}'s shift`);
  } catch (e) {
    toast.error("Could not end the shift", e instanceof Error ? e.message : undefined);
  }
}

const columns: DataTableColumn[] = [
  { key: "driver_name", label: "Driver", headerClass: "min-w-[9rem]" },
  { key: "duty", label: "Duty", headerClass: "min-w-[6rem]" },
  { key: "vehicle_unit", label: "Truck", headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "trailer_unit", label: "Trailer", headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "duration", label: "On duty", numeric: true, headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "load", label: "Current load", headerClass: "min-w-[10rem]", cellClass: "text-ink-secondary" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Who is on duty, in what, and the load they are working." />

    <FilterBar
      v-model:search="search"
      search-placeholder="Search driver, truck, load…"
      :count="filtered.length"
      count-label="drivers"
    />

    <DataTable
      :columns="columns"
      :rows="filtered"
      row-key="driver_id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load the duty board') : null"
      :retrying="isFetching"
      empty-text="No drivers on the roster yet."
      @retry="refetch"
    >
      <template #cell-duty="{ row }">
        <span
          v-if="onDuty(row)"
          class="inline-flex items-center gap-1 rounded-full bg-success-50 px-2.5 py-0.5 text-xs font-medium text-success-700"
        >
          <span class="size-1.5 rounded-full bg-success-500" /> On duty
        </span>
        <span v-else class="inline-flex items-center rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink-muted">
          Off duty
        </span>
      </template>
      <template #cell-duration="{ row }">
        {{ onDuty(row) ? shiftDuration(row.started_at, nowMs) : "—" }}
      </template>
      <template #cell-load="{ row }">{{ loadLabel(row) }}</template>
      <template #actions="{ row }">
        <BaseButton
          v-if="session.canManage && onDuty(row)"
          variant="ghost"
          size="sm"
          :disabled="endShift.isPending.value"
          @click="end(row)"
        >
          End shift
        </BaseButton>
      </template>
    </DataTable>
  </div>
</template>
