<script setup lang="ts">
import { QueryState } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import AdsKillSwitchCard from "@/features/ads/AdsKillSwitchCard.vue";
import AdsSettingsForm from "@/features/ads/AdsSettingsForm.vue";
import { useAdsSettings } from "@/features/ads/useAdsSettings";

/**
 * Settings › Ads control (ADS-AGENT-PLAN §4b; ADS-AGENT-BUILD-WORKFLOW E1). The recruiting ads agent's
 * limits, automatic pauses, approvals, AI budgets and kill switch, on one page.
 *
 * ── WHO REACHES IT ────────────────────────────────────────────────────────────────────────────
 * The catalogue's `admin.recruiting.ads`, `section("recruitment")`, as Settings › Recruiting is: anyone
 * who can view recruiting reads it (plan §4b, "readable by recruiters"); writes are the API's to refuse
 * and the page's to hide by the same rules — saving and clearing the switch are an admin's, freshly
 * signed in; pressing the switch is anyone who manages recruiting.
 *
 * ── STILL TO COME (E1b, E1c) ──────────────────────────────────────────────────────────────────
 * Who hears each alert and the platform connections with their test are E1b; spend so far against the
 * caps (the D-AD5 fold) is E1c, which needs its own read.
 */
const settings = useAdsSettings();
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="How much the ads may spend, when they pause themselves, and the switch that stops them all." />
    <QueryState
      :loading="settings.isLoading.value"
      :error="settings.error.value"
      error-text="Could not load the ads settings."
      :retrying="settings.isFetching.value"
      @retry="settings.refetch()"
    >
      <div v-if="settings.data.value" class="space-y-6">
        <AdsKillSwitchCard :view="settings.data.value" />
        <AdsSettingsForm :view="settings.data.value" />
      </div>
    </QueryState>
  </div>
</template>
