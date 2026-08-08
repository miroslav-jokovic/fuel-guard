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
 * Dispatch → Assignments: the live duty board, TELEMATICS-SOURCED (Samsara HOS). Per driver: live duty
 * status, current truck + paired trailer, city location, how long they've been in the status, and the
 * load they are working. "End shift" only appears for a genuinely open in-app duty session (this fleet
 * doesn't use the in-app shift feature, so it stays hidden) — the board itself never depends on it.
 */

const session = useSessionStore();
const toast = useToastStore();
const { data: rows, isLoading, isError, error, refetch, isFetching } = useAssignmentsQuery();
const endShift = useEndShift();

// A ticking clock so the "in status 6h 12m" column advances without waiting for the next refetch.
const nowMs = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => (nowMs.value = Date.now()), 30_000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const search = ref("");
const activeOnly = ref(true);
const filtered = computed(() =>
  (rows.value ?? []).filter((r) => {
    if (activeOnly.value && r.driver_status && r.driver_status !== "active") return false;
    const t = search.value.trim().toLowerCase();
    if (!t) return true;
    return [r.driver_name, r.vehicle_unit, r.trailer_unit, r.load_ref, r.location]
      .filter((f): f is string => Boolean(f))
      .some((f) => f.toLowerCase().includes(t));
  }),
);

// HOS duty badge — same states as the Drivers page.
const HOS_BADGE: Record<string, { label: string; cls: string }> = {
  driving: { label: "Driving", cls: "bg-success-50 text-success-700" },
  on_duty: { label: "On duty", cls: "bg-info-50 text-info-700" },
  off_duty: { label: "Off duty", cls: "bg-surface-muted text-ink-muted" },
  sleeper: { label: "Sleeper", cls: "bg-brand-50 text-brand-700" },
  yard_move: { label: "Yard move", cls: "bg-warning-50 text-warning-700" },
  personal_conveyance: { label: "Personal", cls: "bg-warning-50 text-warning-700" },
  unknown: { label: "—", cls: "bg-surface-muted text-ink-subtle" },
};
const hosBadge = (s: string | null) => HOS_BADGE[s ?? "unknown"] ?? HOS_BADGE.unknown!;

const loadLabel = (r: AssignmentRow) =>
  r.load_ref
    ? `${r.load_ref} · ${LOAD_STATUS_LABELS[(r.load_status ?? "draft") as LoadStatus] ?? r.load_status}`
    : "—";

// Legacy in-app shift gating: End shift appears only for a genuinely open session.
const hasOpenSession = (r: AssignmentRow) => r.session_id != null;

async function end(r: AssignmentRow) {
  // `hasOpenSession` already gates the button; this narrows the nullable type rather than asserting.
  if (!r.session_id) return;
  try {
    await endShift.mutateAsync(r.session_id);
    toast.success(`Ended ${r.driver_name}'s shift`);
  } catch (e) {
    toast.error("Could not end the shift", e instanceof Error ? e.message : undefined);
  }
}

const columns: DataTableColumn[] = [
  { key: "driver_name", label: "Driver", headerClass: "min-w-[9rem]" },
  { key: "duty", label: "Duty status", headerClass: "min-w-[7rem]" },
  { key: "vehicle_unit", label: "Truck", headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "trailer_unit", label: "Trailer", headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "location", label: "Location", headerClass: "min-w-[9rem]", cellClass: "text-ink-secondary" },
  { key: "duration", label: "In status", numeric: true, headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "load", label: "Current load", headerClass: "min-w-[10rem]", cellClass: "text-ink-secondary" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Live from ELD telematics: each driver's duty status, truck, trailer, location, and load." />

    <FilterBar
      v-model:search="search"
      search-placeholder="Search driver, truck, location, load…"
      :count="filtered.length"
      count-label="drivers"
    >
      <template #filters>
        <label class="flex items-center gap-2 text-sm text-ink-secondary">
          <input v-model="activeOnly" type="checkbox" class="rounded border-edge" />
          Active drivers only
        </label>
      </template>
    </FilterBar>

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
          class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
          :class="hosBadge(row.duty_status).cls"
          >{{ hosBadge(row.duty_status).label }}</span
        >
      </template>
      <template #cell-vehicle_unit="{ row }">{{ row.vehicle_unit || "—" }}</template>
      <template #cell-trailer_unit="{ row }">{{ row.trailer_unit || "—" }}</template>
      <template #cell-location="{ row }">{{ row.location || "—" }}</template>
      <template #cell-duration="{ row }">
        {{ row.duty_since ? shiftDuration(row.duty_since, nowMs) : "—" }}
      </template>
      <template #cell-load="{ row }">{{ loadLabel(row) }}</template>
      <template #actions="{ row }">
        <BaseButton
          v-if="session.canManage && hasOpenSession(row)"
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
