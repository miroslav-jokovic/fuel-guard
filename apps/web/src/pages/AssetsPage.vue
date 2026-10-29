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
import EquipmentDriversPanel from "@/features/inventory/EquipmentDriversPanel.vue";
import EquipmentInvoicesPanel from "@/features/inventory/EquipmentInvoicesPanel.vue";
import InvoiceDrawer from "@/features/inventory/InvoiceDrawer.vue";
import InvoiceDetailDrawer from "@/features/inventory/InvoiceDetailDrawer.vue";
import { KIT_RULES_SHOWN } from "@silvicom/shared";
import { useUnitsQuery } from "@/features/inventory/useUnits";
import { useAssetsQuery } from "@/features/inventory/useAssets";
import { useSessionStore } from "@/stores/session";
import { useOpens } from "@/composables/useOpens";

/**
 * Equipment — the truck inventory's own door (MAINTENANCE-SECTION-REDESIGN-PROPOSAL §7a.4, M7; owner
 * Q-MX7 (a)). Everything here is Silvicom's alone; the shop's parts are FleetPal's and live on Parts
 * (the two-inventories ruling, DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md), so this page never says "part".
 *
 * ── FOUR TABS: THREE BY WHO HOLDS IT, THEN THE BILLS (EA2, M10b; contract §9 rule 9, one table each) ──
 *   Trucks & trailers — a row per unit carrying something, and what it carries;
 *   Drivers — a row per thing a driver holds (tablets, D-DE1), with *Not returned* (D-DE3);
 *   In the shop — everything no truck, trailer or driver holds, with a Where filter for "anywhere";
 *   Invoices — a row per bill the shop paid for its equipment (M10b, Q-MX10).
 * The owner's 2026-10-30 brief: "On our equipment pages we will have displayed trucks and drivers
 * (separate tabs) with assigned equipment listed" (EQUIPMENT-ASSIGN-BY-SCAN-PROPOSAL §3.4). Assigning
 * happens on the truck's or driver's own page by scan (EA1); a row here opens that page. M7's
 * `on-trucks` / `inventory` addresses redirect (`routes/maintenance.ts`).
 * The surface KEY stays `maintenance.assets` (D-MX6) — every stored grant still means what it meant.
 *
 * Each tab's count is how many rows it lists, read off the same query key its panel's unfiltered view
 * reads, so vue-query asks once.
 *
 * Add equipment is the page's verb (header on a desk, the bottom bar on a phone — §9 rule 2) on the
 * three holder tabs: a new item lands In the shop until it is assigned. Invoices' verb is Add invoice.
 */

const router = useRouter();
const session = useSessionStore();
const opens = useOpens();

const TABS = [
  { value: "trucks", label: "Trucks & trailers" },
  { value: "drivers", label: "Drivers" },
  { value: "shop", label: "In the shop" },
  { value: "invoices", label: "Invoices" },
] as const;
const unitsQ = useUnitsQuery(computed(() => ({})));
const driversQ = useAssetsQuery(computed(() => ({ holder: "driver" as const, page: 1 })));
const shopQ = useAssetsQuery(computed(() => ({ holder: "shop" as const, page: 1 })));
const counts = computed<Record<string, number | undefined>>(() => ({
  trucks: unitsQ.data.value?.units.filter((u) => u.lines.some((l) => l.held > 0)).length || undefined,
  drivers: driversQ.data.value?.total || undefined,
  shop: shopQ.data.value?.total || undefined,
}));
const tabs = computed(() => TABS.map((t) => ({ value: t.value, label: t.label, badge: counts.value[t.value] })));
type TabKey = (typeof TABS)[number]["value"];

const qs = useQueryState();
const asked = qs.param("tab", TABS.map((t) => t.value), "trucks");
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
// M10b: one invoice open over the Invoices tab — an item's page links here with `?invoice=<id>`.
const invoice = qs.param("invoice");
const addingInvoice = ref(false);

/**
 * The page's one verb, in the header on a desk and the phone's bottom bar (contract §9 rule 2): on
 * the Invoices tab it is Add invoice, since that is the list a person is looking at; elsewhere Add
 * equipment.
 */
const actions = computed<WalkAction[]>(() => {
  if (!session.can("maintenance")) return [];
  return tab.value === "invoices"
    ? [{ label: "Add invoice", primary: true, onClick: () => (addingInvoice.value = true) }]
    : [{ label: "Add equipment", primary: true, onClick: () => (creating.value = true) }];
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Who has each tablet, load bar and strap. To assign one, open the truck or driver and scan it.">
      <template #actions>
        <!-- What a truck should carry is the Trucks & trailers tab's rule (M7) — hidden with the rest of
             Should carry since EA2 (`KIT_RULES_SHOWN`). -->
        <BaseButton v-if="KIT_RULES_SHOWN && session.can('maintenance') && tab === 'trucks'" @click="rulesOpen = true">
          <AppIcon :icon="Cog6ToothIcon" class="-ml-0.5 size-5" aria-hidden="true" /> What each truck should carry
        </BaseButton>
        <!-- The kinds of thing, as a worded button. It is not a nicety: an asset cannot be created
             without a type, and until 2026-09-09 no screen in the product could make one — the same
             dead end `LocationsDrawer.vue` closed for stock locations at I4. Worded rather than an
             icon-only gear for the reason `PartsPage.vue` records. -->
        <!-- On both tabs (owner 2026-10-29, "I don't see where I can add types"): the page opens on On
             trucks, and the kit rules there count types too. -->
        <BaseButton v-if="session.can('maintenance')" @click="typesOpen = true">
          <AppIcon :icon="Cog6ToothIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Types of equipment
        </BaseButton>
        <!-- SP5: shown when Labels opens. It is `maintenance` view and answers to the shop home's screen
             (`maintenance.repair-spend`, D-SURF8), which is switchable per person apart from this page —
             not `maintenance` manage, which hid it from a viewer the Labels page admits. -->
        <BaseButton v-if="opens('/shop/labels') && tab === 'shop'" to="/shop/labels">
          <AppIcon :icon="ScanIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Labels
        </BaseButton>
        <WalkActions :actions="actions" />
      </template>
    </PageHeader>

    <AppTabs v-model="tab" :tabs="tabs" label="Equipment lists" id-prefix="equipment" />

    <div :id="`equipment-panel-${tab}`" role="tabpanel" :aria-labelledby="`equipment-tab-${tab}`">
      <EquipmentOnTrucksPanel v-if="tab === 'trucks'" />
      <EquipmentDriversPanel v-else-if="tab === 'drivers'" />
      <EquipmentInventoryPanel v-else-if="tab === 'shop'" />
      <EquipmentInvoicesPanel v-else @open="invoice = $event" />
    </div>

    <AssetDrawer :open="creating" @close="creating = false" />
    <AssetTypesDrawer :open="typesOpen" @close="typesOpen = false" />
    <KitRulesDrawer v-if="KIT_RULES_SHOWN" :open="rulesOpen" @close="rulesOpen = false" />
    <!-- Mounted while open, as the detail drawer is: neither has anything to keep between openings. -->
    <InvoiceDrawer v-if="addingInvoice" :open="true" @close="addingInvoice = false" @saved="invoice = $event.id" />
    <InvoiceDetailDrawer v-if="invoice" :open="true" :purchase-id="invoice" @close="invoice = ''" @open-invoice="invoice = $event" />
    <WalkActions v-if="actions.length" :actions="actions" bar />
  </div>
</template>
