<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@silvicom/ui";
import {
  analyzeCarriedFuel, rankStatesByFuelCost, policyDivergence, listStates, STATE_NAMES,
  gradePolicyCells, NO_FUEL_TARGETS, AVOIDED_STATE_TARGET_PERIOD, formatDisplayDate,
  type CarriedFuelFill, type FuelPolicy, type PolicyGallonCell, type TargetVariance,
} from "@silvicom/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import StatCard from "@/components/ui/StatCard.vue";
import ExplainerPanel from "@/components/ui/ExplainerPanel.vue";
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
 *
 * ── RESULTS FIRST, METHOD ONE CLICK AWAY (design verdict 2026-10-03, E4/E10) ─────────────────────
 * The tab used to open on three paragraphs of method, then four cards (one repeating the headline's
 * dollars), the targets, an eight-state price table, and only then the purchases a reader acts on. Now:
 * the headline with ONE sentence that keeps the material qualification in view (how many trips were
 * measured and how many estimated, and that the estimate undercounts), the purchases, the targets, and
 * behind two `ExplainerPanel`s the method (pump price vs fuel price, the trips that produced nothing) and
 * the state table. Nothing was deleted; `<details>` keeps it in the page's own search while closed. The
 * one state finding, a dear state no policy names, stays in view — it is a result, not reference.
 */
const props = withDefaults(defineProps<{
  /** Every fill the window needs INCLUDING the 14-day lookback — see `useBuyFills`. */
  fills: CarriedFuelFill[];
  policy: FuelPolicy;
  /**
   * Tractor gallons by month, brand and state for the window, added up in the database
   * (`fuel_policy_gallons`, Q-FSV16). The fill sequence above carries no brand, and the on-network share
   * is a question about brands, so the two figures on this tab come from two sources and each names its
   * own. See the targets section below.
   */
  cells: PolicyGallonCell[];
  /** The page's window, inclusive `YYYY-MM-DD` — the months to grade are enumerated from it. */
  window: { from: string; to: string };
  /**
   * False while a truck filter is active. A target is a FLEET commitment — "at most 4,000 gallons a
   * month in California" is about the carrier, not about the three trucks somebody picked — so with
   * trucks selected the figures still render and the grade does not. Grading a subset against a
   * fleet ceiling would call any small enough selection compliant.
   */
  fleetWide?: boolean;
  /**
   * Whether the fill sequence arrived. Everything but the targets is worked out from it, and an empty
   * sequence reads as an answer ("$0 at least", "0 purchases"), so pending or failed, those parts say so
   * in place. The targets read their own sums (`inputs`) and stay: one failed read used to take the whole
   * page with it (verdict E8, 2026-10-04).
   */
  fillsState?: "ready" | "loading" | "error";
  /**
   * Whether the two inputs the targets are graded from (the gallon `cells`, the org's policy) arrived.
   * Both default to empty when their query is pending or failed, and empty reads as an answer: "no
   * tractor fuel in this window", "no target set", California at zero gallons. The verdict that
   * audited this page (2026-10-03, principle #6) saw those beside 867 fills and $4,462 of findings.
   * Not "ready" means the section says so and grades nothing.
   */
  inputs?: "ready" | "loading" | "error";
}>(), { fleetWide: true, fillsState: "ready", inputs: "ready" });
const FILLS_FAILED = "Couldn't load the fill sequence for this window.";
/** The purchases table's Retry: the page owns the read. */
const emit = defineEmits<{ retry: [] }>();

const report = computed(() => analyzeCarriedFuel(props.fills));

/**
 * ── THE TARGETS, GRADED (C8, D-FUI10) ────────────────────────────────────────────────────────────
 * Settings → Planned Fueling has held three targets since 0325 and nothing in the section rendered a
 * figure for them to grade — C8's Done-when is "no policy figure renders as a bare count", and until
 * this section the on-network share was not rendered at all. This is the policy-adherence tab, so the
 * figures the policy is held to live here, beside the state ranking the avoid-list is measured on.
 *
 * On-network is a RATIO and is graded once over the window; avoided-state gallons is a COUNT against a
 * per-`AVOIDED_STATE_TARGET_PERIOD` ceiling and is graded per calendar month, with a month the window
 * only partly covers marked as a floor. `gradePolicyCells` owns that arithmetic and its tests.
 *
 * With a truck filter on, the targets are stripped before grading rather than the section hidden: the
 * selection's own share is still a fact worth reading, it just has no fleet standard to be held to.
 */
const grades = computed(() =>
  gradePolicyCells(
    props.cells,
    props.fleetWide ? props.policy : { ...props.policy, targets: NO_FUEL_TARGETS },
    props.window,
  ),
);
const anyTargetSet = computed(() => Object.values(props.policy.targets).some((t) => t != null));

const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);
const points = (v: TargetVariance) => {
  const n = Math.abs(v.delta).toFixed(1);
  return v.met ? `${n} points to spare` : `${n} points short`;
};
const toneOf = (v: TargetVariance | null) => (v == null ? undefined : v.met ? "text-success-700" : "text-danger-700");

const onNetworkSub = computed(() => {
  const v = grades.value.onNetwork.variance;
  if (v) return `target at least ${v.target}% · ${points(v)}`;
  if (grades.value.onNetwork.actualPct == null) return "no tractor fuel in this window";
  if (!props.fleetWide) return "fleet target not applied to a truck selection";
  return props.policy.targets.onNetworkPct == null ? "no target set" : "";
});

/** `2026-08` → `Aug 2026`. Built from parts, so no timezone can move it to July. */
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
};
const monthRows = computed(() =>
  [...grades.value.avoidedStateByMonth].reverse().map((m) => ({
    id: m.month,
    month: monthLabel(m.month),
    gallons: gal(m.gallons),
    target: m.variance ? `at most ${gal(m.variance.target)}` : "—",
    against: m.variance
      ? (m.variance.met ? `${gal(m.variance.delta)} under` : `${gal(-m.variance.delta)} over`)
      : "—",
    // A partial month under the ceiling proves nothing — the rest of the month is not here. Over it
    // is already conclusive: more gallons could only make it worse.
    coverage: m.partial ? (m.variance && !m.variance.met ? "part of the month — already over" : "part of the month — a floor") : "whole month",
    tone: m.partial && m.variance?.met ? undefined : toneOf(m.variance),
  })),
);
const monthCols: DataTableColumn[] = [
  { key: "month", label: "Month", width: "sm", cellClass: "text-ink-secondary" },
  { key: "gallons", label: "Gallons in avoided states", numeric: true, width: "sm" },
  { key: "target", label: `Ceiling / ${AVOIDED_STATE_TARGET_PERIOD}`, numeric: true, width: "sm", cellClass: "text-ink-tertiary" },
  { key: "against", label: "Against it", numeric: true, width: "sm" },
  { key: "coverage", label: "Window covers", width: "md", cellClass: "text-ink-tertiary" },
];

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
    // MM/DD/YYYY like every date on screen; the sort key below keeps the ISO string, which sorts.
    date: f.from.date ? formatDisplayDate(f.from.date) : "—",
    unit: f.unit ?? "—",
    leg: `${f.from.state ?? "?"} → ${f.to.state ?? "?"}`,
    bought: f.from.gallonsBought.toFixed(0),
    carried: f.carriedGallons.toFixed(0),
    basis: f.basis === "tank_level" ? "Tank reading" : "Miles driven (at least)",
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
// A narrower window or truck pick can leave fewer rows than the page the reader was on; DataTable shows its
// empty text before its footer, so without this the way back to page 1 vanishes with the rows.
watch(rows, () => { page.value = 1; });
const pageRows = computed(() => sortedRows.value.slice((page.value - 1) * PER_PAGE, page.value * PER_PAGE));
const cols: DataTableColumn[] = [
  { key: "date", label: "Bought", width: "sm", sortable: true, cellClass: "text-ink-secondary" },
  { key: "unit", label: "Unit", width: "xs", sortable: true, cellClass: "text-ink-secondary" },
  { key: "leg", label: "Trip between fuel stops", width: "sm", sortable: true, cellClass: "text-ink-secondary" },
  { key: "bought", label: "Gallons bought", numeric: true, width: "sm", sortable: true },
  { key: "carried", label: "Fuel left in tank (gal)", numeric: true, width: "sm", sortable: true },
  { key: "basis", label: "Measured by", width: "sm", sortable: true, cellClass: "text-ink-tertiary" },
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
            Diesel bought where it costs more and still in the tank on arrival somewhere it costs less.
          </p>
        </div>
        <div v-if="fillsState === 'ready'" class="text-right">
          <!-- Plain ink at any amount (Q-FSV15 ruling 2, extended here 2026-10-04): a total says how much, not
               whether it is good news. The targets below keep their grade colour — that is a verdict. -->
          <p class="text-2xl font-bold text-ink" data-testid="carried-usd">
            {{ usd(report.excess) }}
          </p>
          <p class="text-xs text-ink-muted">at least, over this window</p>
        </div>
      </div>

      <!-- The one qualification that changes how the figure is read stays beside it: half the trips are
           estimated from miles, and that estimate undercounts roughly fivefold, so the total is a minimum. -->
      <p v-if="fillsState === 'loading'" class="mt-3 text-sm text-ink-muted" data-testid="carried-state">Loading the fill sequence…</p>
      <p v-else-if="fillsState === 'error'" class="mt-3 text-sm text-danger-700" data-testid="carried-state">{{ FILLS_FAILED }}</p>
      <p v-else class="mt-3 text-xs text-ink-tertiary" data-testid="carried-basis">
        {{ coverage.findings.toLocaleString() }} purchases, {{ gal(report.gallons) }} gal still in the tank.
        {{ report.byBasis.tank_level.pairs }} trips measured from a confirmed tank level
        ({{ usd(report.byBasis.tank_level.excess) }}); {{ report.byBasis.miles_burned.pairs }} estimated from
        miles driven and the truck's own mpg ({{ usd(report.byBasis.miles_burned.excess) }}), which undercounts —
        so the total is a minimum.
      </p>

      <!--
        Until 2026-09-10 a callout here offered the planner's min-drawdown switch, priced. The owner retired
        that policy the same day (D-FP3: every planned fill is full, "without any overcomplications"), so the
        carried-fuel figure above is now a fact about where the fleet buys, with no setting to point at.
      -->
    </BaseCard>

    <div>
      <div class="mb-2 flex items-center justify-between">
        <h4 class="text-sm font-semibold text-ink">Purchases to review</h4>
        <BaseButton v-if="fillsState === 'ready' && report.findings.length" variant="ghost" @click="exportRows">Download (CSV)</BaseButton>
      </div>
      <BaseCard padding="none">
        <DataTable
          :columns="cols"
          :rows="pageRows"
          :sort="sort"
          :loading="fillsState === 'loading'"
          :error="fillsState === 'error' ? FILLS_FAILED : null"
          @retry="emit('retry')"
          empty-text="No fuel was carried out of a dearer state in this window."
          @sort="sort = toggleSort(sort, $event); page = 1"
        >
          <template #footer>
            <TablePagination v-model:page="page" :page-size="PER_PAGE" :total="sortedRows.length" />
          </template>
        </DataTable>
      </BaseCard>
    </div>

    <ExplainerPanel v-if="fillsState === 'ready'" summary="How the extra cost is worked out">
      <p>
        The truck's next fill is the proof it made the trip, so there is no route to argue about — only the
        gallons and the two prices.
      </p>
      <!-- F10's rule, applied to a saving. The pump-price version of this figure is larger and most of
           the difference is a jurisdiction's tax rate, which is owed on the miles driven there whichever
           state the diesel was bought in — so it is shown as a comparison and never as the headline. -->
      <p>
        Priced on the fuel itself, with each state's diesel tax removed. On pump price the same trips read
        {{ usd(report.pumpExcess) }} — the gap is tax the carrier owes wherever it buys, so it is not a saving.
      </p>
      <!-- Most of what produced no finding is not missing data, and saying so is the difference between a
           caveat and a panic: the truck stayed in one state, or drove the way the policy wants. -->
      <p>
        Of {{ coverage.pairs.toLocaleString() }} trips between fuel stops, {{ coverage.sameState.toLocaleString() }} stayed inside one
        state and {{ coverage.towardDearer.toLocaleString() }} ran from cheaper fuel toward dearer — the way round
        the policy asks for, so neither is a finding. Only {{ coverage.blind }} could not be judged at all<template v-if="coverage.blindShare != null"> ({{ pct1(coverage.blindShare) }})</template>.
      </p>
    </ExplainerPanel>

    <!-- ── the targets, graded (C8) ─────────────────────────────────────────────────────────────
         The two figures the policy is held to, each against the standard the carrier set for it, or
         reported without a standard beside it when none is set. No target is ever assumed on the carrier's
         behalf — that is 0325's ruling and the settings form says the same. -->
    <div>
      <h4 class="mb-2 text-sm font-semibold text-ink">Against your targets</h4>
      <p v-if="inputs !== 'ready'" class="mb-2 text-xs text-caution-800">
        {{ inputs === "loading"
          ? "Loading the purchases and settings these figures are graded from."
          : "Couldn't load the purchases or settings these figures are graded from, so nothing is graded here. Reload to try again." }}
      </p>
      <template v-else>
        <p v-if="!fleetWide" class="mb-2 text-xs text-caution-800">
          Targets are set for the whole fleet. With trucks selected, the figures below are the selection's
          own and are shown without a grade.
        </p>
        <p v-else-if="!anyTargetSet" class="mb-2 text-xs text-ink-tertiary">
          No target is set. Set one in Fuel Planning Settings and each figure here is graded against it;
          until then it is reported without a standard beside it.
        </p>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StatCard
            label="On the preferred network"
            :value="pct(grades.onNetwork.actualPct)"
            :sub="onNetworkSub"
            :sub-tone="toneOf(grades.onNetwork.variance)"
            :muted="grades.onNetwork.actualPct == null"
          />
        </div>
        <!-- The rule counts an unmatched station as off-network, so the share is a floor by that much
             and a margin narrower than the unresolved share is inside the measurement, not outside it. -->
        <p v-if="grades.onNetwork.unresolvedPct" class="mt-1 text-xs text-ink-tertiary">
          {{ pct(grades.onNetwork.unresolvedPct) }} of these gallons could not be matched to a station and count
          as off-network, so the true share is between {{ pct(grades.onNetwork.actualPct) }} and
          {{ pct(Math.min(100, (grades.onNetwork.actualPct ?? 0) + grades.onNetwork.unresolvedPct)) }}.
        </p>

        <template v-if="props.policy.avoidStates.length">
          <BaseCard padding="none" class="mt-3">
            <DataTable :columns="monthCols" :rows="monthRows" row-key="id" empty-text="The window covers no calendar month.">
              <template #cell-against="{ row }">
                <span :class="row.tone">{{ row.against }}</span>
              </template>
            </DataTable>
          </BaseCard>
          <p class="mt-1 text-xs text-ink-tertiary">
            Gallons bought in {{ listStates(props.policy.avoidStates) }}, by the fill's business date. The ceiling
            is stated per {{ AVOIDED_STATE_TARGET_PERIOD }}, so each month is held to it on its own; a month this
            window only partly covers is a floor and is not called met.
          </p>
        </template>
        <p v-else class="mt-3 text-xs text-ink-tertiary">
          No state is avoided in your policy, so there is no gallons ceiling to hold a month to.
        </p>

        <!-- The third target has nowhere to land, and saying so beats a made-up figure. The posted price
             only ever arrives on the vendor's statement (Q-FUI7), and none has been uploaded. -->
        <p v-if="grades.discountCaptureTargetPct != null" class="mt-2 text-xs text-caution-800">
          Discount capture is targeted at least {{ grades.discountCaptureTargetPct }}%. This page does not grade
          it; the fills billed above Pilot's quote are under "Paid vs Pilot quote" below.
        </p>
      </template>
    </div>

    <!-- Ranked, shown, and flagged — never applied. A carrier avoids a state for reasons a price cannot
         see (CARB, tolls, a customer who will not take the truck), so the configured list stays
         authoritative and this reports where the two disagree. The disagreement is a result and stays in
         view; the table it comes from is reference, one click away. -->
    <p v-if="fillsState === 'ready' && divergence.unlisted.length" class="text-sm text-ink-secondary">
      {{ listStates(divergence.unlisted.map((s) => s.state)) }}
      {{ divergence.unlisted.length === 1 ? "is" : "are" }} among your dearest fuel and
      {{ divergence.unlisted.length === 1 ? "is" : "are" }} in no policy list.
      <template v-if="props.policy.avoidStates.length">
        You avoid {{ listStates(props.policy.avoidStates) }}.
      </template>
    </p>
    <ExplainerPanel v-if="fillsState === 'ready' && stateRows.length" summary="What fuel costs, by state, with the tax taken out">
      <BaseCard padding="none">
        <DataTable :columns="stateCols" :rows="stateRows" row-key="id" empty-text="Nothing priced in this window." />
      </BaseCard>
      <p class="text-xs text-ink-tertiary">
        This is what the fleet PAID, not what fuel costs in that state — somewhere you only ever stop at
        expensive sites looks dear for a reason of your own making. States under
        {{ gal(2000) }} gallons are left out: a rule over a handful of stops is a rule about noise.
      </p>
    </ExplainerPanel>
  </div>
</template>
