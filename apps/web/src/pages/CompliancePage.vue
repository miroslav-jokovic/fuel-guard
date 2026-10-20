<script setup lang="ts">
import { computed, ref } from "vue";
import {
  AppIcon,
  AppButton as BaseButton,
  AppTabs,
  AppCallout,
  type TabItem,
  StatCard,
  useQueryState,
} from "@silvicom/ui";
import { ClipboardDocumentListIcon } from "@silvicom/ui/icons";
import { useSessionStore } from "@/stores/session";
import { useCertificationsQuery, useComplianceOverviewQuery } from "@/composables/useCompliance";
import PageHeader from "@/components/ui/PageHeader.vue";
import SlideOver from "@/components/SlideOver.vue";
import CertManager from "@/features/hazmat/CertManager.vue";
import QualificationFleetTable from "@/features/compliance/QualificationFleetTable.vue";
import QualificationSeedPanel from "@/features/compliance/QualificationSeedPanel.vue";
import ExportHistory from "@/features/compliance/ExportHistory.vue";
import { buildAttentionStrip } from "@/features/compliance/attentionStrip";
import { useRequestBinder } from "@/composables/useDqExports";
import { useToastStore } from "@/stores/toast";
import { DQ_DUE_FILTERS, FILE_FILTERS } from "@silvicom/shared";

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

const TABS: TabItem[] = [
  { value: "drivers", label: "Drivers" },
  { value: "exports", label: "Exports" },
];
// The view, the tiles and the fleet table's filters all read the URL through one buffer (D-US2).
const qs = useQueryState();
const tab = qs.param("tab", TABS.map((t) => t.value), "drivers");

const carrierOpen = ref(false);
const setupOpen = ref(false);

/**
 * The attention strip (C5): five tiles, each a CLICK-TO-FILTER on the fleet table's existing filter
 * models — it never introduces a second filter mechanism. Counts come from the same overview query
 * the table renders, so a tile and the rows it reveals cannot disagree. Since D-US2 that one model is
 * the URL's `file` and `due`: the tiles write them and the table reads them, through the same buffer
 * and the same shared vocabulary, so a pasted link lights its tile with nothing to keep in sync.
 */
const tableFileFilter = qs.param("file", FILE_FILTERS);
const tableDueFilter = qs.param("due", DQ_DUE_FILTERS);
const strip = computed(() => buildAttentionStrip(overview.data.value?.drivers ?? []));
const activeTile = computed(() => {
  const t = strip.value.find((x) => x.file === tableFileFilter.value && x.due === tableDueFilter.value);
  return tableFileFilter.value === "" && tableDueFilter.value === "" ? null : (t?.key ?? null);
});
function toggleTile(tile: { file: string; due: string; key: string }): void {
  if (activeTile.value === tile.key) {
    tableFileFilter.value = "";
    tableDueFilter.value = "";
  } else {
    tableFileFilter.value = tile.file;
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
        <BaseButton v-if="session.can('roster')" @click="carrierOpen = true">
          <AppIcon :icon="ClipboardDocumentListIcon" class="size-4" aria-hidden="true" />
          Carrier records
        </BaseButton>
      </template>
    </PageHeader>

    <!-- U4/D-UI4: the shared strip. This markup was one of six byte-identical copies, none of which
         handled a single key — `role="tablist"` promises arrow-key navigation and a roving tabindex
         to anyone driving this by keyboard, and all six put every tab in the tab order and listened
         for nothing. -->
    <AppTabs v-model="tab" :tabs="TABS" label="Qualification view" id-prefix="qualification" />

    <div
      v-if="tab === 'drivers'"
      id="qualification-panel-drivers"
      role="tabpanel"
      aria-labelledby="qualification-tab-drivers"
      class="space-y-6"
    >
      <!-- U4/D-UI4: a callout, not a toast — this is true about the page while you look at it and
           survives every action on the page, which is the whole boundary between the two. -->
      <AppCallout v-if="session.can('roster') && notStartedCount > 0 && !setupOpen" tone="brand">
        {{ notStartedCount }} {{ notStartedCount === 1 ? "driver has" : "drivers have" }} no
        qualification file yet.
        <template #actions>
          <BaseButton variant="ghost" size="sm" @click="setupOpen = true">Set up files…</BaseButton>
        </template>
      </AppCallout>

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
        <!-- U3/D-UI2: this strip's anatomy was already contract §2.4 verbatim, which is why the
             shared tile's default size was taken from it rather than from the dashboard's hero.
             ⚠ D-UI5: the badge reading "filter"/"filtering" is GONE. `lib/badges.ts` is the status
             vocabulary, and a badge used as a toggle's label teaches it to mean two things — the
             pressed state was already carried correctly by `aria-pressed` and the ring. -->
        <!-- F4 (US6b): the tiles count the overview's drivers, so they wait for it — loading while it
             loads, and gone when it failed, because five zeros above a table saying "Could not load"
             read as a clean fleet. The table below carries the failure and its Retry (same query). -->
        <div v-if="!overview.isError.value" class="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          <!-- ui-adoption: stat-guarded — the strip above is withheld on a failed overview read, and the table carries the failure (F4). -->
          <StatCard
            v-for="t in strip"
            :key="t.key"
            :label="t.label"
            :value="t.n"
            :loading="overview.isLoading.value"
            :pressed="activeTile === t.key"
            @toggle="toggleTile(t)"
          />
        </div>

        <QualificationFleetTable
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
