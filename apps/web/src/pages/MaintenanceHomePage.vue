<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppCallout, AppIcon } from "@silvicom/ui";
import {
  ArrowsRightLeftIcon,
  ChecklistIcon,
  ExclamationTriangleIcon,
  GaugeIcon,
  PlusIcon,
  ScanIcon,
  TruckIcon,
} from "@silvicom/ui/icons";
import PageHeader from "@/components/ui/PageHeader.vue";
import StatCard from "@/components/ui/StatCard.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { lastFullMonth } from "@/lib/dateWindow";
import { fmtMoney } from "@/lib/chartTheme";
import { useMaintenanceSpendQuery } from "@/features/maintenance/useMaintenanceSpend";
import { useLowStockQuery, useMovementsQuery, usePartsQuery } from "@/features/inventory/useInventory";
import { useUnitsQuery } from "@/features/inventory/useUnits";
import StartCountDrawer from "@/features/inventory/StartCountDrawer.vue";
import StockLevelCell from "@/features/inventory/StockLevelCell.vue";
import { BADGE_BASE, kitStatusBadge, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import type { StockLineDto, UnitKitDto } from "@silvicom/shared";

/**
 * The shop's home (INVENTORY-PLAN.md step I4).
 *
 * ── `/shop` USED TO BE THE REPAIR-SPEND LEDGER ────────────────────────────────────────────────
 * It was the only thing the section held while maintenance was a ledger family. The module owns
 * four tables of its own since I2, so the address a technician types is the section's front door
 * and the ledger is one card on it, at `/shop/repair-spend`. The surface KEY stayed
 * `maintenance.repair-spend` through that relabel, which is a permission decision rather than a
 * naming one — `packages/shared/src/surfaces.ts` carries the measurement.
 *
 * ── IT IS A TODAY PAGE, NOT A ROW OF COUNTERS (2026-09-10) ────────────────────────────────────
 * Four tiles and, under them, the two lists somebody acts on: what to order and which units are
 * short of their kit. The page shipped as three tiles above an empty screen — the 2026-09-10
 * critique measured it at sixty percent blank at both widths — while Dashboard, Recruitment and
 * Compliance all put a working surface under their tiles. Both lists come from endpoints that
 * answer WHOLE (`/low-stock` and `/units` are deliberately unpaginated), so the preview below is an
 * honest head of a complete answer, and the link under each says how many more there are.
 *
 * The kit-shortfall tile was withheld "until I7–I9" when this page was built; I8 and I9 have
 * shipped, `UnitsPage.vue` already reads `?kit=short` as this tile's link, and a fleet with no kit
 * recorded reads "Every unit has its kit", which is true and not a measurement of nothing.
 *
 * "Moved today" has no page of its own to open — the ledger is per part — so the tile is a count
 * and nothing else. A link to nowhere would be worse than none.
 *
 * ── THE REPAIR-SPEND CARD SHOWS DOLLARS, AND THE SUM IS THE ENDPOINT'S ────────────────────────
 * It counted LINES until 2026-09-09, because `GET /api/maintenance/spend` answered with a page and
 * a row count and no sum — and adding the page up here would have reported a total that stops at
 * fifty rows and would be believed, which is the exact defect the review found in `/low-stock`.
 * I4 recorded that as owed; the endpoint now returns `totalAmount` over the whole window, computed
 * by the ledger's own `summarizeByCategory`. **`entries` is still one page and must never be summed
 * here** — the figure on this card comes from the endpoint or it does not appear.
 */

/** How much of each complete list the home shows before handing over to the page that owns it. */
const PREVIEW_ROWS = 8;

const window_ = lastFullMonth();
const spendFilter = ref({ from: window_.from, to: window_.to, page: 1 });
const { data: spend, isLoading: spendLoading } = useMaintenanceSpendQuery(spendFilter);

const lowStock = useLowStockQuery();
const lowTotal = computed(() => lowStock.data.value?.total ?? 0);
const lowPreview = computed<StockLineDto[]>(() => (lowStock.data.value?.lines ?? []).slice(0, PREVIEW_ROWS));

const shortFilter = ref({ shortOnly: true });
const shortUnits = useUnitsQuery(shortFilter);
const shortTotal = computed(() => shortUnits.data.value?.total ?? 0);
const shortPreview = computed<UnitKitDto[]>(() => (shortUnits.data.value?.units ?? []).slice(0, PREVIEW_ROWS));

/**
 * Midnight local, as an instant.
 *
 * `occurred_at` is the CLIENT's clock (the phone that counted a shelf in a dead zone), so "today"
 * is the shop's day and not UTC's — a shift that starts at 06:00 Central would otherwise see its
 * first five hours fall into yesterday for anyone reading before 19:00.
 */
const startOfToday = computed(() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
});
const todayFilter = computed(() => ({ since: startOfToday.value, page: 1 }));
const { data: today, isLoading: todayLoading } = useMovementsQuery(todayFilter);

const session = useSessionStore();
const counting = ref(false);

const catalogueFilter = ref({ page: 1 });
const { data: catalogue, isLoading: catalogueLoading } = usePartsQuery(catalogueFilter);

/** Nothing in the catalogue means nothing anywhere else either — every quantity is a quantity OF a part. */
const firstRun = computed(() => !catalogueLoading.value && (catalogue.value?.total ?? 0) === 0);

/**
 * Four columns, not the low-stock page's six: the preview sits in half the width, and a fifth
 * column pushed "Order" off the card in a real render. The shelf is on the page the link opens.
 */
const LOW_COLUMNS: DataTableColumn[] = [
  { key: "partNumber", label: "Part number", cellClass: "font-mono text-xs text-ink" },
  { key: "partDescription", label: "Description" },
  { key: "quantityOnHand", label: "On hand", numeric: true },
  { key: "reorderQuantity", label: "Order", numeric: true },
];

const SHORT_COLUMNS: DataTableColumn[] = [
  { key: "unitNumber", label: "Unit", cellClass: "font-medium text-ink", width: "sm" },
  { key: "shortBy", label: "Missing", numeric: true },
  { key: "state", label: "Status", width: "sm" },
];

const unitPath = (u: UnitKitDto) =>
  `/shop/units/${u.kind === "tractor" ? "tractor" : "trailer"}/${u.unitId}`;
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What the shop holds, what needs ordering, and what moved today.">
      <template v-if="session.can('maintenance')" #actions>
        <!-- The two things on this page that start a task rather than opening a list.
             Scan leads: it is the verb of the job — a technician arrives at this screen holding a
             carton or standing at a bin, and every shelf verb is one trigger pull away behind it.
             A count is the deliberate, slower act, and it is picked from a location. -->
        <BaseButton variant="primary" to="/shop/scan">
          <AppIcon :icon="ScanIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Scan
        </BaseButton>
        <BaseButton @click="counting = true">
          <AppIcon :icon="ChecklistIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Count a shelf
        </BaseButton>
      </template>
    </PageHeader>

    <!-- A callout, not a hand-rolled card: it is a fact about the page that survives every action
         on it, and the product has a primitive for exactly that. -->
    <AppCallout v-if="firstRun" tone="brand">
      No parts on the shelves yet. Add the first part and the shop starts keeping count of it.
      <template #actions>
        <BaseButton variant="primary" size="sm" :to="{ path: '/shop/inventory', query: { new: '1' } }">
          <AppIcon :icon="PlusIcon" class="-ml-0.5 size-4" aria-hidden="true" /> Add a part
        </BaseButton>
      </template>
    </AppCallout>

    <template v-else>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Low stock"
          :value="lowTotal"
          :muted="lowTotal === 0"
          :sub="lowTotal === 0 ? 'Nothing at its reorder point' : 'Shelves at or below their reorder point'"
          :icon="ExclamationTriangleIcon"
          tone="text-warning-600 bg-warning-50"
          :loading="lowStock.isLoading.value"
          to="/shop/inventory?stock=low"
        />
        <StatCard
          label="Short of kit"
          :value="shortTotal"
          :muted="shortTotal === 0"
          :sub="shortTotal === 0 ? 'Every unit has its kit' : 'Trucks and trailers missing something'"
          :icon="TruckIcon"
          :tone="shortTotal > 0 ? 'text-danger-600 bg-danger-50' : 'text-ink-muted bg-surface-muted'"
          :loading="shortUnits.isLoading.value"
          to="/shop/units?kit=short"
        />
        <StatCard
          label="Moved today"
          :value="today?.total ?? 0"
          :muted="(today?.total ?? 0) === 0"
          sub="Ledger rows since midnight"
          :icon="ArrowsRightLeftIcon"
          tone="text-info-600 bg-info-50"
          :loading="todayLoading"
        />
        <!-- `pendingSources` is the API's own sentence about why the store is empty; the page it
             links to renders the same one. A zero here without it would be a mysterious zero. -->
        <StatCard
          label="Repair spend"
          :value="spend?.pendingSources ? '—' : fmtMoney(spend?.totalAmount ?? 0)"
          :sub="spend?.pendingSources ?? 'Booked in the last full month'"
          :icon="GaugeIcon"
          tone="text-success-600 bg-success-50"
          :loading="spendLoading"
          to="/shop/repair-spend"
        />
      </div>

      <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section class="space-y-3">
          <div class="flex items-center justify-between gap-4">
            <h2 class="text-sm font-semibold text-ink">To order</h2>
            <RouterLink
              v-if="lowTotal > PREVIEW_ROWS"
              to="/shop/inventory?stock=low"
              class="text-sm font-medium text-link hover:text-link-hover"
            >
              All {{ lowTotal }} shelves
            </RouterLink>
          </div>
          <DataTable
            :columns="LOW_COLUMNS"
            :rows="lowPreview"
            :row-key="(r: StockLineDto) => `${r.partId}:${r.locationId}`"
            :loading="lowStock.isLoading.value"
            :error="lowStock.isError.value ? 'Could not load the reorder list' : null"
            :row-class="() => 'cursor-pointer'"
            @row-click="(row) => $router.push(`/shop/inventory/${row.partId}`)"
            @retry="() => lowStock.refetch()"
          >
            <template #cell-quantityOnHand="{ row }">
              <StockLevelCell :line="row as StockLineDto" />
            </template>
            <template #empty>
              <p>Nothing to order. Every shelf with a reorder point is above it.</p>
            </template>
          </DataTable>
        </section>

        <section class="space-y-3">
          <div class="flex items-center justify-between gap-4">
            <h2 class="text-sm font-semibold text-ink">Short of kit</h2>
            <RouterLink
              v-if="shortTotal > PREVIEW_ROWS"
              to="/shop/units?kit=short"
              class="text-sm font-medium text-link hover:text-link-hover"
            >
              All {{ shortTotal }} units
            </RouterLink>
          </div>
          <DataTable
            :columns="SHORT_COLUMNS"
            :rows="shortPreview"
            row-key="unitId"
            :loading="shortUnits.isLoading.value"
            :error="shortUnits.isError.value ? 'Could not load the fleet' : null"
            :row-class="() => 'cursor-pointer'"
            @row-click="(row) => $router.push(unitPath(row as unknown as UnitKitDto))"
            @retry="() => shortUnits.refetch()"
          >
            <template #cell-shortBy="{ value }">
              <span class="font-semibold text-danger-700">{{ value }}</span>
            </template>
            <template #cell-state="{ value }">
              <span v-if="kitStatusBadge(value)" :class="[BADGE_BASE, toneClass(kitStatusBadge(value)!.tone)]">
                {{ kitStatusBadge(value)!.label }}
              </span>
              <span v-else class="text-ink-tertiary">—</span>
            </template>
            <template #empty>
              <p>Nothing is short. Every truck and trailer is carrying what its kit asks for.</p>
            </template>
          </DataTable>
        </section>
      </div>
    </template>

    <StartCountDrawer :open="counting" @close="counting = false" />
  </div>
</template>
