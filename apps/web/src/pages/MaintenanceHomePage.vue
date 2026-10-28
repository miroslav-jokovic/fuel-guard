<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { AppTabs, useQueryState } from "@silvicom/ui";
import { repairSettled } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import WalkActions, { type WalkAction } from "@/components/WalkActions.vue";
import { useAnnualDueQuery, useOpenWorkOrdersQuery, useUnresolvedDefectsQuery } from "@/features/maintenance/useShopBacklog";
import ShopDefectsPanel from "@/features/maintenance/ShopDefectsPanel.vue";
import ShopWorkOrdersPanel from "@/features/maintenance/ShopWorkOrdersPanel.vue";
import ShopAnnualDuePanel from "@/features/maintenance/ShopAnnualDuePanel.vue";
import ShopRepairBillsPanel from "@/features/maintenance/ShopRepairBillsPanel.vue";
import RoadsideRepairsPanel from "@/features/roadside/RoadsideRepairsPanel.vue";
import { useRoadsideRepairsDueQuery } from "@/features/roadside/useRoadsideInspections";
import { useOpens } from "@/composables/useOpens";
import { useSessionStore } from "@/stores/session";

/**
 * The Shop page: one tab per list (MAINTENANCE-SECTION-REDESIGN-PROPOSAL §7a.3, M6; contract §9 rule 9).
 *
 * ── WHY TABS, AFTER M2 BUILT A STACKED WORKLIST ───────────────────────────────────────────────
 * M2 made this page seven stacked groups of five rows each, every one with an "All N" link to a page of
 * its own (D-MX2). The owner's review of 2026-10-28 named what that cost: the shop was the one section
 * that did not work like the rest of the product — every other list is tabs over one standard table —
 * and its tables had no pager, so "all" lived somewhere else. So the lists the worklist previewed ARE
 * the page now, each a whole, searchable, paged list, and the four pages that held them are its tabs:
 *
 *   Defects · Work orders · Roadside repairs · Annual due · Repair bills
 *
 * Their old addresses redirect here with the tab set (`routes/maintenance.ts`), so an alert or a
 * bookmark lands on the same list. Each tab still answers to its own screen's grant — a tab whose
 * screen the guard would refuse this reader is not drawn — so a per-person denial means what it did.
 *
 * ── WHICH TAB IT OPENS ON ─────────────────────────────────────────────────────────────────────
 * The URL's `?tab=` when there is one. Otherwise the first tab, in deadline order, that has rows —
 * a roadside repair has a 15-day clock, so it leads when there is one — and Defects on a quiet day,
 * where its empty sentence says so. Missing equipment and Running low left this page for the pages
 * that own them (Equipment, M7; Shop parts, M8).
 */

const router = useRouter();
const session = useSessionStore();
const opens = useOpens();

// The counts on the tabs. Each panel reads the same query key, so vue-query asks once.
const defectsQ = useUnresolvedDefectsQuery();
const ordersQ = useOpenWorkOrdersQuery();
const annualQ = useAnnualDueQuery();
const roadsideOpen = computed(() => opens("/shop/roadside-repairs"));
const roadsideQ = useRoadsideRepairsDueQuery(roadsideOpen);

const count = (rows: unknown[] | undefined) => (rows ? rows.length || undefined : undefined);
const roadsideDue = computed(() => (roadsideQ.data.value ? roadsideQ.data.value.filter((r) => !repairSettled(r)) : undefined));

/** Deadline order, which is also the order a quiet-day fallback walks. */
const ALL_TABS = [
  { value: "roadside", label: "Roadside repairs", screen: "/shop/roadside-repairs", rows: () => roadsideDue.value },
  { value: "defects", label: "Defects", screen: "/shop/defects", rows: () => defectsQ.data.value },
  { value: "work-orders", label: "Work orders", screen: "/shop/work-orders", rows: () => ordersQ.data.value },
  { value: "annual", label: "Annual due", screen: "/shop", rows: () => annualQ.data.value },
  { value: "bills", label: "Repair bills", screen: "/shop/repair-spend", rows: () => undefined },
] as const;
type TabKey = (typeof ALL_TABS)[number]["value"];

const shown = computed(() => ALL_TABS.filter((t) => opens(t.screen)));
const tabs = computed(() => shown.value.map((t) => ({ value: t.value, label: t.label, badge: count(t.rows()) })));

const qs = useQueryState();
const asked = qs.param("tab", ALL_TABS.map((t) => t.value));
const tab = computed<TabKey>({
  get: () => {
    const keys = shown.value.map((t) => t.value) as TabKey[];
    if (keys.includes(asked.value as TabKey)) return asked.value as TabKey;
    const withRows = shown.value.find((t) => (t.rows()?.length ?? 0) > 0);
    return (withRows?.value ?? (keys.includes("defects") ? "defects" : keys[0] ?? "defects")) as TabKey;
  },
  // A tab is a different list, so its search, filters, sort and page do not follow it across.
  set: (v) => void router.replace({ query: { tab: v } }),
});

const actions = computed<WalkAction[]>(() =>
  session.can("maintenance") && opens("/shop/scan") ? [{ label: "Scan", primary: true, onClick: () => router.push("/shop/scan") }] : [],
);
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What needs doing in the shop, a list a tab, most urgent first.">
      <template v-if="actions.length" #actions>
        <WalkActions :actions="actions" />
      </template>
    </PageHeader>

    <AppTabs v-model="tab" :tabs="tabs" label="Shop lists" id-prefix="shop" />

    <div :id="`shop-panel-${tab}`" role="tabpanel" :aria-labelledby="`shop-tab-${tab}`">
      <RoadsideRepairsPanel v-if="tab === 'roadside'" />
      <ShopDefectsPanel v-else-if="tab === 'defects'" />
      <ShopWorkOrdersPanel v-else-if="tab === 'work-orders'" />
      <ShopAnnualDuePanel v-else-if="tab === 'annual'" />
      <ShopRepairBillsPanel v-else-if="tab === 'bills'" />
    </div>

    <WalkActions v-if="actions.length" :actions="actions" bar />
  </div>
</template>
