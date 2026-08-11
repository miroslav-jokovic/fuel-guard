<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  shiftDuration,
  LOAD_STATUS_LABELS,
  type AssignmentRow,
  type LoadStatus,
} from "@fuelguard/shared";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppCheckbox as BaseCheckbox } from "@fuelguard/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import AssignmentHistory from "@/features/dispatch/AssignmentHistory.vue";
import { useAssignmentsQuery, useEndShift } from "@/features/dispatch/useAssignments";

/**
 * Dispatch → Assignments: the live duty board, TELEMATICS-SOURCED (Samsara HOS). Per driver: live duty
 * status, current truck + paired trailer, city location, how long they've been in the status, and the
 * load they are working. "End shift" only appears for a genuinely open in-app duty session (this fleet
 * doesn't use the in-app shift feature, so it stays hidden) — the board itself never depends on it.
 *
 * The HISTORY tab is the same subject over time (L5): who held which truck and trailer, for how long.
 * A tab rather than a page — it is one more view of assignments, not a second place to look for them.
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

/** HOS duty badge — tones from the shared vocabulary, so it matches every other status in the app.
 *  Labels are lowercase because BADGE_BASE capitalises. */
const HOS_BADGE: Record<string, { label: string; tone: string }> = {
  driving: { label: "driving", tone: "success" },
  on_duty: { label: "on duty", tone: "info" },
  off_duty: { label: "off duty", tone: "neutral" },
  sleeper: { label: "sleeper", tone: "brand" },
  yard_move: { label: "yard move", tone: "warning" },
  personal_conveyance: { label: "personal", tone: "warning" },
  unknown: { label: "unknown", tone: "neutral" },
};
const hosBadge = (s: string | null) => HOS_BADGE[s ?? "unknown"] ?? HOS_BADGE.unknown!;

const TABS = [
  { value: "board", label: "Duty board" },
  { value: "history", label: "History" },
] as const;
const tab = ref<(typeof TABS)[number]["value"]>("board");

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
  {
    key: "vehicle_unit",
    label: "Truck",
    headerClass: "min-w-[6rem]",
    cellClass: "text-ink-secondary",
  },
  {
    key: "trailer_unit",
    label: "Trailer",
    headerClass: "min-w-[6rem]",
    cellClass: "text-ink-secondary",
  },
  {
    key: "location",
    label: "Location",
    headerClass: "min-w-[9rem]",
    cellClass: "text-ink-secondary",
  },
  {
    key: "duration",
    label: "In status",
    numeric: true,
    headerClass: "min-w-[6rem]",
    cellClass: "text-ink-secondary",
  },
  {
    key: "load",
    label: "Current load",
    headerClass: "min-w-[10rem]",
    cellClass: "text-ink-secondary",
  },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :description="
        tab === 'board'
          ? 'Live from ELD telematics: each driver\'s duty status, truck, trailer, location, and load.'
          : 'Who held which truck and trailer, and when. The attribution trail behind every evidence panel.'
      "
    />

    <nav
      class="flex gap-1 rounded-surface bg-surface-muted p-1 text-sm"
      role="tablist"
      aria-label="Assignments view"
    >
      <BaseButton
        v-for="t in TABS"
        :key="t.value"
        type="button"
        role="tab"
        class="rounded-control px-3 py-1.5 font-medium transition"
        :class="
          tab === t.value
            ? 'bg-surface text-ink'
            : 'text-ink-muted hover:text-ink-secondary'
        "
        :aria-selected="tab === t.value"
        @click="tab = t.value"
      >
        {{ t.label }}
      </BaseButton>
    </nav>

    <AssignmentHistory v-if="tab === 'history'" />

    <template v-else>
      <FilterBar
        v-model:search="search"
        search-placeholder="Search driver, truck, location, load…"
        :count="filtered.length"
        count-label="drivers"
      >
        <template #filters>
          <BaseCheckbox v-model="activeOnly">Active drivers only</BaseCheckbox>
        </template>
      </FilterBar>

      <DataTable
        :columns="columns"
        :rows="filtered"
        row-key="driver_id"
        :loading="isLoading"
        :error="
          isError
            ? error instanceof Error
              ? error.message
              : 'Failed to load the duty board'
            : null
        "
        :retrying="isFetching"
        empty-text="No drivers on the roster yet."
        @retry="refetch"
      >
        <template #cell-duty="{ row }">
          <span :class="[BADGE_BASE, toneClass(hosBadge(row.duty_status).tone)]">
            {{ hosBadge(row.duty_status).label }}
          </span>
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
    </template>
  </div>
</template>
