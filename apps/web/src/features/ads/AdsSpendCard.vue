<script setup lang="ts">
import { computed } from "vue";
import type { AdPlatform, AdsSpendCampaign } from "@silvicom/shared";
import { AppCard as BaseCard, DataTable, QueryState, type DataTableColumn } from "@silvicom/ui";
import { formatDateTime } from "@/lib/format";
import { budgetLine, count, platformLine, reconcileLine, usd, type Tone } from "./spendLines";
import { useAdsSpend } from "./useAdsSettings";

/**
 * Settings › Ads control's "spend control live" (ADS-AGENT-PLAN §4b; Track S, E1c): month-to-date per
 * platform against its cap with the month-end forecast, each campaign today and over its life, the AI and
 * picture budgets used, and whether the daily check against Meta is running. Every figure is
 * `GET /api/ads/spend`'s, which reads the guard's own folds — so this card and a refused launch cannot
 * disagree. Readable by everyone the page opens for; there is nothing to change here.
 */
const spend = useAdsSpend();
const view = computed(() => spend.data.value);

const PLATFORM: Record<AdPlatform, string> = { meta: "Meta (Facebook, Instagram)", tiktok: "TikTok", x: "X", simulator: "Simulator" };
const SHORT: Record<AdPlatform, string> = { meta: "Meta", tiktok: "TikTok", x: "X", simulator: "Simulator" };
const STATE: Record<string, string> = { paused: "Paused", launching: "Launching", live: "Live", pausing: "Pausing", archived: "Archived", failed: "Failed" };
const TONE: Record<Tone, string> = { ok: "text-ink-muted", warn: "text-warning-700", stop: "text-danger-700" };

// No `card` markers: on a phone every figure stays on the row's card. The contract's three-fact card sends the
// rest to the row's own page, and a campaign has none until E3 — marking them would hide the lifetime spend.
const columns: DataTableColumn[] = [
  { key: "name", label: "Campaign" },
  { key: "platform", label: "On" },
  { key: "state", label: "State" },
  { key: "today", label: "Today", numeric: true },
  { key: "lifetime", label: "So far", numeric: true },
  { key: "leads", label: "Leads", numeric: true },
  { key: "cpl", label: "Per lead", numeric: true },
];
const of = (spent: number, cap: number | null) => (cap === null ? usd(spent) : `${usd(spent)} of ${usd(cap)}`);
const rows = computed(() => (view.value?.campaigns ?? []).map((c: AdsSpendCampaign) => ({
  id: c.id,
  name: c.name,
  // The short name: the full one beside every campaign truncated the campaign's own name on a phone (E1c pass).
  platform: SHORT[c.platform],
  state: STATE[c.state] ?? c.state,
  today: of(c.today_spend_cents, c.daily_budget_cents),
  lifetime: of(c.lifetime_spend_cents, c.lifetime_cap_cents),
  leads: count(c.lifetime_leads),
  cpl: c.lifetime_cost_per_lead_cents === null ? "—" : usd(c.lifetime_cost_per_lead_cents),
})));
</script>

<template>
  <BaseCard as="section" class="space-y-4">
    <div>
      <h2 class="text-sm font-semibold text-ink">Spend so far</h2>
      <p class="mt-1 text-sm text-ink-muted">
        From our hourly pull. A launch is also checked against what Meta reports for the account and uses the larger.
      </p>
    </div>
    <QueryState
      :loading="spend.isLoading.value"
      :error="spend.error.value"
      error-text="Could not load the spend so far."
      :retrying="spend.isFetching.value"
      @retry="spend.refetch()"
    >
      <div v-if="view" class="space-y-5">
        <p v-if="view.platforms.length === 0" class="text-sm text-ink-muted">No ad account is connected, so nothing has spent.</p>
        <ul v-else class="divide-y divide-edge-subtle">
          <li v-for="p in view.platforms" :key="p.platform" class="py-2" :data-platform="p.platform">
            <p class="text-sm text-ink"><span class="font-medium">{{ PLATFORM[p.platform] }}:</span> {{ platformLine(p, view.days_left).spent }}</p>
            <p :class="['text-sm', TONE[platformLine(p, view.days_left).tone]]">{{ platformLine(p, view.days_left).forecast }}</p>
          </li>
        </ul>

        <DataTable v-if="view.platforms.length > 0" :columns="columns" :rows="rows" row-key="id" dense embedded empty-text="No campaign has reached a platform yet." />

        <div class="space-y-1 text-sm">
          <p :class="TONE[budgetLine(view.ai.tokens_used, view.ai.tokens_budget, 'AI tokens').tone]">
            {{ budgetLine(view.ai.tokens_used, view.ai.tokens_budget, "AI tokens").text }}
          </p>
          <p :class="TONE[budgetLine(view.ai.credits_used, view.ai.credits_budget, 'picture credits').tone]">
            {{ budgetLine(view.ai.credits_used, view.ai.credits_budget, "picture credits").text }}
          </p>
          <p v-for="r in view.reconcile" :key="r.connection_id" :class="TONE[reconcileLine(r, formatDateTime).tone]" data-reconcile>
            {{ reconcileLine(r, formatDateTime).text }}
          </p>
        </div>
      </div>
    </QueryState>
  </BaseCard>
</template>
