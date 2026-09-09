<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppCard as BaseCard, AppIcon } from "@silvicom/ui";
import { CubeIcon, ExclamationTriangleIcon, PlusIcon, ArrowsRightLeftIcon, GaugeIcon, ChecklistIcon } from "@silvicom/ui/icons";
import PageHeader from "@/components/ui/PageHeader.vue";
import StatCard from "@/components/ui/StatCard.vue";
import { lastFullMonth } from "@/lib/dateWindow";
import { useMaintenanceSpendQuery } from "@/features/maintenance/useMaintenanceSpend";
import { useLowStockQuery, useMovementsQuery, usePartsQuery } from "@/features/inventory/useInventory";
import StartCountDrawer from "@/features/inventory/StartCountDrawer.vue";
import { useSessionStore } from "@/stores/session";

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
 * ── WHAT IS DELIBERATELY NOT HERE YET ─────────────────────────────────────────────────────────
 * **No Scan button.** I4's step text puts one here, and `/shop/scan` is built at I6 — a button
 * pointing at a route that does not exist resolves to the catch-all, so shipping it now would put a
 * 404 behind the most prominent control on the page. It arrives with the screen it opens.
 *
 * **No kit-shortfall card.** Assets and units are I7–I9; the step text already says hidden until
 * then, and a tile reading "0 shortfalls" against a fleet nobody has recorded a kit for would be a
 * measurement of nothing.
 *
 * ── AND THE REPAIR-SPEND CARD COUNTS LINES RATHER THAN DOLLARS ────────────────────────────────
 * `GET /api/maintenance/spend` answers with a PAGE of entries and a row count; there is no sum in
 * the response. Adding the dollars up from the page would report a total that stops at fifty rows
 * and would be believed — the exact defect the 2026-09-09 review found in `/low-stock` — so the
 * card counts what the ledger holds for the window and the page behind it carries the amounts.
 * A sum belongs in that endpoint, and that is an API change, not this web-only step.
 */

const window_ = lastFullMonth();
const spendFilter = ref({ from: window_.from, to: window_.to, page: 1 });
const { data: spend, isLoading: spendLoading } = useMaintenanceSpendQuery(spendFilter);

const { data: lowStock, isLoading: lowStockLoading } = useLowStockQuery();

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
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What the shop holds, what needs ordering, and what moved today.">
      <template v-if="session.can('maintenance')" #actions>
        <!-- The one thing on this page that starts a task rather than opening a list. Scan joins it
             at I6; until then a count is picked from a location rather than arrived at by camera. -->
        <BaseButton variant="primary" @click="counting = true">
          <AppIcon :icon="ChecklistIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Count a shelf
        </BaseButton>
      </template>
    </PageHeader>

    <BaseCard v-if="firstRun" padding="md">
      <div class="flex flex-col items-start gap-3">
        <span class="inline-flex size-10 items-center justify-center rounded-surface bg-brand-50 text-brand-600">
          <AppIcon :icon="CubeIcon" class="size-5" aria-hidden="true" />
        </span>
        <div>
          <p class="text-base font-semibold text-ink">No parts on the shelves yet</p>
          <p class="mt-1 max-w-2xl text-sm text-ink-tertiary">
            Add the first part and the shop starts keeping count of it. Receiving, issuing and
            counting arrive with the shelf screens; printed shelf labels and the FleetPal catalogue
            pull come after them.
          </p>
        </div>
        <BaseButton variant="primary" :to="{ path: '/shop/inventory', query: { new: '1' } }">
          <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Add a part
        </BaseButton>
      </div>
    </BaseCard>

    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        label="Low stock"
        :value="lowStock?.total ?? 0"
        :muted="(lowStock?.total ?? 0) === 0"
        :sub="(lowStock?.total ?? 0) === 0 ? 'Nothing at its reorder point' : 'Shelves at or below their reorder point'"
        :icon="ExclamationTriangleIcon"
        tone="text-warning-600 bg-warning-50"
        :loading="lowStockLoading"
        to="/shop/inventory?stock=low"
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
        :value="spend?.pendingSources ? '—' : (spend?.total ?? 0)"
        :sub="spend?.pendingSources ?? 'Ledger lines in the last full month'"
        :icon="GaugeIcon"
        tone="text-ink-muted bg-surface-subtle"
        :loading="spendLoading"
        to="/shop/repair-spend"
      />
    </div>
    <StartCountDrawer :open="counting" @close="counting = false" />
  </div>
</template>
