<script setup lang="ts">
import { computed, toRef } from "vue";
import { formatDisplayDate, type CampaignState, type ConceptPerformance } from "@silvicom/shared";
import { DataTable, QueryState, type DataTableColumn } from "@silvicom/ui";
import { count, usd } from "./spendLines";
import { useCampaignConcepts } from "./useAdsCampaigns";

/**
 * What each concept of the campaign did (CQ3's reader, D-AD22): the per-ad hours folded per preset, with cost per
 * lead per preset and per language. Shown once the campaign has reached the platform — before that there is no ad
 * and no hour, and a table of zeros would read as "nothing works". Cost per lead is "—" until a lead came, never $0.
 */
const props = defineProps<{ campaignId: string; state: CampaignState }>();

const REACHED_PLATFORM: ReadonlySet<CampaignState> = new Set<CampaignState>(["paused", "launching", "live", "pausing", "archived"]);
const show = computed(() => REACHED_PLATFORM.has(props.state));
const concepts = useCampaignConcepts(toRef(props, "campaignId"), show);

const columns: DataTableColumn[] = [
  { key: "preset", label: "Concept" },
  { key: "ads", label: "Ads", numeric: true },
  { key: "spend", label: "Spent", numeric: true },
  { key: "leads", label: "Leads", numeric: true },
  { key: "cpl", label: "Per lead", numeric: true },
  { key: "en", label: "English, per lead", numeric: true },
  { key: "es", label: "Spanish, per lead", numeric: true },
];
const cpl = (c: number | null) => (c === null ? "—" : usd(c));
const rows = computed(() => (concepts.data.value?.concepts ?? []).map((c: ConceptPerformance) => ({
  id: c.preset_key,
  preset: c.preset_key,
  ads: count(c.creatives),
  spend: usd(c.spend_cents),
  leads: count(c.leads),
  cpl: cpl(c.cost_per_lead_cents),
  en: cpl(c.by_language.en.cost_per_lead_cents),
  es: cpl(c.by_language.es.cost_per_lead_cents),
})));
const since = computed(() => (concepts.data.value ? formatDisplayDate(concepts.data.value.since) : ""));
</script>

<template>
  <section v-if="show" class="space-y-2" data-test="campaign-concepts">
    <div>
      <h3 class="text-sm font-semibold text-ink">What each concept did</h3>
      <p class="text-sm text-ink-muted">From the hourly pull, per ad, since {{ since || "the window began" }}. A concept with no lead yet shows no cost per lead.</p>
    </div>
    <QueryState :loading="concepts.isLoading.value" :error="concepts.error.value" error-text="Could not load what the concepts did." :retrying="concepts.isFetching.value" @retry="concepts.refetch()">
      <DataTable :columns="columns" :rows="rows" row-key="id" empty-text="No ad has run yet." data-test="no-concepts" />
    </QueryState>
  </section>
</template>
