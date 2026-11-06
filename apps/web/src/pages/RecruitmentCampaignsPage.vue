<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { AppButton as BaseButton, DataTable, DataWorkspace, FilterBar, useQueryState, type DataTableColumn } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import AdsCampaignCreateDrawer from "@/features/ads/AdsCampaignCreateDrawer.vue";
import AdsCampaignDrawer from "@/features/ads/AdsCampaignDrawer.vue";
import { CAMPAIGN_STATE_LABEL, CAMPAIGN_STATE_TONE } from "@/features/ads/adsCampaignFlow";
import { useAdsCampaigns } from "@/features/ads/useAdsCampaigns";
import RecruitmentTabs from "@/features/recruitment/RecruitmentTabs.vue";
import { useOpenOpeningsQuery } from "@/features/recruitment/useLeads";
import { useSessionStore } from "@/stores/session";

/**
 * Ad campaigns (E3): the recruiting ads agent's work, newest first. A tab beside Leads, because a campaign is how a
 * lead arrives, and the campaign doors answer to the `recruitment` section. Reviewing and launching happen in the
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
  open.value = id;
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
    <RecruitmentTabs />
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
    <AdsCampaignCreateDrawer :open="creating" :openings="openingOptions" @close="creating = false" @created="created" />
  </div>
</template>
