<script setup lang="ts">
import { computed } from "vue";
import { QueryState } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { myAlertLines } from "./myAlertsWords";
import { useMyAlerts } from "./useAlertRouting";
import { useMyAlertsPanel } from "./useMyAlertsPanel";

/**
 * "My alerts", from the account menu (HOME-TIME-PLAN D-HT17): what the signed-in person receives, read
 * only. Who is told is the carrier's decision, made in Settings, Notifications; a person's own control
 * is the bell's mute. Text alerts and confirming a mobile number arrive with the text step (HT6).
 */
const panel = useMyAlertsPanel();
const mine = useMyAlerts(panel.open);
const alerts = computed(() => (mine.data.value?.alerts ?? []).map((a) => ({ ...a, lines: myAlertLines(a) })));
</script>

<template>
  <SlideOver :open="panel.open.value" title="My alerts" description="What Silvicom 360 tells you, and how." @close="panel.close()">
    <QueryState
      :loading="mine.isLoading.value"
      :error="mine.isError.value ? mine.error.value : null"
      :retrying="mine.isFetching.value"
      loading-text="Loading your alerts…"
      error-text="Could not load your alerts."
      @retry="mine.refetch()"
    >
      <p v-if="alerts.length === 0" class="text-sm text-ink-muted" data-testid="my-alerts-empty">
        None of the alerts your company routes is about a page you can open.
      </p>
      <ul v-else class="space-y-4" data-testid="my-alerts">
        <li v-for="a in alerts" :key="a.key">
          <p class="text-sm font-semibold text-ink">{{ a.label }}</p>
          <p class="mt-0.5 text-xs text-ink-muted">{{ a.description }}</p>
          <p v-if="a.lines.length === 0" class="mt-1 text-sm text-ink-secondary">You are not told about this one.</p>
          <p v-for="line in a.lines" :key="line" class="mt-1 text-sm text-ink-secondary">{{ line }}</p>
        </li>
      </ul>
      <p class="mt-6 text-xs text-ink-muted">
        An admin chooses who is told in Settings, Notifications. To stop an alert for yourself, mute it from the bell.
      </p>
    </QueryState>
  </SlideOver>
</template>
