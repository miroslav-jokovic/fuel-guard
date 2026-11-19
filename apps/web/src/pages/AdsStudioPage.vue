<script setup lang="ts">
import PageHeader from "@/components/ui/PageHeader.vue";
import AdsBrandKitCard from "@/features/ads/AdsBrandKitCard.vue";
import AdsPresetCard from "@/features/ads/AdsPresetCard.vue";
import AdsSwipeCard from "@/features/ads/AdsSwipeCard.vue";
import AdsTabs from "@/features/ads/AdsTabs.vue";

/**
 * Ads › Creative studio (ADS-PLATFORM-V2-PLAN V6; Q-APX18 (a)): what an ad is made FROM — the brand kit, the
 * concepts, and the swipe file the Researcher reads (V2r). The first two lived on Settings › Ads control until
 * 2026-11-18. Each card reads and gates itself: the doors behind them are the API's to refuse and the cards' to hide.
 */
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What every ad is made from: your brand, the concepts the agent may use, and the competitors' ads it learns from." />
    <AdsTabs />
    <AdsBrandKitCard />
    <AdsPresetCard />
    <AdsSwipeCard />
  </div>
</template>
