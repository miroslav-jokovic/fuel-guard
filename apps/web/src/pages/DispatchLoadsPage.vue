<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import {
  PlusIcon,
} from "@fuelguard/ui/icons";
/**
 * Dispatch → Loads (Phase 3D, D49).
 *
 * The operator side of the approval gate. Before this page existed the only way to create or approve
 * a load was hand-editing a SQL seed script — which meant D45's "a load is not driver-visible until a
 * human approves and releases it" had no human in it.
 *
 * The default tab is **Needs approval**, and Approve stays disabled until every required checklist
 * item passes, with each failure named. That is the difference between a control and a rubber stamp.
 */
import { computed, ref } from "vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import {
  QUEUE_TABS,
  availableActions,
  checklistFor,
  isException,
  statusLabel,
  tabFor,
  useDispatchLoadsQuery,
  useLoadTransition,
  type DispatchLoad,
  type QueueTab,
} from "@/composables/useDispatchLoads";

const toast = useToastStore();
const { data: loads, isLoading, isError, error, refetch, isFetching } = useDispatchLoadsQuery();
const transition = useLoadTransition();

const tab = ref<QueueTab>("needs_approval");
const search = ref("");
const now = Date.now();

const counts = computed(() => {
  const out: Record<QueueTab, number> = {
    needs_approval: 0, approved: 0, dispatched: 0, active: 0, delivered: 0, exceptions: 0,
  };
  for (const l of loads.value ?? []) {
    out[tabFor(l)] += 1;
    if (isException(l, now)) out.exceptions += 1;
  }
  return out;
});

const rows = computed(() => {
  const term = search.value.trim().toLowerCase();
  return (loads.value ?? [])
    .filter((l) => (tab.value === "exceptions" ? isException(l, now) : tabFor(l) === tab.value))
    .filter((l) =>
      !term
        ? true
        : [l.ref, l.driver_name, l.vehicle_unit, l.commodity]
            .filter(Boolean)
            .some((f) => f!.toLowerCase().includes(term)),
    );
});

const columns: DataTableColumn[] = [
  { key: "ref", label: "Load", sortable: true, headerClass: "min-w-[10rem]", cellClass: "font-medium text-ink" },
  { key: "source", label: "Source", headerClass: "min-w-[6rem]" },
  { key: "driver_name", label: "Driver", sortable: true, headerClass: "min-w-[10rem]", cellClass: "text-ink-secondary" },
  { key: "equipment", label: "Equipment", headerClass: "min-w-[8rem]", cellClass: "text-ink-secondary" },
  { key: "first_stop", label: "First appointment", headerClass: "min-w-[11rem]", cellClass: "text-ink-secondary" },
  { key: "readiness", label: "Ready to approve", headerClass: "min-w-[14rem]" },
  { key: "status", label: "Status", headerClass: "min-w-[8rem]" },
];

function firstAppointment(load: DispatchLoad): string {
  const first = [...load.stops].sort((a, b) => a.seq - b.seq)[0];
  if (!first?.appointment_start) return "—";
  return new Date(first.appointment_start).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

async function act(load: DispatchLoad, action: "submit" | "approve" | "release" | "cancel", reason?: string) {
  try {
    await transition.mutateAsync({ id: load.id, action, ...(reason ? { reason } : {}) });
    toast.success(`${load.ref} ${action}ed`);
  } catch (e) {
    // The API forwards the trigger's message, which names the exact unmet gate.
    toast.error("Could not update the load", e instanceof Error ? e.message : undefined);
  }
}

function cancelLoad(load: DispatchLoad) {
  const reason = window.prompt(`Why is ${load.ref} being canceled?`);
  if (reason && reason.trim()) void act(load, "cancel", reason.trim());
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader
      description="Create, approve and release loads. Nothing reaches a driver's phone until it is approved and released here."
    >
      <template #actions>
        <BaseButton variant="primary" to="/dispatch/loads/new">
          <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" />
          New load
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar
      v-model:search="search"
      search-placeholder="Load, driver, unit…"
      :count="rows.length"
      count-label="loads"
    >
      <template #filters>
        <nav class="flex flex-wrap items-center gap-1" aria-label="Load queue">
          <button
            v-for="t in QUEUE_TABS"
            :key="t.value"
            type="button"
            class="rounded-md px-3 py-1.5 text-sm font-medium"
            :class="
              tab === t.value
                ? 'bg-brand-600 text-ink-inverse'
                : 'text-ink-secondary hover:bg-surface-subtle'
            "
            :aria-current="tab === t.value ? 'page' : undefined"
            @click="tab = t.value"
          >
            {{ t.label }}
            <span v-if="counts[t.value]" class="ml-1 tabular-nums opacity-80">{{ counts[t.value] }}</span>
          </button>
        </nav>
      </template>
    </FilterBar>

    <DataTable
      :columns="columns"
      :rows="rows"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error as Error)?.message : undefined"
      :retrying="isFetching"
      empty-text="Nothing in this queue."
      @retry="refetch()"
    >
      <template #cell-ref="{ row }">
        <RouterLink :to="`/dispatch/loads/${row.id}`" class="font-medium text-brand-600 hover:text-brand-500">
          {{ row.ref }}
        </RouterLink>
      </template>

      <template #cell-source="{ row }">
        <span :class="[BADGE_BASE, toneClass(row.source === 'tms' ? 'info' : 'neutral')]">
          {{ row.source === "tms" ? (row.provider ?? "TMS") : "Manual" }}
        </span>
      </template>

      <template #cell-driver_name="{ row }">
        <span :class="row.driver_name ? '' : 'text-ink-subtle'">{{ row.driver_name ?? "Unassigned" }}</span>
      </template>

      <template #cell-first_stop="{ row }">
        <span class="tabular-nums">{{ firstAppointment(row) }}</span>
      </template>

      <!-- The checklist IS the product: a named list of what is missing, not a dead button. -->
      <template #cell-readiness="{ row }">
        <div v-if="checklistFor(row).canApprove" class="flex items-center gap-1.5">
          <span :class="[BADGE_BASE, toneClass('success')]">Ready</span>
          <span v-if="checklistFor(row).warnings.length" class="text-xs text-ink-muted">
            {{ checklistFor(row).warnings.length }} warning(s)
          </span>
        </div>
        <ul v-else class="space-y-0.5">
          <li
            v-for="b in checklistFor(row).blockers"
            :key="b.id"
            class="text-xs text-danger-600"
          >
            {{ b.detail ?? b.label }}
          </li>
        </ul>
      </template>

      <template #cell-status="{ row }">
        <span :class="[BADGE_BASE, toneClass(row.status === 'canceled' ? 'neutral' : 'brand')]">
          {{ statusLabel(row.status) }}
        </span>
      </template>

      <template #actions="{ row }">
        <KebabMenu>
          <RouterLink class="kebab-item" :to="`/dispatch/loads/${row.id}`">Open</RouterLink>
          <button
            v-if="availableActions(row).submit"
            class="kebab-item"
            @click="act(row, 'submit')"
          >
            Submit for approval
          </button>
          <button
            v-if="row.status === 'pending_approval'"
            class="kebab-item"
            :disabled="!availableActions(row).approve"
            :title="availableActions(row).approveBlockedBy.join(' · ')"
            @click="act(row, 'approve')"
          >
            Approve
          </button>
          <button
            v-if="availableActions(row).release"
            class="kebab-item"
            @click="act(row, 'release')"
          >
            Release to driver
          </button>
          <button v-if="availableActions(row).cancel" class="kebab-item" @click="cancelLoad(row)">
            Cancel load
          </button>
        </KebabMenu>
      </template>
    </DataTable>

    <BaseCard v-if="tab === 'exceptions' && rows.length === 0" padding="sm">
      <p class="text-sm text-ink-muted">
        No exceptions. Declines and loads sitting unapproved for more than a day show up here.
      </p>
    </BaseCard>
  </div>
</template>
