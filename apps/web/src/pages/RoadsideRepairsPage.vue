<script setup lang="ts">
import { computed, nextTick, watch } from "vue";
import { AppButton as BaseButton, AppCard as BaseCard, AppTabs, QueryState, useQueryState } from "@silvicom/ui";
import { byRepairUrgency, repairSettled, todayInZone, type RoadsideRepairDueDto } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import RepairUnitDecision from "@/features/roadside/RepairUnitDecision.vue";
import { useRoadsideRepairsDueQuery } from "@/features/roadside/useRoadsideInspections";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useOpens } from "@/composables/useOpens";
import { formatDate } from "@/lib/format";

/**
 * Roadside repairs due — the Shop's side of the 396.9(d) repair record (INSPECTION-CHALLENGE-PLAN IC11 B2b,
 * Q-IC16 (a), owner 2026-10-19).
 *
 * A technician names the FleetPal work order that repaired an inspection's vehicle violations, but holds
 * maintenance and not safety, so the inspection page (where safety certifies) is closed to them. This page
 * is their door: every violated unit of the last year, open ones nearest to today first
 * (`byRepairUrgency`), each decided on the same component the inspection page's Repair card uses
 * (`RepairUnitDecision`). The Shop home's "Roadside repairs due" section is its preview, and the
 * `roadside_repair_due` alert opens it at `?inspection=` — that inspection's units come into view.
 *
 * Non-nav, parented on the Shop home: I4 fixes the maintenance group at six rows (`surfaceCatalogue.ts`).
 */

const qs = useQueryState();
const tab = qs.param("tab", ["open", "recorded"], "open");
const focus = qs.param("inspection");

const { zone } = useOrgTimezone();
const today = computed(() => todayInZone(new Date(), zone.value));
const due = useRoadsideRepairsDueQuery();

const open = computed(() => (due.data.value ?? []).filter((r) => !repairSettled(r)).sort(byRepairUrgency(today.value)));
const recorded = computed(() =>
  (due.data.value ?? []).filter(repairSettled).sort((a, b) => (b.decision?.decidedAt ?? b.dueOn).localeCompare(a.decision?.decidedAt ?? a.dueOn)),
);
const rows = computed(() => (tab.value === "recorded" ? recorded.value : open.value));
const tabs = computed(() => [
  { value: "open", label: "Open", badge: open.value.length || undefined },
  { value: "recorded", label: "Recorded", badge: recorded.value.length || undefined },
]);

const opens = useOpens();
const inspectionLink = (r: RoadsideRepairDueDto) => {
  const to = { name: "roadside-inspection", params: { id: r.inspection.id } };
  return opens(to) ? to : null;
};
const where = (r: RoadsideRepairDueDto) =>
  [r.inspection.reportNumber ? `Report ${r.inspection.reportNumber}` : "Roadside inspection", `inspected ${formatDate(r.inspection.inspectionDate)}`, [r.inspection.locationDesc, r.inspection.reportState].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" · ");

/**
 * Arriving from the bell (`?inspection=`): open the tab that holds its units, then bring the first into view
 * once it is drawn. Once only — a later refetch must not pull the reader back. The tab moves through the URL,
 * so the scroll waits on the rows, not on a tick.
 */
let tabChosen = false;
let scrolled = false;
watch(
  () => due.data.value,
  (list) => {
    if (tabChosen || !list || !focus.value) return;
    tabChosen = true;
    const mine = list.filter((r) => r.inspection.id === focus.value);
    if (mine.length && mine.every(repairSettled)) tab.value = "recorded";
  },
  { immediate: true },
);
watch(
  rows,
  async (list) => {
    if (scrolled || !focus.value || !list.some((r) => r.inspection.id === focus.value)) return;
    scrolled = true;
    await nextTick();
    const el = [...document.querySelectorAll<HTMLElement>("[data-inspection]")].find((e) => e.dataset.inspection === focus.value);
    el?.scrollIntoView({ block: "start" });
  },
  { immediate: true },
);
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      description="Every truck or trailer with a vehicle violation on a roadside inspection of the last year. Name the FleetPal work order that repaired it, or say where it was repaired — the report must be certified within 15 days of the inspection (49 CFR 396.9(d))."
    />

    <AppTabs v-model="tab" :tabs="tabs" label="Roadside repairs" />

    <QueryState
      :loading="due.isLoading.value && !due.data.value"
      :error="due.isError.value ? due.error.value : null"
      :retrying="due.isFetching.value"
      loading-text="Loading the roadside repairs…"
      error-text="Could not load the roadside repairs."
      @retry="due.refetch()"
    >
      <BaseCard>
        <p v-if="!rows.length" class="text-sm text-ink-muted" data-test="repairs-empty">
          {{ tab === "open" ? "Every roadside repair of the last year is recorded." : "No roadside repair has been recorded yet." }}
        </p>
        <div v-else class="divide-y divide-edge">
          <RepairUnitDecision
            v-for="r in rows"
            :key="r.unitId"
            :data-inspection="r.inspection.id"
            :class="['py-4 first:pt-0 last:pb-0', r.inspection.id === focus ? 'scroll-mt-24' : '']"
            :inspection-id="r.inspection.id"
            :repair="r"
            :today="today"
          >
            <template #context>
              <p class="mt-0.5 text-xs text-ink-muted" data-test="repair-where">
                {{ where(r) }}
                <BaseButton v-if="inspectionLink(r)" variant="link" class="ml-1 text-xs" :to="inspectionLink(r)!">Open the inspection</BaseButton>
              </p>
            </template>
          </RepairUnitDecision>
        </div>
      </BaseCard>
    </QueryState>
  </div>
</template>
