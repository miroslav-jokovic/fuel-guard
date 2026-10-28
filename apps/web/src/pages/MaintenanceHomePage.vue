<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { AppCallout, StatCard, countLabelFor, type DataTableColumn } from "@silvicom/ui";
import { GaugeIcon } from "@silvicom/ui/icons";
import {
  inspectionExpiry,
  repairSettled,
  todayInZone,
  type AnnualDueDto,
  type ShopDefectDto,
  type ShopWorkOrderDto,
  type StockLineDto,
  type UnitKitDto,
} from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import { lastFullMonth } from "@/lib/dateWindow";
import { fmtMoney } from "@/lib/chartTheme";
import { formatDate } from "@/lib/format";
import { useMaintenanceSpendQuery } from "@/features/maintenance/useMaintenanceSpend";
import { useAnnualDueQuery, useOpenWorkOrdersQuery, useUnresolvedDefectsQuery } from "@/features/maintenance/useShopBacklog";
import ShopWorklistSection from "@/features/maintenance/ShopWorklistSection.vue";
import { useCountSessionsQuery, useLowStockQuery } from "@/features/inventory/useInventory";
import { useUnitsQuery } from "@/features/inventory/useUnits";
import StartCountDrawer from "@/features/inventory/StartCountDrawer.vue";
import OpenCountsList from "@/features/inventory/OpenCountsList.vue";
import StockLevelCell from "@/features/inventory/StockLevelCell.vue";
import WalkActions, { type WalkAction } from "@/components/WalkActions.vue";
import RoadsideRepairsDueSection from "@/features/roadside/RoadsideRepairsDueSection.vue";
import { useRoadsideRepairsDueQuery } from "@/features/roadside/useRoadsideInspections";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useOpens } from "@/composables/useOpens";
import { useSessionStore } from "@/stores/session";

/**
 * The shop's home: one worklist (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §4.2, M2, D-MX1/D-MX2).
 *
 * ── A WORKLIST, NOT A ROW OF COUNTERS ─────────────────────────────────────────────────────────
 * Until 2026-10-27 this page was six tiles over two previews, and production rendered it as two
 * FleetPal zeros, an empty roadside card and a "no parts yet" callout above sixty percent blank
 * screen — the 2026-09-10 critique's finding, back again because the inventory half was gated on
 * the org having a part. D-MX2 is the rule that replaces the tiles: **no counter without its list.**
 * Each group below is the head of a whole list with "All N" beside it, drawn only when it has rows
 * (`ShopWorklistSection`), ordered by how hard the deadline is:
 *
 *   1. Roadside repairs due — a 15-day certification clock (Q-IC16 (a)).
 *   2. Found on an inspection, not fixed — FleetPal's open defects, oldest first.
 *   3. In the shop now — FleetPal's open work orders, oldest first.
 *   4. Annual inspection due — within 30 days or overdue, by our record (Q-MX5 (a)).
 *   5. Missing equipment — checked trucks and trailers short of what they should carry (R10).
 *   6. Running low — shelves at or below their order point (Parts stays: FleetPal fills it, F12).
 *   7. Checks left open — walks somebody started and nobody closed (R9).
 *
 * "Equipment not returned" (D-DE3) joins as group 5's neighbour when DE2 ships its read; nothing
 * here guesses at it. The repair-bills figure is the one money figure and the door to its page; it
 * is not a counter over a list, so it sits under the list rather than above it.
 *
 * ── THE TWO VERBS, WHERE THE HAND IS ──────────────────────────────────────────────────────────
 * Scan and Count a shelf are defined once and rendered twice by `WalkActions` — the header row from
 * `sm` up, a fixed bottom bar below it — because the owner's users hold a tablet or a phone with a
 * scanner in the other hand (Q-MX1), and the bottom of a phone is where the thumb is (research §5.1).
 *
 * ── A QUIET DAY SAYS SO ───────────────────────────────────────────────────────────────────────
 * When every read has answered and every list is empty the page says "Nothing waits on the shop
 * today" once — not seven headings over seven empty tables, and not while a read is still in flight
 * or has failed, because either of those would turn a 500 into "nothing due" (D-US9).
 */

/** How much of each whole list the home shows before handing over to the page that owns it. */
const PREVIEW_ROWS = 5;

const router = useRouter();
const session = useSessionStore();
const opens = useOpens();
const { zone } = useOrgTimezone();
const today = computed(() => todayInZone(new Date(), zone.value));

// ── the reads ──────────────────────────────────────────────────────────────────────────────────
const defectsQ = useUnresolvedDefectsQuery();
const ordersQ = useOpenWorkOrdersQuery();
const annualQ = useAnnualDueQuery();
// The section draws its own rows; this read shares its key, so vue-query makes one request of it
// and the page can still say whether the day is quiet.
const roadsideOpen = computed(() => opens("/shop/roadside-repairs"));
const roadsideQ = useRoadsideRepairsDueQuery(roadsideOpen);
const shortFilter = ref({ shortOnly: true, checkedOnly: true });
const shortQ = useUnitsQuery(shortFilter);
const lowQ = useLowStockQuery();
const walksFilter = ref({ status: "open" as const });
const walksQ = useCountSessionsQuery(walksFilter);
const window_ = lastFullMonth();
const spendFilter = ref({ from: window_.from, to: window_.to, page: 1 });
const spendQ = useMaintenanceSpendQuery(spendFilter);

const defects = computed<ShopDefectDto[]>(() => defectsQ.data.value ?? []);
const orders = computed<ShopWorkOrderDto[]>(() => ordersQ.data.value ?? []);
const annual = computed<AnnualDueDto[]>(() => annualQ.data.value ?? []);
const roadside = computed(() => (roadsideQ.data.value ?? []).filter((r) => !repairSettled(r)));
const shortUnits = computed<UnitKitDto[]>(() => shortQ.data.value?.units ?? []);
const shortTotal = computed(() => shortQ.data.value?.total ?? 0);
const low = computed<StockLineDto[]>(() => lowQ.data.value?.lines ?? []);
const lowTotal = computed(() => lowQ.data.value?.total ?? 0);
const walksTotal = computed(() => walksQ.data.value?.total ?? 0);

const reads = [defectsQ, ordersQ, annualQ, roadsideQ, shortQ, lowQ, walksQ];
const settled = computed(() => reads.every((q) => !q.isLoading.value && !q.isError.value));
const quiet = computed(
  () =>
    settled.value &&
    defects.value.length === 0 &&
    orders.value.length === 0 &&
    annual.value.length === 0 &&
    roadside.value.length === 0 &&
    shortTotal.value === 0 &&
    lowTotal.value === 0 &&
    walksTotal.value === 0,
);

// ── the doors (SP5, plan §4b): every link asks whether its page opens for this reader ─────────
const unitsOpen = computed(() => opens("/shop/units"));
const partsOpen = computed(() => opens("/shop/inventory"));
const inspectionsOpen = computed(() => opens("/shop/inspections"));
const defectsOpen = computed(() => opens("/shop/defects"));
const ordersOpen = computed(() => opens("/shop/work-orders"));

/** "All 7 open defects" — the count is the whole list's, which arrives whole (`useShopBacklog`). */
const allLabel = (n: number, what: string) => `All ${n} ${what}`;

// ── the verbs ──────────────────────────────────────────────────────────────────────────────────
const counting = ref(false);
const actions = computed<WalkAction[]>(() => {
  if (!session.can("maintenance")) return [];
  const list: WalkAction[] = [];
  if (opens("/shop/scan")) list.push({ label: "Scan", primary: true, onClick: () => router.push("/shop/scan") });
  if (partsOpen.value) list.push({ label: "Count a shelf", onClick: () => (counting.value = true) });
  return list;
});

// ── columns: three facts a row, because below `md` each row is a card (§4.5) ──────────────────
const DEFECT_COLUMNS: DataTableColumn[] = [
  { key: "unitNumber", label: "Unit", card: "title", cellClass: "font-medium text-ink", width: "sm" },
  { key: "what", label: "Found", card: "sentence" },
  { key: "detectedAt", label: "On", card: "meta", width: "md" },
];
const ORDER_COLUMNS: DataTableColumn[] = [
  { key: "unitNumber", label: "Unit", card: "title", cellClass: "font-medium text-ink", width: "sm" },
  { key: "work", label: "Work", card: "sentence" },
  { key: "openedAt", label: "Opened", card: "meta", width: "md" },
];
const ANNUAL_COLUMNS: DataTableColumn[] = [
  { key: "unitNumber", label: "Unit", card: "title", cellClass: "font-medium text-ink", width: "sm" },
  { key: "due", label: "Due", card: "sentence" },
  { key: "subjectType", label: "Kind", card: "meta", width: "sm", cellClass: "text-ink-secondary" },
];
const SHORT_COLUMNS: DataTableColumn[] = [
  { key: "unitNumber", label: "Number", card: "title", cellClass: "font-medium text-ink", width: "sm" },
  { key: "shortBy", label: "Missing", card: "sentence", numeric: true },
  { key: "lastCheckedAt", label: "Last checked", card: "meta", width: "md" },
];
const LOW_COLUMNS: DataTableColumn[] = [
  { key: "partNumber", label: "Part", card: "title" },
  { key: "quantityOnHand", label: "On hand", card: "sentence", numeric: true },
  { key: "reorderQuantity", label: "Order", card: "meta", numeric: true },
];

/** "12 days left" / "3 days overdue", counted in the org's day rather than the server's (D-DS18). */
function annualDue(row: AnnualDueDto): { text: string; tone: string } {
  const e = inspectionExpiry(row.expiresOn, today.value);
  const days = e.daysRemaining ?? row.daysRemaining;
  const n = Math.abs(days);
  const unit = n === 1 ? "day" : "days";
  if (days < 0) return { text: `${formatDate(row.expiresOn)} · ${n} ${unit} overdue`, tone: "font-medium text-danger-700" };
  if (days === 0) return { text: `${formatDate(row.expiresOn)} · today`, tone: "font-medium text-warning-700" };
  return { text: `${formatDate(row.expiresOn)} · ${n} ${unit} left`, tone: days <= 7 ? "font-medium text-warning-700" : "" };
}

const unitPath = (u: UnitKitDto) => `/shop/units/${u.kind === "tractor" ? "tractor" : "trailer"}/${u.unitId}`;
const asRows = <T,>(rows: T[]) => rows.slice(0, PREVIEW_ROWS) as unknown as Record<string, unknown>[];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What needs doing in the shop, most urgent first.">
      <template v-if="actions.length" #actions>
        <WalkActions :actions="actions" />
      </template>
    </PageHeader>

    <AppCallout v-if="quiet" data-test="quiet-day">
      Nothing waits on the shop today. No repair is due, nothing is in for repair, every annual inspection
      is in date, and nothing is missing or running low.
    </AppCallout>

    <RoadsideRepairsDueSection hide-when-empty />

    <ShopWorklistSection
      title="Found on an inspection, not fixed"
      test-id="defects"
      :columns="DEFECT_COLUMNS"
      :rows="asRows(defects)"
      row-key="id"
      :loading="defectsQ.isLoading.value"
      :error="defectsQ.isError.value ? 'Could not load the open defects.' : null"
      :all-to="defectsOpen ? '/shop/defects' : null"
      :all-label="allLabel(defects.length, 'open defects')"
      :clickable="defectsOpen"
      empty-text="No open defects."
      @row-click="router.push('/shop/defects')"
      @retry="defectsQ.refetch()"
    >
      <template #cell-unitNumber="{ value }">{{ value ?? "—" }}</template>
      <template #cell-what="{ row }">{{ (row as ShopDefectDto).name ?? (row as ShopDefectDto).description ?? "—" }}</template>
      <template #cell-detectedAt="{ value }">{{ value ? formatDate(value) : "—" }}</template>
    </ShopWorklistSection>

    <ShopWorklistSection
      title="In the shop now"
      test-id="work-orders"
      :columns="ORDER_COLUMNS"
      :rows="asRows(orders)"
      row-key="id"
      :loading="ordersQ.isLoading.value"
      :error="ordersQ.isError.value ? 'Could not load the open work orders.' : null"
      :all-to="ordersOpen ? '/shop/work-orders' : null"
      :all-label="allLabel(orders.length, 'open work orders')"
      :clickable="ordersOpen"
      empty-text="No open work orders."
      @row-click="router.push('/shop/work-orders')"
      @retry="ordersQ.refetch()"
    >
      <template #cell-unitNumber="{ value }">{{ value ?? "—" }}</template>
      <template #cell-work="{ row }">
        {{ (row as ShopWorkOrderDto).description ?? (row as ShopWorkOrderDto).referenceNumber ?? "—" }}
      </template>
      <template #cell-openedAt="{ value }">{{ value ? formatDate(value) : "—" }}</template>
    </ShopWorklistSection>

    <ShopWorklistSection
      title="Annual inspection due"
      test-id="annual-due"
      :columns="ANNUAL_COLUMNS"
      :rows="asRows(annual)"
      row-key="unitId"
      :loading="annualQ.isLoading.value"
      :error="annualQ.isError.value ? 'Could not load the annual inspections due.' : null"
      :all-to="inspectionsOpen ? '/shop/inspections' : null"
      :all-label="allLabel(annual.length, 'due')"
      :clickable="inspectionsOpen"
      empty-text="No annual inspection is due."
      @row-click="(row) => router.push({ path: '/shop/inspections', query: { search: (row as unknown as AnnualDueDto).unitNumber } })"
      @retry="annualQ.refetch()"
    >
      <template #cell-due="{ row }">
        <span :class="annualDue(row as unknown as AnnualDueDto).tone" data-test="annual-due-when">{{ annualDue(row as unknown as AnnualDueDto).text }}</span>
      </template>
      <template #cell-subjectType="{ value }">{{ value === "tractor" ? "Truck" : "Trailer" }}</template>
    </ShopWorklistSection>

    <ShopWorklistSection
      title="Missing equipment"
      test-id="missing-equipment"
      :columns="SHORT_COLUMNS"
      :rows="asRows(shortUnits)"
      row-key="unitId"
      :loading="shortQ.isLoading.value"
      :error="shortQ.isError.value ? 'Could not load the fleet.' : null"
      :all-to="unitsOpen ? '/shop/units?show=short' : null"
      :all-label="allLabel(shortTotal, 'trucks and trailers')"
      :clickable="unitsOpen"
      empty-text="No checked truck or trailer is missing anything."
      @row-click="(row) => router.push(unitPath(row as unknown as UnitKitDto))"
      @retry="shortQ.refetch()"
    >
      <!-- The card's sentence (contract §9 rule 3), so it reads as one: a bare "2" said nothing on a phone. -->
      <template #cell-shortBy="{ value }"><span class="font-semibold text-danger-700">{{ value }} {{ countLabelFor(value, "items") }} missing</span></template>
      <template #cell-lastCheckedAt="{ value }">{{ value ? formatDate(value) : "Never" }}</template>
    </ShopWorklistSection>

    <ShopWorklistSection
      title="Running low"
      test-id="running-low"
      :columns="LOW_COLUMNS"
      :rows="asRows(low)"
      :row-key="(r: Record<string, unknown>) => `${r.partId}:${r.locationId}`"
      :loading="lowQ.isLoading.value"
      :error="lowQ.isError.value ? 'Could not load the reorder list.' : null"
      :all-to="partsOpen ? '/shop/inventory?stock=low' : null"
      :all-label="allLabel(lowTotal, 'shelves')"
      :clickable="partsOpen"
      empty-text="Nothing is running low."
      @row-click="(row) => router.push(`/shop/inventory/${row.partId}`)"
      @retry="lowQ.refetch()"
    >
      <template #cell-partNumber="{ row }">
        <span class="font-mono text-xs text-ink">{{ (row as StockLineDto).partNumber }}</span>
        <span class="ml-2 text-sm text-ink-secondary">{{ (row as StockLineDto).partDescription }}</span>
      </template>
      <template #cell-quantityOnHand="{ row }"><StockLevelCell :line="row as StockLineDto" /></template>
    </ShopWorklistSection>

    <!-- R9: draws nothing while nothing is open. -->
    <OpenCountsList title="Checks left open" />

    <!-- The one money figure: the door to the repair-bills page, under the work rather than over it. -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Repair bills"
        :value="!spendQ.data.value || spendQ.data.value.pendingSources ? '—' : fmtMoney(spendQ.data.value.totalAmount)"
        :sub="spendQ.data.value?.pendingSources ?? 'Booked in the last full month'"
        :icon="GaugeIcon"
        tone="success"
        :loading="spendQ.isLoading.value"
        :error="spendQ.isError.value ? 'Could not load the repair bills.' : null"
        :retrying="spendQ.isFetching.value"
        :to="opens('/shop/repair-spend') ? '/shop/repair-spend' : undefined"
        @retry="spendQ.refetch()"
      />
    </div>

    <WalkActions v-if="actions.length" :actions="actions" bar />
    <StartCountDrawer :open="counting" @close="counting = false" />
  </div>
</template>
