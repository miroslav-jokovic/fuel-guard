<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { AppButton as BaseButton } from "@silvicom/ui";
import { STATE_NAMES, FUEL_REPORT_TRUCK_FIGURES_NOTE, type FuelNetwork } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import StatCard from "@/components/ui/StatCard.vue";
import ExplainerPanel from "@/components/ui/ExplainerPanel.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import ReportExportButton from "@/features/reconcile/ReportExportButton.vue";
import FuelCostDaysTable from "@/features/reconcile/FuelCostDaysTable.vue";
import FuelOpportunitiesStrip from "@/features/reconcile/FuelOpportunitiesStrip.vue";
import { useFuelOpportunitiesQuery } from "@/features/reconcile/useFuelOpportunities";
import { fuelReportQuery, useFuelCostFilters, useFuelReportQuery } from "@/features/reconcile/useFuelReport";
import { useSpendFreshnessQuery } from "@/features/reconcile/useSpendFreshness";
import {
  brandList, comparingLine, costCards, costDayRows, mpgCoverageLine, networkLine, reeferLine, spendChangeLine,
} from "@silvicom/shared";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useOpens } from "@/composables/useOpens";

/**
 * Fuel Costs — one report, no tabs (FS2; owner ruling R1, D-FSV1). Where can we save money on fuel:
 * what it cost, against the same number of days before, where it was bought, and how far it went.
 *
 * ── WHAT LEFT, AND WHERE IT WENT ─────────────────────────────────────────────────────────────────
 * · **Spend & trend** is this page: SQL sums per day (`fuel_report_days`, 0405), shared code makes
 *   the ratios, the API composes measured miles and MPG beside them (D-FSV4/5). Its implied miles
 *   (`gallons × MPG`) and grain picker went with it; the bridge cards and the idle-cost card wait for
 *   IE3's savings strip.
 * · **Statements** went (D-FSV1). Production has never held a saved statement; a vendor bill is
 *   checked and kept on Pilot invoices (FS3), which this page links to.
 * · **Buy discipline** is its own page, `/fuel-buy-discipline`, opened from here (Q-FSV12): its fill
 *   sequence, its graded targets and its two tables are a policy check, not a cost report, and the
 *   report keeps one table (finance-reader rule).
 *
 * ── WHAT IT LEADS WITH ───────────────────────────────────────────────────────────────────────────
 * Spend and the sentence splitting its change into gallons and price (`spendChangeLine`), beside the open
 * findings ranked by dollars; the other figures follow as detail. The 2026-10-03 design verdict (move 2)
 * found eight cards of equal weight with no next action: a reader had to work out which figure mattered
 * and where to go from it. The cards keep every figure and comparison they had (D-FSV3) — they are
 * demoted, not removed — and the PDF's spend band prints the same sentence.
 *
 * ── THE URL IS THE STATE ─────────────────────────────────────────────────────────────────────────
 * Every filter is a query parameter, so a link opens on what its sender was looking at. Old links
 * carrying `?tab=` or `?grain=` still open here; the parameters are ignored.
 */

const f = useFuelCostFilters();
const opens = useOpens();
const { data: report, isLoading, isError, error, isFetching } = useFuelReportQuery(f.params);

/** How current the daily fuel roll-up is — MPG's gallons come from it (`fleetMpg.ts`). */
/** The open findings waiting for review in these dates and trucks — the strip under the cards (FS-STRIP). */
const opportunities = useFuelOpportunitiesQuery(computed(() => ({ from: f.from.value, to: f.to.value, vehicleIds: f.vehicleIds.value })));

const freshness = useSpendFreshnessQuery(computed(() => ({ from: f.from.value, to: f.to.value, vehicleIds: f.vehicleIds.value })));

// ── the filter menus ────────────────────────────────────────────────────────────────────────────
const { data: vehicles } = useVehiclesQuery();
const truckOptions = computed(() => (vehicles.value ?? []).map((v) => ({ value: v.id, label: v.unit_number })));
/**
 * States and locations come from the places this range's fills were bought (`fuel_report_sites`), so
 * a menu never offers a choice that selects nothing. A selected value the range no longer holds is
 * kept in the menu, or the reader could not see — or clear — what is filtering the page.
 */
const sites = computed(() => report.value?.sites ?? []);
const stateOptions = computed(() => {
  const codes = new Set([...sites.value.map((s) => s.state).filter((s): s is string => s != null), ...f.states.value]);
  return [...codes].sort().map((c) => ({ value: c, label: STATE_NAMES[c] ?? c }));
});
const siteOptions = computed(() => {
  const known = sites.value
    .filter((s) => s.stationId != null)
    .map((s) => ({ value: s.stationId!, label: [s.site, s.city, s.state].filter(Boolean).join(" · ") }));
  const ids = new Set(known.map((o) => o.value));
  return [...known, ...f.siteIds.value.filter((id) => !ids.has(id)).map((id) => ({ value: id, label: "A location not in this range" }))];
});
const networkOptions = computed<{ value: FuelNetwork; label: string }[]>(() => [
  { value: "in", label: `In network (${brandList(report.value?.inNetworkBrands ?? ["pilot", "flying_j"])})` },
  { value: "out", label: "Out of network" },
  { value: "unknown", label: "Station not identified" },
]);
const networkModel = computed<string[]>({
  get: () => f.networks.value,
  set: (v) => { f.networks.value = v as FuelNetwork[]; },
});

// ── what the report says ────────────────────────────────────────────────────────────────────────
const cards = computed(() => (report.value ? costCards(report.value) : []));
const spendCard = computed(() => cards.value.find((c) => c.key === "spend") ?? null);
const figureCards = computed(() => cards.value.filter((c) => c.key !== "spend"));
const change = computed(() => (report.value ? spendChangeLine(report.value) : ""));
const rows = computed(() => (report.value ? costDayRows(report.value) : []));
const network = computed(() => (report.value ? networkLine(report.value) : null));
const reefer = computed(() => (report.value ? reeferLine(report.value.current) : null));
const truckFigures = computed(() => report.value?.current.efficiency != null);
const comparing = computed(() => (report.value ? comparingLine(report.value) : ""));
/** How much of the fuel the MPG speaks for (D-MPG4) — the sentence the PDF prints too. */
const mpgCoverage = computed(() => (report.value ? mpgCoverageLine(report.value) : null));
// The screen's own query string: the document is asked for with every filter the report was (Q-FSV14).
const exportQuery = computed(() => fuelReportQuery(f.params.value));
/**
 * Buy discipline opens on the days and trucks being read here — its header promises that shared context.
 * State, location and network are not parameters of its fill sequence, so they cannot travel; the link
 * says so when one is active instead of silently widening the view.
 */
const buyLink = computed(() => ({
  path: "/fuel-buy-discipline",
  query: { from: f.from.value, to: f.to.value, ...(f.vehicleIds.value.length ? { trucks: f.vehicleIds.value.join(",") } : {}) },
}));
const toneClass = (t: "good" | "bad" | null) => (t === "good" ? "text-success-700" : t === "bad" ? "text-danger-700" : undefined);
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What fuel cost, where it was bought, and how far it went — against the same number of days before." />

    <!-- A link with a backwards or future range was quietly corrected; say so (X4). -->
    <p
      v-if="f.windowNotice.value"
      class="rounded-surface bg-caution-50 px-4 py-2.5 text-sm text-caution-800 ring-1 ring-caution-100"
    >
      {{ f.windowNotice.value }}
    </p>
    <p
      v-if="freshness.data.value?.lead"
      :class="freshness.data.value.stale
        ? 'rounded-surface bg-caution-50 px-4 py-2.5 text-sm text-caution-800 ring-1 ring-caution-100'
        : 'text-xs text-ink-tertiary'"
    >
      {{ freshness.data.value.lead }}
    </p>

    <!-- No count until the report answers: a pending or failed read is not "0 days" (verdict E8). -->
    <FilterBar :count="report ? rows.length : null" count-label="days">
      <!-- In #filters: FilterBar has no default slot, and plain children are silently dropped. The two
           date v-models are safe because `useQueryState` coalesces their same-tick patches. -->
      <template #filters>
        <DateRangeFilter v-model:from="f.from.value" v-model:to="f.to.value" label="Dates" />
        <FilterSelect v-model="f.vehicleIds.value" :options="truckOptions" label="Trucks" multiple />
        <FilterSelect v-model="f.states.value" :options="stateOptions" label="State" multiple />
        <FilterSelect v-model="f.siteIds.value" :options="siteOptions" label="Location" multiple />
        <FilterSelect v-model="networkModel" :options="networkOptions" label="Network" multiple />
        <BaseButton v-if="f.active.value" variant="ghost" @click="f.reset()">Clear filters</BaseButton>
      </template>
      <template #actions>
        <ReportExportButton
          :query="exportQuery"
          :from="f.from.value"
          :to="f.to.value"
          :truck-count="f.vehicleIds.value.length"
          :station-filtered="f.stationFiltered.value"
        />
      </template>
    </FilterBar>

    <p v-if="isLoading" class="text-sm text-ink-muted">Loading…</p>
    <p v-else-if="isError" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
      Couldn't load the fuel report: {{ error instanceof Error ? error.message : "unknown error" }}
    </p>

    <template v-else-if="report">
      <!-- Spend and what to review, side by side so both are on the first screen (design verdict, move 2). -->
      <div class="grid gap-4 lg:grid-cols-5">
        <StatCard
          v-if="spendCard"
          class="lg:col-span-2 lg:self-start"
          size="hero"
          :label="spendCard.label"
          :value="spendCard.value"
          :value-title="spendCard.previous"
          :title="spendCard.term"
        >
          <template #sub>
            <span>
              <span class="block text-ink" data-testid="spend-change">{{ change }}</span>
              <span v-if="network" class="mt-1 block text-ink-tertiary">{{ network }}</span>
            </span>
          </template>
        </StatCard>
        <FuelOpportunitiesStrip
          class="lg:col-span-3"
          :rows="opportunities.data.value"
          :loading="opportunities.isLoading.value"
          :error="opportunities.isError.value"
          :from="f.from.value"
          :to="f.to.value"
          :vehicle-ids="f.vehicleIds.value"
          :can-open-inbox="opens('/findings')"
        />
      </div>

      <section class="space-y-3" aria-labelledby="fuel-costs-figures-heading">
        <h3 id="fuel-costs-figures-heading" class="text-sm font-semibold text-ink">The figures behind it</h3>
        <p class="text-xs text-ink-tertiary">{{ comparing }}. Tractor fuel only.</p>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          <StatCard
            v-for="c in figureCards"
            :key="c.key"
            :label="c.label"
            :value="c.value"
            :value-title="c.previous"
            :sub="c.sub"
            :sub-tone="toneClass(c.tone)"
            :title="c.term"
          />
        </div>
        <p v-if="!truckFigures" class="text-xs text-ink-tertiary">{{ FUEL_REPORT_TRUCK_FIGURES_NOTE }}</p>
        <p v-else-if="mpgCoverage" class="text-xs text-ink-tertiary">{{ mpgCoverage }}</p>
        <p v-if="reefer" class="text-xs text-ink-tertiary">{{ reefer }}</p>
      </section>

      <FuelCostDaysTable
        :rows="rows"
        :with-mpg="truckFigures"
        :loading="isFetching"
        :filename="`fuel-costs-${f.from.value}-to-${f.to.value}`"
      />

      <p class="text-sm text-ink-muted">
        Fuel carried out of a dearer state, and the fuel targets graded:
        <RouterLink v-if="opens('/fuel-buy-discipline')" :to="buyLink" class="text-link hover:text-link-hover">Buy discipline</RouterLink>
        <template v-else>Buy discipline</template>
        <template v-if="f.stationFiltered.value"> (it opens on every station: it can't narrow by state, location or network)</template>.
        A vendor bill is checked on
        <RouterLink v-if="opens('/fuel-invoices')" to="/fuel-invoices" class="text-link hover:text-link-hover">Pilot invoices</RouterLink>
        <template v-else>Pilot invoices</template>.
      </p>

      <ExplainerPanel summary="How these figures are worked out">
        <p>
          Spend, gallons and prices are every EFS fuel purchase in the range, on the day it was bought in the
          carrier's time zone. "In network" is {{ brandList(report.inNetworkBrands) }}, from Settings → Planned
          fueling; a fill whose station we couldn't identify is counted on its own, never on either side.
        </p>
        <p>
          Miles are the odometer distance Samsara reported for each truck that bought fuel, and MPG divides them
          by that fuel — a figure is left out, with the reason, when too little of the fuel has a measured
          distance behind it. A day's MPG is over that day and the six before it, because one day's purchases
          don't measure one day's driving. Cost per mile is the average price per gallon divided by MPG.
        </p>
        <p>
          "Paid vs Pilot quote" is what we paid minus Pilot's quoted price, on the fills Pilot's daily price
          report covered. Every card compares with the same number of days just before the range.
        </p>
      </ExplainerPanel>
    </template>
  </div>
</template>
