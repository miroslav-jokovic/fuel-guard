<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { modesOf, OPENING_BRIEF_SOURCE, openingsAwaitingCampaign } from "@silvicom/shared";
import { useRoute } from "vue-router";
import { AppButton as BaseButton, AppCard, DataTable, DataWorkspace, FilterBar, useQueryState, type DataTableColumn } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import AdsCampaignCreateDrawer from "@/features/ads/AdsCampaignCreateDrawer.vue";
import AdsCampaignDrawer from "@/features/ads/AdsCampaignDrawer.vue";
import AdsTabs from "@/features/ads/AdsTabs.vue";
import { CAMPAIGN_STATE_LABEL, CAMPAIGN_STATE_TONE } from "@/features/ads/adsCampaignFlow";
import { useAdsCampaigns } from "@/features/ads/useAdsCampaigns";
import { useAdsSettings } from "@/features/ads/useAdsSettings";
import { useOpenOpeningsQuery } from "@/features/recruitment/useLeads";
import { useSessionStore } from "@/stores/session";

/**
 * Ad campaigns (E3): the recruiting ads agent's work, newest first. A tab of the Ads workspace since 2026-11-18
 * (Q-APX18 (a)); it was Recruitment's seventh tab, and `/recruitment/campaigns` redirects here with its `?campaign=`.
 * The campaign doors answer to the `recruitment` section. Reviewing and launching happen in the
 * row's drawer, with the open campaign in the URL (as Leads keeps its lead), so a notification can link to one.
 *
 * The openings are asked for here, the page, because one feature may not reach into another (`lint:boundaries`).
 */
const route = useRoute();
const qs = useQueryState();
const session = useSessionStore();
const campaigns = useAdsCampaigns();
const canManage = computed(() => session.can("recruitment"));
const openings = useOpenOpeningsQuery();
const openingOptions = computed(() => openings.data.value ?? []);

const open = qs.param("campaign");
const openId = computed(() => open.value ?? "");
const creating = ref(false);
function created(id: string): void {
  creating.value = false;
  start.value = "";
  open.value = id;
}

/**
 * Assisted start (V5 part 3; Q-APX21 (a)): with the carrier's mode at Assisted, every open opening with no campaign is
 * listed here, and Start opens the form with it chosen. Nothing is created until the person presses Start in the form
 * (`ADS_AUTHORITY.start_campaign` is a person's in both modes). `?start=` is the opening the Overview's "Needs you"
 * links to, so the one place a campaign is started is this page's form. A list the door may have cut off offers
 * nothing (`openingsAwaitingCampaign` answers null) rather than an opening that may already have a campaign.
 */
const settings = useAdsSettings();
const assisted = computed(() => Boolean(settings.data.value && modesOf(settings.data.value.settings).start_campaign === "assisted"));
const awaiting = computed(() => {
  if (!assisted.value || !canManage.value || !openings.data.value || !campaigns.data.value) return null;
  return openingsAwaitingCampaign(openingOptions.value, campaigns.data.value, OPENING_BRIEF_SOURCE);
});
const start = qs.param("start");
const startWith = computed(() => (start.value && openingOptions.value.some((o) => o.value === start.value) ? start.value : null));
watch(startWith, (s) => { if (s && canManage.value) creating.value = true; }, { immediate: true });
function startFor(opening: string): void {
  start.value = opening;
  creating.value = true;
}
function closeCreate(): void {
  creating.value = false;
  start.value = "";
}

const columns: DataTableColumn[] = [
  { key: "name", label: "Campaign" },
  { key: "state", label: "Where it is" },
  { key: "changed", label: "Last change" },
];
const linkTo = (id: string) => ({ query: { ...route.query, campaign: id } });
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Ads the agent has made for your openings. A person approves every ad, and only an admin launches." />
    <AdsTabs />
    <AppCard v-if="awaiting && awaiting.length > 0" as="section" class="space-y-2" data-test="awaiting-openings">
      <h2 class="text-sm font-semibold text-ink">Openings with no campaign</h2>
      <p class="text-sm text-ink-muted">The form is filled in for you. Nothing starts until you press Start in it.</p>
      <ul class="divide-y divide-edge-subtle">
        <li v-for="o in awaiting" :key="o.value" class="flex items-center justify-between gap-3 py-2" data-test="awaiting-opening">
          <span class="text-sm text-ink">{{ o.label }}</span>
          <BaseButton :data-test="`start-${o.value}`" @click="startFor(o.value)">Start</BaseButton>
        </li>
      </ul>
    </AppCard>
    <DataWorkspace>
      <FilterBar>
        <template #actions>
          <BaseButton v-if="canManage" variant="primary" data-test="new-campaign" @click="creating = true">New campaign</BaseButton>
        </template>
      </FilterBar>
      <!-- ui-adoption: unpaged — the door answers a carrier's newest 200 campaigns (CAMPAIGN_LIST_LIMIT) in one read. -->
      <DataTable
        :columns="columns"
        :rows="campaigns.data.value ?? []"
        embedded
        row-key="id"
        :loading="campaigns.isLoading.value"
        :error="campaigns.isError.value ? 'Could not load the campaigns.' : null"
        :retrying="campaigns.isFetching.value"
        empty-text="No campaigns yet."
      >
        <template #cell-name="{ row }">
          <RouterLink :to="linkTo(row.id)" class="font-medium text-ink hover:underline">{{ row.name }}</RouterLink>
        </template>
        <template #cell-state="{ row }">
          <span :class="[BADGE_BASE, toneClass(CAMPAIGN_STATE_TONE[row.state as keyof typeof CAMPAIGN_STATE_TONE])]">{{ CAMPAIGN_STATE_LABEL[row.state as keyof typeof CAMPAIGN_STATE_LABEL] }}</span>
        </template>
        <template #cell-changed="{ row }">{{ formatDateTime(row.state_changed_at) }}</template>
      </DataTable>
    </DataWorkspace>
    <AdsCampaignDrawer :campaign-id="openId" @close="open = ''" />
    <AdsCampaignCreateDrawer :open="creating" :openings="openingOptions" :offered="startWith" @close="closeCreate" @created="created" />
  </div>
</template>
