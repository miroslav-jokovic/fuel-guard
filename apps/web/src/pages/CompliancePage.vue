<script setup lang="ts">
import { computed, ref } from "vue";
import { AppIcon } from "@fuelguard/ui";
import { ClipboardDocumentListIcon } from "@fuelguard/ui/icons";
import { useSessionStore } from "@/stores/session";
import { useCertificationsQuery, useComplianceOverviewQuery } from "@/composables/useCompliance";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppButton as BaseButton, AppCard as BaseCard } from "@fuelguard/ui";
import SlideOver from "@/components/SlideOver.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import CertManager from "@/features/hazmat/CertManager.vue";
import QualificationFleetTable from "@/features/compliance/QualificationFleetTable.vue";
import QualificationSeedPanel from "@/features/compliance/QualificationSeedPanel.vue";
import ExportHistory from "@/features/compliance/ExportHistory.vue";
import { buildAttentionStrip } from "@/features/compliance/attentionStrip";
import { useRequestBinder } from "@/composables/useDqExports";
import { useToastStore } from "@/stores/toast";

/**
 * Driver Qualification. The page COMPOSES; every surface is a component.
 *
 * Two tabs where there were four. The fleet table is one row per driver (queue and roster were two
 * answers to one question and split the audience across tabs); binder selection lives on the table
 * it selects from; and first-time seeding is a prompt that appears only while files are missing,
 * instead of a permanent tab. Exports stay a tab — a job ledger is a genuinely different surface.
 */
const session = useSessionStore();
const toast = useToastStore();

const overview = useComplianceOverviewQuery();
const orgCertsQ = useCertificationsQuery(
  ref("organization"),
  computed(() => session.orgId ?? null),
);

type TabValue = "drivers" | "exports";
const tab = ref<TabValue>("drivers");
const TABS: Array<{ value: TabValue; label: string }> = [
  { value: "drivers", label: "Drivers" },
  { value: "exports", label: "Exports" },
];

const carrierOpen = ref(false);
const setupOpen = ref(false);

/**
 * The attention strip (C5): five tiles, each a CLICK-TO-FILTER on the fleet table's existing filter
 * models — it never introduces a second filter mechanism. Counts come from the same overview query
 * the table renders, so a tile and the rows it reveals cannot disagree.
 */
const tableStateFilter = ref("");
const tableDueFilter = ref("");
const strip = computed(() => buildAttentionStrip(overview.data.value?.drivers ?? []));
const activeTile = computed(() => {
  const t = strip.value.find((x) => x.state === tableStateFilter.value && x.due === tableDueFilter.value);
  return tableStateFilter.value === "" && tableDueFilter.value === "" ? null : (t?.key ?? null);
});
function toggleTile(tile: { state: string; due: string; key: string }): void {
  if (activeTile.value === tile.key) {
    tableStateFilter.value = "";
    tableDueFilter.value = "";
  } else {
    tableStateFilter.value = tile.state;
    tableDueFilter.value = tile.due;
  }
}

const seedDrivers = computed(() =>
  (overview.data.value?.drivers ?? []).map((d) => ({
    id: d.driver_id,
    full_name: d.driver_name,
    state: d.state,
  })),
);
const notStartedCount = computed(
  () => seedDrivers.value.filter((d) => d.state === "not_started").length,
);
const orgSeeded = computed(() => {
  const kinds = new Set((orgCertsQ.data.value ?? []).map((c) => c.kind));
  return kinds.has("phmsa_registration") && kinds.has("financial_responsibility");
});

const requestBinder = useRequestBinder();
async function buildBinder(driverIds: string[], includeRestricted: boolean): Promise<void> {
  try {
    await requestBinder.mutateAsync({ driverIds, asAt: null, includeRestricted });
    tab.value = "exports";
    // It is a job, so the honest thing to say is what happens next and roughly when — not "Done".
    toast.success(
      "Building the binder",
      `${driverIds.length} qualification ${driverIds.length === 1 ? "file" : "files"}. It appears under Exports in a minute or two.`,
    );
  } catch (e) {
    toast.error("Could not start the binder", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      description="Manage driver qualification files and resolve missing or expired credentials before dispatch."
    >
      <template #actions>
        <BaseButton v-if="session.canManage" @click="carrierOpen = true">
          <AppIcon :icon="ClipboardDocumentListIcon" class="size-4" aria-hidden="true" />
          Carrier records
        </BaseButton>
      </template>
    </PageHeader>

    <nav
      class="flex gap-1 rounded-surface bg-surface-muted p-1 text-sm"
      role="tablist"
      aria-label="Qualification view"
    >
      <BaseButton
        v-for="t in TABS"
        :id="`qualification-tab-${t.value}`"
        :key="t.value"
        type="button"
        role="tab"
        class="rounded-control px-3 py-1.5 font-medium transition"
        :class="
          tab === t.value ? 'bg-surface text-ink' : 'text-ink-muted hover:text-ink-secondary'
        "
        :aria-selected="tab === t.value"
        :aria-controls="`qualification-panel-${t.value}`"
        @click="tab = t.value"
      >
        {{ t.label }}
      </BaseButton>
    </nav>

    <div
      v-if="tab === 'drivers'"
      id="qualification-panel-drivers"
      role="tabpanel"
      aria-labelledby="qualification-tab-drivers"
      class="space-y-6"
    >
      <div
        v-if="session.canManage && notStartedCount > 0 && !setupOpen"
        class="flex flex-wrap items-center gap-2 rounded-surface bg-brand-50 px-4 py-2.5 ring-1 ring-brand-100"
      >
        <span class="text-sm font-medium text-brand-800">
          {{ notStartedCount }} {{ notStartedCount === 1 ? "driver has" : "drivers have" }} no
          qualification file yet.
        </span>
        <BaseButton variant="ghost" size="sm" class="ml-auto" @click="setupOpen = true">
          Set up files…
        </BaseButton>
      </div>

      <template v-if="setupOpen">
        <div class="flex items-center justify-between gap-2">
          <p class="text-sm text-ink-muted">
            Enter what is already on paper; existing records are never overwritten.
          </p>
          <BaseButton variant="ghost" size="sm" @click="setupOpen = false">
            Back to drivers
          </BaseButton>
        </div>
        <QualificationSeedPanel
          :key="seedDrivers.length"
          :drivers="seedDrivers"
          :org-seeded="orgSeeded"
          @seeded="setupOpen = false"
        />
      </template>

      <template v-else>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          <BaseCard
            v-for="t in strip"
            :key="t.key"
            padding="sm"
            :as="'button'"
            class="text-left transition"
            :class="activeTile === t.key ? 'ring-2 ring-brand-600' : 'hover:bg-surface-subtle'"
            role="button"
            :aria-pressed="activeTile === t.key"
            @click="toggleTile(t)"
          >
            <p class="text-xs font-medium uppercase tracking-wide text-ink-muted">{{ t.label }}</p>
            <p class="mt-1 text-2xl font-bold text-ink">{{ t.n }}</p>
            <p class="mt-0.5">
              <span :class="[BADGE_BASE, toneClass(t.tone)]">{{
                activeTile === t.key ? "filtering" : "filter"
              }}</span>
            </p>
          </BaseCard>
        </div>

        <QualificationFleetTable
          v-model:state-filter="tableStateFilter"
          v-model:due-filter="tableDueFilter"
          :building="requestBinder.isPending.value"
          @build-binder="buildBinder"
        />
      </template>
    </div>

    <div
      v-else
      id="qualification-panel-exports"
      role="tabpanel"
      aria-labelledby="qualification-tab-exports"
    >
      <ExportHistory />
    </div>

    <SlideOver
      :open="carrierOpen"
      size="lg"
      title="Carrier records (PHMSA registration, insurance)"
      @close="carrierOpen = false"
    >
      <CertManager
        v-if="session.orgId"
        subject-type="organization"
        :subject-id="session.orgId || ''"
      />
    </SlideOver>
  </div>
</template>
