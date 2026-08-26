<script setup lang="ts">
import { computed, ref } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@fuelguard/ui";
import {
  analyzeCarriedFuel, rankStatesByFuelCost, policyDivergence, listStates, STATE_NAMES,
  type CarriedFuelFill, type FuelPolicy,
} from "@fuelguard/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import StatCard from "@/components/ui/StatCard.vue";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
import { downloadCsv } from "@/lib/csv";
import { usd, usd3, gal, pct1 } from "./format";

/**
 * Buy discipline — fuel bought in a dearer state and hauled into a cheaper one (F13b).
 *
 * ── WHY THIS TAB EXISTS AND THE COMPLIANCE TABS DO NOT ANSWER IT ─────────────────────────────────
 * The policy tabs ask "did you fuel somewhere you said you would not". This asks a question no rule
 * governs: whatever your policy, you bought 146 gallons in California at $6.62, drove to Arizona
 * where the same diesel was $5.18, and arrived with them still in the tank. The truck's NEXT fill is
 * the proof — it happened, so there is nothing to argue about. That is why F11's cheaper-station
 * recommendation was abandoned (constrain it to the road actually driven and 96% of the claimed
 * saving is stations the truck was never passing) and this was built instead.
 *
 * ── THE HEADLINE IS A FLOOR, AND SAYS SO EVERY TIME IT IS SHOWN ──────────────────────────────────
 * Half the pairs are scored from a tank level, which is a measurement; the other half from
 * `gallonsBought − miles / baselineMpg`, which is a lower bound and understates roughly fivefold
 * against the measurement where both exist. A total mixing them is a floor. Calling it "the cost"
 * would be the same overreach as a partial numerator over a full denominator (B3, L14).
 */
const props = defineProps<{
  /** Every fill the window needs INCLUDING the 14-day lookback — see `useBuyFills`. */
  fills: CarriedFuelFill[];
  policy: FuelPolicy;
  loading?: boolean;
}>();

const report = computed(() => analyzeCarriedFuel(props.fills));

/**
 * Why the pairs that produced nothing produced nothing.
 *
 * "1,377 findings from 5,518 pairs" reads as three quarters of the data missing, and it is not: the
 * fleet stayed in one state on 544 legs and drove from cheaper fuel to dearer on 2,565, which is the
 * direction the policy wants. Nine pairs of 5,518 could not be evaluated at all. Stating that is the
 * difference between a coverage caveat and a coverage panic.
 */
const coverage = computed(() => {
  const r = report.value;
  return {
    pairs: r.pairs,
    findings: r.findings.length,
    sameState: r.sameState,
    towardDearer: r.towardDearer,
    blind: r.noBasis + r.unpriceable,
    blindShare: r.pairs > 0 ? (r.noBasis + r.unpriceable) / r.pairs : null,
  };
});

/**
 * The sentence this whole feature is for.
 *
 * `fillPolicy.ts` rule 4 — min-drawdown — already buys just enough to reach the next cheaper station,
 * floored at the minimum purchase and capped at `fill_cap_pct`. It runs only when `always_fill_full`
 * is FALSE, and this carrier has it true, so the cap is dormant and the discipline is switched off.
 * The number beside the switch is what makes that a decision rather than a preference.
 */
const drawdown = computed(() => {
  if (!props.policy.alwaysFillFull) return null;
  return report.value.excess > 0 ? report.value.excess : null;
});

// ── the states, ranked on the price of the FUEL ────────────────────────────────────────────────
const ranking = computed(() => rankStatesByFuelCost(props.fills.filter((f) => f.inWindow !== false)));
const divergence = computed(() => policyDivergence(ranking.value, props.policy.avoidStates));

const stateRows = computed(() =>
  ranking.value.states.filter((s) => !s.thin).slice(0, 8).map((s) => ({
    id: s.state,
    state: STATE_NAMES[s.state] ?? s.state,
    gallons: gal(s.gallons),
    pump: usd3(s.pumpPerGal),
    tax: usd3(s.taxPerGal),
    preTax: usd3(s.preTaxPerGal),
    vsFleet: `${s.vsFleetPerGal >= 0 ? "+" : ""}${s.vsFleetPerGal.toFixed(3)}`,
    listed: props.policy.avoidStates.includes(s.state) ? "avoided" : "—",
  })),
);
const stateCols: DataTableColumn[] = [
  { key: "state", label: "State", width: "lg", cellClass: "text-ink-secondary" },
  { key: "gallons", label: "Gallons", numeric: true, width: "sm" },
  { key: "pump", label: "Paid / gal", numeric: true, width: "sm" },
  { key: "tax", label: "State tax / gal", numeric: true, width: "sm" },
  { key: "preTax", label: "Fuel / gal", numeric: true, width: "sm" },
  { key: "vsFleet", label: "vs fleet", numeric: true, width: "sm" },
  { key: "listed", label: "Policy", width: "sm", cellClass: "text-ink-tertiary" },
];

// ── every leg ──────────────────────────────────────────────────────────────────────────────────
const rows = computed(() =>
  report.value.findings.map((f, i) => ({
    id: `${i}`,
    date: f.from.date ?? "—",
    unit: f.unit ?? "—",
    leg: `${f.from.state ?? "?"} → ${f.to.state ?? "?"}`,
    bought: f.from.gallonsBought.toFixed(0),
    carried: f.carriedGallons.toFixed(0),
    basis: f.basis === "tank_level" ? "tank level" : "miles (floor)",
    fromPer: usd3(f.from.preTaxPerGal),
    toPer: usd3(f.to.preTaxPerGal),
    excess: usd(f.excess),
    sortBy: {
      date: f.from.date ?? "", unit: f.unit ?? "", leg: `${f.from.state}${f.to.state}`,
      bought: f.from.gallonsBought, carried: f.carriedGallons, basis: f.basis,
      fromPer: f.from.preTaxPerGal, toPer: f.to.preTaxPerGal, excess: f.excess,
    } as Record<string, unknown>,
  })),
);
const sort = ref<SortState>({ key: "excess", dir: "desc" });
const sortedRows = computed(() => sortRows(rows.value, sort.value, (r, k) => r.sortBy[k]));
const page = ref(1);
const PER_PAGE = 25;
const pageRows = computed(() => sortedRows.value.slice((page.value - 1) * PER_PAGE, page.value * PER_PAGE));
const cols: DataTableColumn[] = [
  { key: "date", label: "Bought", width: "sm", sortable: true, cellClass: "text-ink-secondary" },
  { key: "unit", label: "Unit", width: "xs", sortable: true, cellClass: "text-ink-secondary" },
  { key: "leg", label: "Leg", width: "sm", sortable: true, cellClass: "text-ink-secondary" },
  { key: "bought", label: "Bought", numeric: true, width: "sm", sortable: true },
  { key: "carried", label: "Still aboard", numeric: true, width: "sm", sortable: true },
  { key: "basis", label: "From", width: "sm", sortable: true, cellClass: "text-ink-tertiary" },
  { key: "fromPer", label: "Fuel / gal there", numeric: true, width: "sm", sortable: true },
  { key: "toPer", label: "…and here", numeric: true, width: "sm", sortable: true },
  { key: "excess", label: "Cost", numeric: true, width: "sm", sortable: true },
];

function exportRows() {
  downloadCsv(
    "fuel-buy-discipline",
    ["Bought", "Unit", "From state", "To state", "Gallons bought", "Gallons still aboard", "Basis",
     "Pre-tax $/gal bought", "Pre-tax $/gal arrived", "Excess $", "Pump-price excess $", "Tax quarters"],
    report.value.findings.map((f) => [
      f.from.date, f.unit, f.from.state, f.to.state, f.from.gallonsBought.toFixed(1),
      f.carriedGallons.toFixed(1), f.basis, f.from.preTaxPerGal.toFixed(4), f.to.preTaxPerGal.toFixed(4),
      f.excess.toFixed(2), f.pumpExcess.toFixed(2), f.taxVersions.join(" "),
    ]),
  );
}
</script>

<template>
  <div class="space-y-6">
    <BaseCard>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-sm font-semibold text-ink">Fuel carried out of dearer states</h3>
          <p class="mt-1 max-w-2xl text-sm text-ink-muted">
            Diesel bought where it costs more and still in the tank on arrival somewhere it costs less. The
            truck's next fill is the proof it made the trip, so there is no route to argue about — only the
            gallons and the two prices.
          </p>
        </div>
        <div class="text-right">
          <p class="text-2xl font-bold" :class="report.excess > 0 ? 'text-danger-700' : 'text-ink'">
            {{ usd(report.excess) }}
          </p>
          <p class="text-xs text-ink-muted">at least, over this window</p>
        </div>
      </div>

      <!-- F10's rule, applied to a saving. The pump-price version of this figure is larger and most of
           the difference is a jurisdiction's tax rate, which is owed on the miles driven there whichever
           state the diesel was bought in — so it is shown as a comparison and never as the headline. -->
      <p class="mt-3 text-xs text-ink-tertiary">
        Priced on the fuel itself, with each state's diesel tax removed. On pump price the same legs read
        {{ usd(report.pumpExcess) }} — the gap is tax the carrier owes wherever it buys, so it is not a saving.
      </p>

      <!-- Half these legs are measured from a tank level and half bounded from miles burned. The bound
           understates roughly fivefold where both exist, so the total is a floor and must read as one. -->
      <p class="mt-2 text-xs text-ink-tertiary">
        {{ report.byBasis.tank_level.pairs }} legs measured from a confirmed tank level
        ({{ usd(report.byBasis.tank_level.excess) }}); {{ report.byBasis.miles_burned.pairs }} bounded from
        miles driven and the truck's own mpg ({{ usd(report.byBasis.miles_burned.excess) }}), which
        understates. The total is a floor, not an estimate.
      </p>

      <!-- The one action on this page: a planner setting, with the number that decides it. -->
      <div v-if="drawdown" class="mt-3 rounded-surface bg-caution-50 px-3 py-2.5 ring-1 ring-caution-100">
        <p class="text-sm text-caution-800">
          Your fuel planner can already buy just enough to reach the next cheaper station — it is switched
          off, because <strong>Always fill full</strong> is on in Fuel Planning Settings. Over this window that
          setting is worth at least {{ usd(drawdown) }}.
        </p>
      </div>
    </BaseCard>

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label="Legs" :value="coverage.findings.toLocaleString()" :sub="`of ${coverage.pairs.toLocaleString()} examined`" />
      <StatCard label="Gallons carried" :value="gal(report.gallons)" sub="out of the dearer state" />
      <StatCard label="Cost of carrying it" :value="usd(report.excess)" sub="at least — see the note above" />
      <StatCard
        label="Could not be judged"
        :value="coverage.blind.toLocaleString()"
        :sub="coverage.blindShare == null ? '—' : `${pct1(coverage.blindShare)} of pairs`"
      />
    </div>

    <!-- Most of what produced no finding is not missing data, and saying so is the difference between a
         caveat and a panic: the truck stayed in one state, or drove the way the policy wants. -->
    <p class="text-xs text-ink-tertiary">
      Of {{ coverage.pairs.toLocaleString() }} legs, {{ coverage.sameState.toLocaleString() }} stayed inside one
      state and {{ coverage.towardDearer.toLocaleString() }} ran from cheaper fuel toward dearer — the way round
      the policy asks for, so neither is a finding. Only {{ coverage.blind }} could not be judged at all.
    </p>

    <div v-if="stateRows.length">
      <h4 class="mb-2 text-sm font-semibold text-ink">What fuel costs, by state, with the tax taken out</h4>
      <BaseCard padding="none">
        <DataTable :columns="stateCols" :rows="stateRows" row-key="id" empty-text="Nothing priced in this window." />
      </BaseCard>
      <!-- Ranked, shown, and flagged — never applied. A carrier avoids a state for reasons a price cannot
           see (CARB, tolls, a customer who will not take the truck), so the configured list stays
           authoritative and this reports where the two disagree. -->
      <p v-if="divergence.unlisted.length" class="mt-2 text-sm text-ink-secondary">
        {{ listStates(divergence.unlisted.map((s) => s.state)) }}
        {{ divergence.unlisted.length === 1 ? "is" : "are" }} among your dearest fuel and
        {{ divergence.unlisted.length === 1 ? "is" : "are" }} in no policy list.
        <template v-if="props.policy.avoidStates.length">
          You avoid {{ listStates(props.policy.avoidStates) }}.
        </template>
      </p>
      <p class="mt-1 text-xs text-ink-tertiary">
        This is what the fleet PAID, not what fuel costs in that state — somewhere you only ever stop at
        expensive sites looks dear for a reason of your own making. States under
        {{ gal(2000) }} gallons are left out: a rule over a handful of stops is a rule about noise.
      </p>
    </div>

    <div>
      <div class="mb-2 flex items-center justify-between">
        <h4 class="text-sm font-semibold text-ink">Every leg</h4>
        <BaseButton v-if="report.findings.length" variant="ghost" @click="exportRows">Download (CSV)</BaseButton>
      </div>
      <BaseCard padding="none">
        <DataTable
          :columns="cols"
          :rows="pageRows"
          :sort="sort"
          :empty-text="loading ? 'Loading…' : 'No fuel was carried out of a dearer state in this window.'"
          @sort="sort = toggleSort(sort, $event); page = 1"
        >
          <template #footer>
            <TablePagination v-model:page="page" :page-size="PER_PAGE" :total="sortedRows.length" />
          </template>
        </DataTable>
      </BaseCard>
    </div>
  </div>
</template>
