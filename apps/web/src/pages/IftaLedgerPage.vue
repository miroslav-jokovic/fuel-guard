<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { STATE_NAMES } from "@fuelguard/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import StatCard from "@/components/ui/StatCard.vue";
import {
  parseQuarterKey, quarterKey, quarterLabel, selectableQuarters, useIftaPeriodQuery,
  type IftaQuarter,
} from "@/features/ifta/useIftaPeriod";
import { usd, usd3, gal, pct1 } from "@/features/reconcile/format";

/**
 * The IFTA jurisdiction ledger — what the carrier owes each jurisdiction against what it has paid.
 *
 * ── WHY THIS IS A PAGE AND NOT A NINTH TAB ON FUEL SPEND ────────────────────────────────────────
 * Fuel Spend answers "what did fuel cost and why", for a fleet manager, weekly. This answers "what do
 * we owe whom", for a controller, quarterly. They share a tax table and nothing else, and a quarterly
 * tax filing behind a tab called Fuel Spend is a filing nobody finds.
 *
 * ── THE HEALTH LINE IS ABOVE THE MONEY, NOT BELOW IT ────────────────────────────────────────────
 * Liability scales linearly with fleet MPG, so a period whose MPG is impossible produces a table of
 * confident, wrong dollar figures that look exactly like right ones. On 2026 Q2 that MPG was 10.5 and
 * the cause was a 31-day hole in the fuel feed worth about $1.03M. So the tie-out and the MPG verdict
 * render ABOVE the jurisdiction table and the table is dimmed behind them — the same argument F1 made
 * for putting a coverage figure beside a headline rather than in a caution strip below the fold.
 */
const route = useRoute();
const router = useRouter();

/**
 * The quarter lives in the URL, because a filing is something one person prepares and another checks.
 * A page whose period dies on refresh cannot be sent to anybody.
 */
const NOW = new Date();
const quarters = selectableQuarters(NOW);
const quarter = computed<IftaQuarter>(() => parseQuarterKey(route.query.q as string) ?? quarters[0]!);
const quarterOptions = quarters.map((q) => ({ value: quarterKey(q), label: quarterLabel(q) }));
const selectedKey = computed<string>({
  get: () => quarterKey(quarter.value),
  set: (v) => void router.replace({ query: { ...route.query, q: v } }),
});

const { data, isLoading, isError, error } = useIftaPeriodQuery(quarter);
const position = computed(() => data.value?.position ?? null);
const tieOut = computed(() => data.value?.tieOut ?? null);
const summary = computed(() => data.value?.summary ?? null);

/**
 * One line saying whether the numbers below can be trusted, in the order a reader needs them.
 *
 * The MPG verdict comes first because every liability derives from it. The tie-out's concern comes
 * second and only when it adds something the MPG line did not already say — two paragraphs restating
 * one problem is how a warning stops being read.
 */
const health = computed(() => {
  const p = position.value;
  const t = tieOut.value;
  if (!p || !t) return null;
  if (data.value?.neverFetched) {
    return {
      tone: "caution" as const,
      lead: "No jurisdiction miles have been pulled for this quarter yet, so nothing here can be filed on.",
      detail: "The IFTA sync runs daily and reaches back three months; a quarter older than that needs a backfill.",
    };
  }
  if (p.mpg.verdict !== "plausible") {
    return { tone: "danger" as const, lead: p.mpg.concern ?? "", detail: t.verdict === "fuel_missing" ? t.concern : null };
  }
  if (t.verdict !== "agree" && t.verdict !== "odometer_short") {
    return { tone: "caution" as const, lead: t.concern ?? "", detail: null };
  }
  return null;
});

/** Samsara's own account of why ITS figures are short, in words rather than four integers. */
const samsaraNotes = computed(() => {
  const t = summary.value?.troubleshooting;
  if (!t) return [];
  const out: string[] = [];
  const n = (k: string) => Number(t[k] ?? 0);
  if (t.noPurchasesFound === true) out.push("Samsara found no fuel purchases of its own for this quarter.");
  if (n("unassignedFuelTypeVehicles") > 0) {
    out.push(
      `${n("unassignedFuelTypeVehicles")} vehicles have no fuel type set in Samsara, so it cannot attribute ` +
        "purchases to them — which is why its own fuel figure is not used here. The credit side below is ours.",
    );
  }
  if (n("unassignedVehiclePurchases") > 0) out.push(`${n("unassignedVehiclePurchases")} of Samsara's purchases are not attached to a vehicle.`);
  if (n("unassignedFuelTypePurchases") > 0) out.push(`${n("unassignedFuelTypePurchases")} of Samsara's purchases have no fuel type.`);
  return out;
});

const rows = computed(() =>
  (position.value?.jurisdictions ?? []).map((j) => ({
    id: j.jurisdiction,
    jurisdiction: STATE_NAMES[j.jurisdiction] ?? j.jurisdiction,
    taxableMiles: j.taxableMiles.toLocaleString("en-US"),
    consumed: j.gallonsConsumed == null ? "—" : gal(j.gallonsConsumed),
    rate: j.ratePerGal == null ? "—" : usd3(j.ratePerGal),
    liability: j.liability == null ? "—" : usd(j.liability),
    purchased: gal(j.gallonsPurchased),
    credit: j.credit == null ? "—" : usd(j.credit),
    net: j.net == null ? "not priced" : usd(j.net),
    surcharge: j.surcharge == null || j.surcharge === 0 ? "—" : usd(j.surcharge),
  })),
);
const cols: DataTableColumn[] = [
  { key: "jurisdiction", label: "Jurisdiction", width: "lg", cellClass: "text-ink-secondary" },
  { key: "taxableMiles", label: "Taxable miles", numeric: true, width: "sm" },
  { key: "consumed", label: "Gallons burned", numeric: true, width: "sm" },
  { key: "rate", label: "Rate / gal", numeric: true, width: "sm" },
  { key: "liability", label: "Owed", numeric: true, width: "sm" },
  { key: "purchased", label: "Gallons bought", numeric: true, width: "sm" },
  { key: "credit", label: "Paid at the pump", numeric: true, width: "sm" },
  { key: "net", label: "Net", numeric: true, width: "sm" },
  { key: "surcharge", label: "Surcharge", numeric: true, width: "sm" },
];
const barCount = computed(() => position.value?.jurisdictions.length ?? 0);
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What each jurisdiction is owed for the miles driven there, against the fuel tax already paid at its pumps." />

    <FilterBar :count="barCount" count-label="jurisdictions">
      <template #filters>
        <FilterSelect v-model="selectedKey" :options="quarterOptions" label="Quarter" />
      </template>
    </FilterBar>

    <p v-if="isLoading" class="text-sm text-ink-muted">Loading…</p>
    <p v-else-if="isError" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
      Couldn't load this quarter: {{ error instanceof Error ? error.message : "unknown error" }}
    </p>

    <template v-else-if="position && summary">
      <!-- Above the money, deliberately. Every figure in the table derives from the fleet MPG, so a
           period whose MPG is impossible produces confident wrong dollars that look exactly like
           right ones — which is precisely what 2026 Q2 did at 10.5 mpg. -->
      <div
        v-if="health"
        class="rounded-surface px-4 py-3 ring-1"
        :class="health.tone === 'danger'
          ? 'bg-danger-50 text-danger-700 ring-danger-100'
          : 'bg-caution-50 text-caution-800 ring-caution-100'"
      >
        <p class="text-sm font-semibold">{{ health.lead }}</p>
        <p v-if="health.detail" class="mt-1 text-sm">{{ health.detail }}</p>
      </div>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Owed" :value="usd(position.liability)" sub="for the miles driven" />
        <StatCard label="Paid at the pump" :value="usd(position.credit)" sub="on fuel bought" />
        <StatCard
          label="Net"
          :value="usd(position.net)"
          :sub="position.net >= 0 ? 'still owed across all jurisdictions' : 'refundable across all jurisdictions'"
          :sub-tone="position.net > 0 ? 'text-danger-700' : undefined"
        />
        <StatCard
          label="Fleet MPG used"
          :value="position.mpg.fleetMpg == null ? '—' : position.mpg.fleetMpg.toFixed(2)"
          :sub="`${gal(position.mpg.totalGallons)} gal over ${position.mpg.totalMiles.toLocaleString('en-US')} mi`"
          :sub-tone="position.mpg.verdict === 'plausible' ? undefined : 'text-danger-700'"
        />
      </div>

      <!-- Every figure above is measured over something narrower than "this quarter", and each one
           says what. A dollar figure whose denominator is not on screen beside it is a defect. -->
      <p class="text-xs text-ink-tertiary">
        {{ summary.vehicles }} trucks ·
        <template v-if="position.pricedMileShare != null">
          {{ pct1(position.pricedMileShare) }} of miles in jurisdictions this product can price<template v-if="position.unpriced.length">
            ({{ position.unpriced.join(", ") }} cannot be)</template> ·
        </template>
        {{ summary.monthsFetched }} of 3 months pulled from Samsara<template v-if="summary.anyProvisional">, at least one still provisional</template>
        <template v-if="summary.maxUnmapped > 0"> · {{ summary.maxUnmapped }} vehicle(s) Samsara reported that we could not map</template>
        <template v-if="position.surcharge > 0">
          · {{ usd(position.surcharge) }} of return-billed surcharge, which is not creditable and is not in the net above
        </template>
      </p>

      <p v-for="(note, i) in samsaraNotes" :key="i" class="text-xs text-ink-tertiary">{{ note }}</p>

      <BaseCard padding="none">
        <DataTable
          :columns="cols"
          :rows="rows"
          row-key="id"
          empty-text="No miles or fuel recorded for this quarter."
        />
      </BaseCard>

      <!-- The filing workflow is not built (Q-IF5). Said outright rather than behind a disclosure: the
           first version hid the second sentence behind a "why can't I file from this?" toggle, which
           `lint:ui-adoption` refused as a raw page button — correctly, and the honest fix was to stop
           making a reader click for the caveat rather than to reach for a shared control to hide it. -->
      <p class="text-xs text-ink-tertiary">
        This is a working view, not a filed return — nothing here is submitted to a jurisdiction, and a
        quarter shown today may read differently tomorrow while Samsara is still restating it. Filing
        needs a frozen snapshot of what was asserted and to whom, and that is deliberately not built
        until somebody says they want to file from here rather than manage from here.
      </p>
    </template>
  </div>
</template>
