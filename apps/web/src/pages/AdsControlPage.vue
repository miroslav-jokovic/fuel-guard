<script setup lang="ts">
import { computed } from "vue";
import { QueryState } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import AdsBrandKitCard from "@/features/ads/AdsBrandKitCard.vue";
import AdsConnectionsCard from "@/features/ads/AdsConnectionsCard.vue";
import AdsKillSwitchCard from "@/features/ads/AdsKillSwitchCard.vue";
import AdsSettingsForm from "@/features/ads/AdsSettingsForm.vue";
import AdsSpendCard from "@/features/ads/AdsSpendCard.vue";
import { useAdsSettings } from "@/features/ads/useAdsSettings";
import { useMembersQuery } from "@/features/permissions/usePermissions";
import { useSessionStore } from "@/stores/session";

/**
 * Settings › Ads control (ADS-AGENT-PLAN §4b; ADS-AGENT-BUILD-WORKFLOW E1). The recruiting ads agent's
 * limits, automatic pauses, approvals, AI budgets, alerts, ad accounts, spend so far and kill switch, on one page.
 *
 * ── WHO REACHES IT ────────────────────────────────────────────────────────────────────────────
 * The catalogue's `admin.recruiting.ads`, `section("recruitment")`, as Settings › Recruiting is: anyone
 * who can view recruiting reads it (plan §4b, "readable by recruiters"); writes are the API's to refuse
 * and the page's to hide by the same rules — saving, clearing the switch and every ad-account act are an
 * admin's; pressing the switch is anyone who manages recruiting.
 *
 * ── THE PEOPLE LIST (E1b) ─────────────────────────────────────────────────────────────────────
 * Who hears each alert is chosen from the Users page's own read (`useMembersQuery`, `GET /api/members`),
 * asked here — the page, not the ads feature, because one feature may not reach into another
 * (`lint:boundaries`). That read is admin-only at the API, so it is asked only for an admin: anyone else
 * would get a 403 for a list the alerts section then shows only as a count.
 *
 * ── SPEND SO FAR (E1c) ────────────────────────────────────────────────────────────────────────
 * Its own read (`GET /api/ads/spend`), placed under the kill switch: the question someone opening this page
 * in a hurry asks is "how much has gone out", and the answer sits beside the brake.
 */
const session = useSessionStore();
const settings = useAdsSettings();
const members = session.admin ? useMembersQuery() : null;
const memberList = computed(() => members?.data.value ?? null);
const membersFailed = computed(() => Boolean(members?.error.value));
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="How much the ads may spend, when they pause themselves, who hears about it, and the switch that stops them all." />
    <QueryState
      :loading="settings.isLoading.value"
      :error="settings.error.value"
      error-text="Could not load the ads settings."
      :retrying="settings.isFetching.value"
      @retry="settings.refetch()"
    >
      <div v-if="settings.data.value" class="space-y-6">
        <AdsKillSwitchCard :view="settings.data.value" />
        <AdsSpendCard />
        <AdsConnectionsCard />
        <AdsBrandKitCard />
        <AdsSettingsForm :view="settings.data.value" :members="memberList" :members-failed="membersFailed" />
      </div>
    </QueryState>
  </div>
</template>
