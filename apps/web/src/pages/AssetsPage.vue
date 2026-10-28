<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { AppButton as BaseButton, AppIcon, AppTabs, useQueryState } from "@silvicom/ui";
import { Cog6ToothIcon, ScanIcon } from "@silvicom/ui/icons";
import PageHeader from "@/components/ui/PageHeader.vue";
import WalkActions, { type WalkAction } from "@/components/WalkActions.vue";
import AssetDrawer from "@/features/inventory/AssetDrawer.vue";
import AssetTypesDrawer from "@/features/inventory/AssetTypesDrawer.vue";
import KitRulesDrawer from "@/features/inventory/KitRulesDrawer.vue";
import EquipmentOnTrucksPanel from "@/features/inventory/EquipmentOnTrucksPanel.vue";
import EquipmentInventoryPanel from "@/features/inventory/EquipmentInventoryPanel.vue";
import { useUnitsQuery } from "@/features/inventory/useUnits";
import { useAssetsQuery } from "@/features/inventory/useAssets";
import { missingWords } from "@/features/inventory/onBoardWords";
import { useSessionStore } from "@/stores/session";
import { useOpens } from "@/composables/useOpens";

/**
 * Equipment — the truck inventory's own door (MAINTENANCE-SECTION-REDESIGN-PROPOSAL §7a.4, M7; owner
 * Q-MX7 (a)). Everything here is Silvicom's alone; the shop's parts are FleetPal's and live on Parts
 * (the two-inventories ruling, DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md), so this page never says "part".
 *
 * ── TWO TABS, ONE TABLE EACH (contract §9 rule 9) ─────────────────────────────────────────────
 *   On trucks — a row per truck or trailer and what it carries (the owner's "truck assignment" view);
 *   Inventory — a row per item, the list this page was until M7.
 * Invoices joins them in M10. M1 had parented this page to Trucks & trailers ("the same question asked
 * of the thing instead of the truck"); the owner's 2026-10-28 review asked for a page of its own, so
 * the parent came off and the surface KEY stayed (`maintenance.assets`, D-MX6) — every stored grant
 * about this screen still means what it meant.
 *
 * The tab counts are what each tab is for: On trucks counts the units missing something (checked and
 * short, R10), Inventory the items. Both read the query key their panel's unfiltered view reads, so
 * vue-query asks once.
 *
 * Add equipment is the page's verb (header on a desk, the bottom bar on a phone — §9 rule 2) on both
 * tabs: whichever list a person is looking at, a new tablet is added the same way.
 */

const router = useRouter();
const session = useSessionStore();
const opens = useOpens();

const TABS = [
  { value: "on-trucks", label: "On trucks" },
  { value: "inventory", label: "Inventory" },
] as const;
const unitsQ = useUnitsQuery(computed(() => ({})));
const itemsQ = useAssetsQuery(computed(() => ({ page: 1 })));
const counts = computed<Record<string, number | undefined>>(() => ({
  "on-trucks": unitsQ.data.value?.units.filter((u) => missingWords(u) !== null).length || undefined,
  inventory: itemsQ.data.value?.total || undefined,
}));
const tabs = computed(() => TABS.map((t) => ({ value: t.value, label: t.label, badge: counts.value[t.value] })));
type TabKey = (typeof TABS)[number]["value"];

const qs = useQueryState();
const asked = qs.param("tab", TABS.map((t) => t.value), "on-trucks");
const tab = computed<TabKey>({
  get: () => asked.value as TabKey,
  // A tab is a different list, so its search, filters, sort and page do not follow it across.
  set: (v) => void router.replace({ query: { tab: v } }),
});

const typesOpen = ref(false);
const rulesOpen = ref(false);
// `?new=1` opens the drawer (a link may carry it). It is a flag in the same query buffer as the
// filters (D-US2): closing the drawer removes `new` alone and keeps the reader's filters.
const creating = qs.flag("new");

/** The page's one verb, in the header on a desk and the phone's bottom bar (contract §9 rule 2). */
const actions = computed<WalkAction[]>(() =>
  session.can("maintenance") ? [{ label: "Add equipment", primary: true, onClick: () => (creating.value = true) }] : [],
);
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Everything with a number on it — tablets, load bars, straps — and which truck has it.">
      <template #actions>
        <!-- What a truck should carry is the On trucks tab's rule; it moved here from Trucks &
             trailers with Missing equipment (M7). -->
        <BaseButton v-if="session.can('maintenance') && tab === 'on-trucks'" @click="rulesOpen = true">
          <AppIcon :icon="Cog6ToothIcon" class="-ml-0.5 size-5" aria-hidden="true" /> What each truck should carry
        </BaseButton>
        <!-- The kinds of thing, as a worded button. It is not a nicety: an asset cannot be created
             without a type, and until 2026-09-09 no screen in the product could make one — the same
             dead end `LocationsDrawer.vue` closed for stock locations at I4. Worded rather than an
             icon-only gear for the reason `PartsPage.vue` records. -->
        <BaseButton v-if="session.can('maintenance') && tab === 'inventory'" @click="typesOpen = true">
          <AppIcon :icon="Cog6ToothIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Types of equipment
        </BaseButton>
        <!-- SP5: shown when Labels opens. It is `maintenance` view and answers to the shop home's screen
             (`maintenance.repair-spend`, D-SURF8), which is switchable per person apart from this page —
             not `maintenance` manage, which hid it from a viewer the Labels page admits. -->
        <BaseButton v-if="opens('/shop/labels') && tab === 'inventory'" to="/shop/labels">
          <AppIcon :icon="ScanIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Labels
        </BaseButton>
        <WalkActions :actions="actions" />
      </template>
    </PageHeader>

    <AppTabs v-model="tab" :tabs="tabs" label="Equipment lists" id-prefix="equipment" />

    <div :id="`equipment-panel-${tab}`" role="tabpanel" :aria-labelledby="`equipment-tab-${tab}`">
      <EquipmentOnTrucksPanel v-if="tab === 'on-trucks'" />
      <EquipmentInventoryPanel v-else />
    </div>

    <AssetDrawer :open="creating" @close="creating = false" />
    <AssetTypesDrawer :open="typesOpen" @close="typesOpen = false" />
    <KitRulesDrawer :open="rulesOpen" @close="rulesOpen = false" />
    <WalkActions v-if="actions.length" :actions="actions" bar />
  </div>
</template>
