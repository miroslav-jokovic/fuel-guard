<script setup lang="ts">
import { computed } from "vue";
import type { HomeTimeState } from "@silvicom/shared";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { homeTimeStatusWords } from "./homeTimeView";
import { useHomeTimeDrawer } from "./useHomeTimeDrawer";

/**
 * A driver's home time in one badge (HOME-TIME-VISIBILITY-PLAN D-HT21, D-HT25): "Home time from 11/26",
 * "Home until 11/24", "Overdue since 11/24" in red. The badge IS the way in — it opens the home-time
 * drawer on that driver, where the period is changed, ended or canceled — so the status is never more
 * than one click from its undo. The page it sits on mounts the one `HomeTimeDrawer`.
 *
 * `.stop`: it sits inside clickable rows, which open something else.
 */
const props = defineProps<{
  period: { driverId: string; driverName?: string; state: HomeTimeState; startAt: string; expectedReturnAt: string };
  zone: string;
}>();
const drawer = useHomeTimeDrawer();
const words = computed(() => homeTimeStatusWords(props.period, props.zone));
</script>

<template>
  <button
    v-if="words"
    type="button"
    :class="[BADGE_BASE, toneClass(words.tone), 'cursor-pointer whitespace-nowrap hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring']"
    :title="`${words.title}. Open to change, end or cancel.`"
    :aria-label="`${period.driverName ? `${period.driverName}: ` : ''}${words.title}. Open home time`"
    data-home-time-badge
    @click.stop="drawer.open(period.driverId)"
  >
    {{ words.label }}
  </button>
</template>
