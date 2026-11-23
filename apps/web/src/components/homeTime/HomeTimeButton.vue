<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import HomeTimeBadge from "./HomeTimeBadge.vue";
import HomeTimeDrawer from "./HomeTimeDrawer.vue";
import { useCanMarkHomeTime, useHomeTimeVisible, useLiveHomeTimes } from "./useHomeTime";
import { useHomeTimeDrawer } from "./useHomeTimeDrawer";

/**
 * The driver page's home time (HOME-TIME-PLAN D-HT8, the third entry point; HOME-TIME-VISIBILITY-PLAN
 * D-HT24): the STATUS first — "Home until 11/24", "Overdue since 11/24" — then a button that says what it
 * does. Until 2026-11-23 it was one button reading "Home time" whether the driver was home, overdue or
 * working, so the page never said he was away.
 *
 * It owns the page's one `HomeTimeDrawer`, so a detail page adds a single tag. Renders nothing for
 * somebody who cannot view Dispatch, or on a carrier without the module (Q-HT9 (a)): the read would
 * answer them 403. A viewer who may read but not mark sees the badge and no button.
 */
const props = defineProps<{ driverId: string }>();
const { zone } = useOrgTimezone();
const drawer = useHomeTimeDrawer();
const on = useHomeTimeVisible();
const canMark = useCanMarkHomeTime();
const { byDriver } = useLiveHomeTimes(on);
const period = computed(() => byDriver.value.get(props.driverId) ?? null);
</script>

<template>
  <template v-if="on">
    <span v-if="period" class="inline-flex items-center" data-home-time-status>
      <HomeTimeBadge :period="period" :zone="zone" />
    </span>
    <BaseButton v-if="canMark || period" data-home-time-button @click="drawer.open(driverId)">
      {{ period ? (canMark ? "Change or end home time" : "Home time details") : "Mark home time" }}
    </BaseButton>
    <HomeTimeDrawer :zone="zone" />
  </template>
</template>
