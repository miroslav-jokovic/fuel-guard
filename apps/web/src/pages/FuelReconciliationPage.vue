<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AppTabs, AppCard as BaseCard, type TabItem } from "@fuelguard/ui";
import { analyzePolicyExceptions, type SpendLine } from "@fuelguard/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import ReconcileTab from "@/features/reconcile/ReconcileTab.vue";
import StatementsCard from "@/features/reconcile/StatementsCard.vue";
import SpendOverviewTab from "@/features/reconcile/SpendOverviewTab.vue";
import DiscountCaptureTab from "@/features/reconcile/DiscountCaptureTab.vue";
import ExceptionsTab from "@/features/reconcile/ExceptionsTab.vue";
import SpendTrendTab from "@/features/reconcile/SpendTrendTab.vue";
import { useStatementsQuery, useStatementLinesQuery } from "@/features/reconcile/useStatements";
import { usd } from "@/features/reconcile/format";

/**
 * Fuel spend — what the fuel bill is, and why it moved.
 *
 * ── WHY THIS PAGE HAS TABS NOW ───────────────────────────────────────────────────────────────────
 * It used to be one thing: drop a file, see how it reconciles, refresh, lose it. That answers whether
 * a statement matches our records and cannot answer "spend is up, why", because nothing was kept to
 * compare against. Every tab except Reconcile reads from STORED statements, so a page load lands on
 * history instead of an empty dropzone.
 *
 * ── WHY "SPEND & TREND" IS FIRST ─────────────────────────────────────────────────────────────────
 * It is the only tab that answers the question the carrier actually asks — "fuel cost more this week,
 * why" — and the only one fed by a source that is always there. Every other tab reads uploaded vendor
 * statements; this one reads a nightly rollup of the EFS feed, the odometer and the engine hours, so it
 * has months of history the day it ships and needs nobody to remember to upload anything.
 *
 * Reconcile keeps its place beside it because it is still the one that catches a fill we were billed
 * for and never recorded — the fuel-theft surface. The rest are procurement questions, a different job.
 *
 * ── WHY THE TAB IS IN THE URL ────────────────────────────────────────────────────────────────────
 * A page whose state dies on refresh cannot be sent to anybody, and this one exists to be sent to
 * somebody. The tab is a query parameter so a link opens on the view the sender was looking at.
 */
const { data: statements, isLoading, isError, error, refetch } = useStatementsQuery();

/** Period scope. "Everything" is the default because five weeks is not a lot to slice. */
const scope = ref<string>("all");
const scopeOptions = computed(() => [
  { value: "all", label: "All statements" },
  { value: "last4", label: "Last 4 weeks" },
  ...(statements.value ?? []).map((s) => ({ value: s.id, label: `${s.periodStart} → ${s.periodEnd}` })),
]);
// A saved scope can point at a statement a later upload superseded; fall back rather than show nothing.
watch(scopeOptions, (opts) => {
  if (!opts.some((o) => o.value === scope.value)) scope.value = "all";
});

const scopedStatements = computed(() => {
  const all = statements.value ?? [];
  if (scope.value === "all") return all;
  if (scope.value === "last4") return all.slice(0, 4);
  return all.filter((s) => s.id === scope.value);
});
const scopedIds = computed(() => scopedStatements.value.map((s) => s.id));
const { data: lineData, isLoading: linesLoading } = useStatementLinesQuery(scopedIds);
const lines = computed<SpendLine[]>(() => lineData.value ?? []);

const exceptions = computed(() => analyzePolicyExceptions(lines.value));

const route = useRoute();
const router = useRouter();
const TAB_VALUES = ["spend", "reconcile", "overview", "discount", "avoid_brand", "california", "off_network"];
const tab = computed<string>({
  get: () => {
    const q = route.query.tab;
    const v = Array.isArray(q) ? q[0] : q;
    return typeof v === "string" && TAB_VALUES.includes(v) ? v : "spend";
  },
  // `replace` so flipping between tabs does not fill the back button with them; a reader pressing back
  // expects to leave the page, not to walk their own tab history.
  set: (v) => void router.replace({ query: { ...route.query, tab: v } }),
});
const tabs = computed<TabItem[]>(() => [
  { value: "spend", label: "Spend & trend" },
  { value: "reconcile", label: "Reconcile a file" },
  { value: "overview", label: "Statements", badge: scopedStatements.value.length || undefined },
  { value: "discount", label: "Discount capture" },
  { value: "avoid_brand", label: "ONE9 & off-brand", badge: exceptions.value.avoidedBrands.lines || undefined },
  { value: "california", label: "California", badge: exceptions.value.avoidedStates.lines || undefined },
  { value: "off_network", label: "Off-network", badge: exceptions.value.offNetwork.lines || undefined },
]);

const caNote = computed(() => {
  const f = exceptions.value.avoidedStateFillSize;
  if (f.inside == null || f.outside == null) return null;
  return `Average fill inside California is ${f.inside.toFixed(0)} gallons against ${f.outside.toFixed(0)} elsewhere — the buy-minimum discipline the policy asks for, and the gap to watch.`;
});

const hasHistory = computed(() => (statements.value ?? []).length > 0);
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What fuel is costing, why it moved, and how the vendor's statement compares." />

    <AppTabs v-model="tab" :tabs="tabs" label="Fuel spend views" scrollable />

    <SpendTrendTab v-if="tab === 'spend'" />

    <ReconcileTab v-else-if="tab === 'reconcile'" @saved="refetch()" />

    <template v-else>
      <FilterBar>
        <FilterSelect v-model="scope" :options="scopeOptions" label="Period" />
        <span class="text-sm text-ink-muted">
          {{ scopedStatements.length }} statement{{ scopedStatements.length === 1 ? "" : "s" }}
          <template v-if="lines.length">· {{ lines.length.toLocaleString() }} lines</template>
          <template v-if="linesLoading"> · loading…</template>
        </span>
      </FilterBar>

      <p v-if="isError" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
        Couldn't load your statements: {{ error instanceof Error ? error.message : "unknown error" }}
      </p>

      <BaseCard v-else-if="!hasHistory && !isLoading">
        <h3 class="text-sm font-semibold text-ink">Nothing kept yet</h3>
        <p class="mt-1 text-sm text-ink-muted">
          Upload a weekly Pilot statement on the first tab and it stays here — these views read from the statements on
          file, not from the last file you opened. Four weeks is enough to explain a change in spend; two is enough to
          see one.
        </p>
      </BaseCard>

      <template v-else>
        <SpendOverviewTab v-if="tab === 'overview'" :lines="lines" />
        <DiscountCaptureTab v-else-if="tab === 'discount'" :lines="lines" />
        <ExceptionsTab
          v-else-if="tab === 'avoid_brand'"
          title="ONE9 and other off-brand sites"
          :blurb="`Networks your fuel policy says to avoid. Across this period they captured ${usd(exceptions.avoidedBrands.discountPerGal)} a gallon of discount — the posted price is also usually higher, so it is the worst gallon the fleet can buy twice over.`"
          :report="exceptions.avoidedBrands"
          slug="one9-off-brand"
        />
        <ExceptionsTab
          v-else-if="tab === 'california'"
          title="California"
          blurb="CARB diesel and California's fuel taxes make every gallon bought in the state cost more, which is why the policy is to cross on as little fuel as possible."
          :report="exceptions.avoidedStates"
          slug="california"
          :note="caNote"
        />
        <ExceptionsTab
          v-else-if="tab === 'off_network'"
          title="Off the preferred network"
          blurb="Fills outside Pilot and Flying J, including sites we could not identify — an unidentified site is certainly not a preferred one, so it counts here rather than being assumed compliant."
          :report="exceptions.offNetwork"
          slug="off-network"
        />

        <StatementsCard
          v-if="tab === 'overview'"
          :statements="statements ?? []"
          :loading="isLoading"
          :error="isError ? 'Could not load statements' : null"
        />
      </template>
    </template>
  </div>
</template>
