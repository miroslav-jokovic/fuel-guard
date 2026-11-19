<script setup lang="ts">
import { computed } from "vue";
import { DEFAULT_ORG_TIMEZONE, todayInZone, type LeadCostRow } from "@silvicom/shared";
import { AppCard as BaseCard, DataTable, QueryState, useQueryState, type DataTableColumn } from "@silvicom/ui";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import { count, usd } from "./spendLines";
import { useAdsLeadCost } from "./useAdsOverview";

/**
 * Ads › Overview's cost report (ADS-PLATFORM-V2-PLAN V7d): cost per qualified lead and per hire, by source and by
 * angle, for days a person picks. Every figure is the API's (`GET /api/ads/report/leads`, shared `leadCostReport.ts`
 * says what each one means); this card only says them, and says plainly what they are not:
 *   · a cohort — the leads that arrived in the days, and what they have reached so far, so a recent range is short
 *     of hires that have not happened yet;
 *   · a source with no spend recorded shows "No spend recorded", never $0.
 * The days are in the URL (`?from=&to=`), defaulting to this month so far, in the zone the ads reads count days in.
 */
const qs = useQueryState();
const fromQ = qs.param("from");
const toQ = qs.param("to");
const today = todayInZone(new Date(), DEFAULT_ORG_TIMEZONE);
const range = computed(() => ({ from: fromQ.value || `${today.slice(0, 8)}01`, to: toQ.value || today }));
const report = useAdsLeadCost(range);
const view = computed(() => report.data.value);

const money = (c: number | null, none: string) => (c === null ? none : usd(c));
const columnsFor = (first: string): DataTableColumn[] => [
  { key: "name", label: first },
  { key: "leads", label: "Leads", align: "right" },
  { key: "qualified", label: "Qualified", align: "right" },
  { key: "hired", label: "Hired", align: "right" },
  { key: "spend", label: "Spent", align: "right" },
  { key: "per_qualified", label: "Per qualified lead", align: "right" },
  { key: "per_hire", label: "Per hire", align: "right" },
];
const sourceColumns = columnsFor("Source");
const angleColumns = columnsFor("Angle");
const rowsOf = (rows: readonly LeadCostRow[]) => rows.map((r) => ({
  ...r,
  name: r.label,
  spend: money(r.spend_cents, "No spend recorded"),
  per_qualified: r.spend_cents === null ? "—" : money(r.cost_per_qualified_cents, r.qualified === 0 ? "None qualified yet" : "—"),
  per_hire: r.spend_cents === null ? "—" : money(r.cost_per_hire_cents, r.hired === 0 ? "No hire yet" : "—"),
}));
const sources = computed(() => (view.value ? rowsOf([...view.value.by_source, view.value.total]) : []));
const angles = computed(() => (view.value ? rowsOf(view.value.by_angle) : []));
</script>

<template>
  <BaseCard as="section" class="space-y-4" data-test="lead-cost">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-ink">Cost per qualified lead and per hire</h2>
      <DateRangeFilter
        :from="range.from"
        :to="range.to"
        :presets="false"
        @update:from="(v) => v && qs.set({ from: v })"
        @update:to="(v) => v && qs.set({ to: v })"
      />
    </div>
    <p class="text-sm text-ink-muted">
      The people who came in on these days, and what each has reached so far: a recruiter qualified them, or they became
      an applicant, applied or were hired. Hires come weeks after the lead, so recent days show fewer of them.
    </p>
    <QueryState
      :loading="report.isLoading.value"
      :error="report.error.value"
      error-text="Could not load the cost report."
      :retrying="report.isFetching.value"
      @retry="report.refetch()"
    >
      <div v-if="view" class="space-y-4">
        <!-- ui-adoption: unpaged — one row per source the carrier has, a handful. -->
        <DataTable :columns="sourceColumns" :rows="sources" embedded row-key="key" empty-text="No leads and no spend on these days." data-test="by-source" />
        <h3 class="text-sm font-semibold text-ink">By angle</h3>
        <p class="text-sm text-ink-muted">Ad leads only, by the kind of ad that brought them: what it leads with and what its picture shows.</p>
        <!-- ui-adoption: unpaged — one row per angle the carrier's ads used, at most a few dozen. -->
        <DataTable :columns="angleColumns" :rows="angles" embedded row-key="key" empty-text="No ad leads and no ad spend on these days." data-test="by-angle" />
        <p v-if="view.ad_spend_unattributed_cents > 0" class="text-sm text-ink-muted" data-test="unattributed">
          {{ usd(view.ad_spend_unattributed_cents) }} of the spend is not yet reported per ad, so the angles add up to less than the source.
        </p>
        <p class="text-xs text-ink-tertiary">{{ count(view.total.leads) }} leads · days counted in {{ view.zone }}</p>
      </div>
    </QueryState>
  </BaseCard>
</template>
