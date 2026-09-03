<script setup lang="ts">
/**
 * The Fuel Log — one page over the three views of the same week's fuel (FUEL-C2, D-FUI1).
 *
 * ── WHAT THIS REPLACED ──────────────────────────────────────────────────────────────────────────
 * Three nav items — Fuel Log, Transactions, Rejections — over one carrier's fuel, organised by where
 * the data came from rather than by what a reader wants to know. Answering "what did truck 654 do in
 * August" meant three pages, three date controls, and (before FUEL-T1) three different answers to
 * what a day is. The section is now organised by the question: the enriched record, what was refused,
 * and the raw lines behind both, under one window and one truck filter.
 *
 * Fuel Log keeps the name because it is the enriched record and the write surface; the other two are
 * views of its inputs.
 *
 * ── WHY THE SHELL OWNS SO LITTLE ────────────────────────────────────────────────────────────────
 * Each tab renders its own filter bar, because the count in that bar must be the count of what THAT
 * tab is showing. X8 is the measured version of the alternative: one shared count on the fuel-spend
 * page was the unfiltered fill total on four of its six tabs, sitting beside numbers that meant
 * something else. A shared bar makes that mistake possible; a per-tab bar makes it unavailable.
 *
 * What the shell does own is what is genuinely one thing across the three: the window and the truck
 * (`useFuelLogFilters`, called ONCE here and passed down — see its header for why not once per tab),
 * and logging a fill-up, which is an act on the fuel log rather than on one of its views.
 *
 * ── THE GATE, WHICH IS NOT COSMETIC ─────────────────────────────────────────────────────────────
 * ⚠ `/fuel-log` is catalogued `always` and the two pages absorbed here were `section("fuel")`.
 * Merging them without a check would widen who can read a decline — `recruiter` and `technician` both
 * carry `fuel: "none"` and both reach this path today. So the two absorbed tabs render only for a
 * caller who can view the fuel section, read from the same matrix the catalogue reads (D-FUI12), and
 * a URL naming a tab this caller cannot see falls back to Fills rather than to a blank page.
 *
 * That gate is UI only, as every `show:` in this app is: `declined_transactions` and
 * `efs_transactions` are org-scoped in RLS and not section-scoped, so this hides a screen and does
 * not defend a table. It restores the boundary the merge would otherwise have dissolved, and does
 * not invent one.
 *
 * ⚠ **C4 brings the same question a second time, and the answer is the same.** `/import` was
 * catalogued `manage("fuel")` and is now a drawer opened from this `always` page, so the button that
 * opens it is gated on `can("fuel")` — MANAGE, not view, because it is a write. The API refuses the
 * roles that lack it either way; an action offered and then refused is still a defect.
 */
import { computed, ref } from "vue";
import { AppIcon, AppTabs, type TabItem } from "@silvicom/ui";
import { ArrowUpTrayIcon, PlusIcon } from "@silvicom/ui/icons";
import { AppButton as BaseButton } from "@silvicom/ui";
import type { FillUpInput } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import SlideOver from "@/components/SlideOver.vue";
import FillUpForm from "@/features/fuel/FillUpForm.vue";
import EfsImportDrawer from "@/features/import/EfsImportDrawer.vue";
import FillsTab from "@/features/fuel/FillsTab.vue";
import DeclinesTab from "@/features/fuel/DeclinesTab.vue";
import SourceRecordsTab from "@/features/fuel/SourceRecordsTab.vue";
import { useFuelLogFilters, DEFAULT_FUEL_LOG_TAB, type FuelLogTab } from "@/features/fuel/useFuelLogFilters";
import { useCreateFillUp } from "@/features/fuel/useFuelLog";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";

const session = useSessionStore();
const shared = useFuelLogFilters();

/** The two absorbed tabs, behind the section their old routes were catalogued under. */
const canSeeFeeds = computed(() => session.canView("fuel"));
/** The backfill drawer, behind the level `/import` asked for — manage, because it writes fills. */
const canBackfill = computed(() => session.can("fuel"));

const TAB_DESCRIPTIONS: Record<FuelLogTab, string> = {
  fills: "Every recorded fill-up with computed MPG and anomaly status.",
  declines: "Declined fuel-card attempts from your uploaded EFS Reject reports (a fraud/control signal).",
  source: "Every line from your uploaded EFS Transaction reports, exactly as received.",
};

const tabs = computed<TabItem[]>(() => [
  { value: "fills", label: "Fills" },
  ...(canSeeFeeds.value
    ? ([
        { value: "declines", label: "Declines" },
        { value: "source", label: "Source records" },
      ] as TabItem[])
    : []),
]);

/**
 * The tab actually shown. A link naming a tab this caller cannot see — or one that never existed —
 * lands on Fills, which is the same fallback `FuelReconciliationPage` takes for a policy tab an org
 * no longer has. Writing the URL back is deliberately NOT done here: correcting somebody's link
 * under them loses the evidence of what they were sent.
 */
const visible = computed(() => new Set(tabs.value.map((t) => t.value)));
const tab = computed<FuelLogTab>({
  get: () => (visible.value.has(shared.tab.value) ? shared.tab.value : DEFAULT_FUEL_LOG_TAB),
  set: (v) => (shared.tab.value = v),
});

// ── Log fill-up ───────────────────────────────────────────────────────────────────────────────────
// On the shell rather than the Fills tab: a primary action that appeared and disappeared as a reader
// moved between a fill and the decline beside it would read as the page losing a capability.
const { data: vehicles } = useVehiclesQuery();
const toast = useToastStore();
const drawerOpen = ref(false);
const importOpen = ref(false);
const createFillUp = useCreateFillUp();

async function onSubmit(payload: { input: FillUpInput; file: File | null }) {
  try {
    await createFillUp.mutateAsync(payload);
    drawerOpen.value = false;
    toast.success("Fill-up logged");
  } catch (e) {
    toast.error("Could not save fill-up", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader :description="TAB_DESCRIPTIONS[tab]">
      <template #actions>
        <!-- C4: `/import` is gone, and this is where its EFS half lives. Secondary, because it is
             the exception path — every fill in production arrived through the feed, not this. -->
        <BaseButton v-if="canBackfill" variant="secondary" @click="importOpen = true">
          <AppIcon :icon="ArrowUpTrayIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Backfill EFS reports
        </BaseButton>
        <BaseButton variant="primary" @click="drawerOpen = true">
          <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Log fill-up
        </BaseButton>
      </template>
    </PageHeader>

    <AppTabs v-if="tabs.length > 1" v-model="tab" :tabs="tabs" label="Fuel log views" id-prefix="fuel-log" />

    <div v-if="tab === 'fills'" id="fuel-log-panel-fills" role="tabpanel" aria-labelledby="fuel-log-tab-fills">
      <FillsTab :shared="shared" />
    </div>
    <div
      v-else-if="tab === 'declines'"
      id="fuel-log-panel-declines"
      role="tabpanel"
      aria-labelledby="fuel-log-tab-declines"
    >
      <DeclinesTab :shared="shared" />
    </div>
    <div v-else id="fuel-log-panel-source" role="tabpanel" aria-labelledby="fuel-log-tab-source">
      <SourceRecordsTab :shared="shared" />
    </div>

    <!-- `v-if` on the gate as well as on the button: the drawer holds a write mutation, and a
         component nobody may use should not be instantiated to sit closed behind a hidden button. -->
    <EfsImportDrawer v-if="canBackfill" :open="importOpen" @close="importOpen = false" />

    <SlideOver :open="drawerOpen" title="Log fill-up" @close="drawerOpen = false">
      <FillUpForm
        :vehicles="vehicles ?? []"
        :submitting="createFillUp.isPending.value"
        @submit="onSubmit"
        @cancel="drawerOpen = false"
      />
    </SlideOver>
  </div>
</template>
