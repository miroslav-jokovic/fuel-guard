<script setup lang="ts">
import { computed } from "vue";
import { modesOf, OPENING_BRIEF_SOURCE, openingsAwaitingCampaign } from "@silvicom/shared";
import {
  AppCard as BaseCard, DataTable, QueryState, StatCard, TablePagination, useQueryState, type DataTableColumn,
} from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import AdsTabs from "@/features/ads/AdsTabs.vue";
import { LEDGER_STATUS, NEEDS_TONE, ledgerWhat, needsYouLink } from "@/features/ads/adsOverviewWords";
import { count, usd } from "@/features/ads/spendLines";
import { useAdsOverview } from "@/features/ads/useAdsOverview";
import { useAdsTabs } from "@/features/ads/useAdsTabs";
import { useAdsCampaigns } from "@/features/ads/useAdsCampaigns";
import { useAdsSettings } from "@/features/ads/useAdsSettings";
import { useOpenOpeningsQuery } from "@/features/recruitment/useLeads";
import { useSessionStore } from "@/stores/session";

/**
 * Ads › Overview (ADS-PLATFORM-V2-PLAN V6; Q-APX18 (a)): the workspace's home. What the ads are doing this month,
 * what is waiting on a person, and every act they took — all from `GET /api/ads/overview`, which reads the guard's
 * own folds, so a figure here and a refused launch cannot disagree.
 *
 * ── THE LEDGER IS ADDRESSED BY ITS CURSOR ─────────────────────────────────────────────────────────────
 * As the Audit log is (D-US12): `?before=` is the page below a row, `?after=` the page above one, neither is the
 * newest. A link to what the office saw reopens the same rows next week; a page number would not, because the log
 * grows at its newest end.
 */
const qs = useQueryState();
const before = qs.param("before");
const after = qs.param("after");
const position = computed(() => (before.value ? { before: before.value } : after.value ? { after: after.value } : {}));
const overview = useAdsOverview(position);
const view = computed(() => overview.data.value);
const { canOpenSettings } = useAdsTabs();

/**
 * Assisted start (V5 part 3): with the mode at Assisted, each open opening with no campaign waits on a person here,
 * linked to the Campaigns page's form with it chosen (`?start=`). Read on this page, from recruiting's openings and
 * the ads' own campaign list, because one feature may not reach into another; the rule is shared's
 * (`openingsAwaitingCampaign`), so this list and the Campaigns page's cannot differ.
 */
const session = useSessionStore();
const settings = useAdsSettings();
const openings = useOpenOpeningsQuery();
const campaignList = useAdsCampaigns();
const awaiting = computed(() => {
  const s = settings.data.value;
  if (!s || modesOf(s.settings).start_campaign !== "assisted" || !session.can("recruitment") || !openings.data.value || !campaignList.data.value) return [];
  return openingsAwaitingCampaign(openings.data.value, campaignList.data.value, OPENING_BRIEF_SOURCE) ?? [];
});

const totals = computed(() => view.value?.totals);
const entries = computed(() => view.value?.ledger.entries ?? []);
const span = computed(() => {
  const rows = entries.value;
  if (!rows.length) return null;
  const newest = formatDateTime(rows[0]!.started_at);
  const oldest = formatDateTime(rows.at(-1)!.started_at);
  return newest === oldest ? newest : `${oldest} – ${newest}`;
});
const pager = computed(() => ({ span: span.value, hasNewer: Boolean(view.value?.ledger.newer), hasOlder: Boolean(view.value?.ledger.older) }));
const toNewest = () => qs.set({ before: undefined, after: undefined });
const toNewer = () => qs.set({ before: undefined, after: view.value?.ledger.newer ?? undefined });
const toOlder = () => qs.set({ after: undefined, before: view.value?.ledger.older ?? undefined });

const columns: DataTableColumn[] = [
  { key: "started_at", label: "When", width: "lg", cellClass: "text-ink-muted" },
  { key: "what", label: "What" },
  { key: "campaign_name", label: "Campaign" },
  { key: "actor_name", label: "By" },
  { key: "status", label: "Outcome" },
];
const rows = computed(() => entries.value.map((e) => ({ ...e, what: ledgerWhat(e) })));
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What the ads are doing this month, what is waiting on you, and every act they have taken." />
    <AdsTabs />
    <QueryState
      :loading="overview.isLoading.value"
      :error="overview.error.value"
      error-text="Could not load the ads overview."
      :retrying="overview.isFetching.value"
      @retry="overview.refetch()"
    >
      <div v-if="view && totals" class="space-y-6">
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <!-- ui-adoption: stat-guarded — the whole row waits on the one read above, inside its QueryState. -->
          <StatCard label="Running" :value="count(totals.running)" sub="campaigns live or launching" />
          <StatCard label="Spent this month" :value="usd(totals.month_spend_cents)" sub="from our hourly pull" />
          <StatCard label="Leads this month" :value="count(totals.month_leads)" sub="as the platform counts them" />
          <StatCard label="Per lead" :value="totals.month_cost_per_lead_cents === null ? '—' : usd(totals.month_cost_per_lead_cents)" sub="this month" />
        </div>
        <p class="text-sm text-ink-muted">
          The leads here are the ones the platform reports for our ads. The people themselves are on
          <RouterLink to="/recruitment/leads" class="font-medium text-ink hover:underline">Recruitment › Leads</RouterLink>.
        </p>

        <BaseCard as="section" class="space-y-3" data-test="needs-you">
          <h2 class="text-sm font-semibold text-ink">Needs you</h2>
          <p v-if="view.needs_you.length === 0 && awaiting.length === 0" class="text-sm text-ink-muted">Nothing is waiting on you.</p>
          <ul v-else class="divide-y divide-edge-subtle">
            <li v-for="o in awaiting" :key="`opening:${o.value}`" class="flex flex-wrap items-start justify-between gap-2 py-3" data-test="needs-opening">
              <div class="min-w-0 space-y-1">
                <p class="text-sm font-medium text-ink"><span :class="[BADGE_BASE, toneClass('warning'), 'mr-2']">Waiting</span>{{ o.label }} has no campaign</p>
                <p class="text-sm text-ink-muted">The form is filled in; nothing starts until you press Start.</p>
              </div>
              <RouterLink :to="{ path: '/ads/campaigns', query: { start: o.value } }" class="text-sm font-medium text-ink hover:underline">Start it</RouterLink>
            </li>
            <li v-for="(item, i) in view.needs_you" :key="`${item.kind}:${item.campaign_id ?? item.connection_id ?? i}`" class="flex flex-wrap items-start justify-between gap-2 py-3">
              <div class="min-w-0 space-y-1">
                <p class="text-sm font-medium text-ink">
                  <span :class="[BADGE_BASE, toneClass(NEEDS_TONE[item.tone]), 'mr-2']">{{ item.tone === "bad" ? "Stopped" : "Waiting" }}</span>{{ item.title }}
                </p>
                <p class="text-sm text-ink-muted">{{ item.detail }}<template v-if="item.since"> · since {{ formatDateTime(item.since) }}</template></p>
              </div>
              <RouterLink v-if="needsYouLink(item, canOpenSettings)" :to="needsYouLink(item, canOpenSettings)!" class="text-sm font-medium text-ink hover:underline">Open</RouterLink>
            </li>
          </ul>
        </BaseCard>

        <section class="space-y-2">
          <h2 class="text-sm font-semibold text-ink">What the ads did</h2>
          <DataTable
            :columns="columns"
            :rows="rows"
            row-key="id"
            :loading="overview.isFetching.value && !view"
            empty-text="Nothing has happened yet."
          >
            <template #cell-started_at="{ value }">{{ formatDateTime(value) }}</template>
            <template #cell-campaign_name="{ value }">{{ value ?? "—" }}</template>
            <template #cell-status="{ row }">
              <span :class="[BADGE_BASE, toneClass(LEDGER_STATUS[row.status as keyof typeof LEDGER_STATUS].tone)]" :title="row.error_code ?? row.cause ?? undefined">
                {{ LEDGER_STATUS[row.status as keyof typeof LEDGER_STATUS].label }}
              </span>
            </template>
            <template #footer>
              <TablePagination
                v-if="rows.length > 0 || before || after"
                :total="null"
                :log="pager"
                :loading="overview.isFetching.value"
                @newest="toNewest"
                @newer="toNewer"
                @older="toOlder"
              />
            </template>
          </DataTable>
        </section>
      </div>
    </QueryState>
  </div>
</template>
