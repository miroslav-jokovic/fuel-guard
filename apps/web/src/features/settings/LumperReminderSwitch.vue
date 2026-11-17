<script setup lang="ts">
import { computed } from "vue";
import { formatDisplayDate, formatDisplayDateTime } from "@silvicom/shared";
import { AppCard as BaseCard, AppSwitch, QueryState } from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import { useLumperReminderStatus, useSaveLumperReminders } from "./useAlertRouting";

/**
 * The daily lumper reminder's switch (LUMPER-REVISED-RC-PLAN D-LRC9). It starts OFF: two weeks of the
 * Lumper fees list running silent, compared each day with what billing did, before anybody is reminded.
 * The words say that, so the switch is not read as a setting somebody forgot.
 */
const status = useLumperReminderStatus();
const save = useSaveLumperReminders();
const toast = useToastStore();

const on = computed(() => status.data.value?.remindersOn === true);
const who = computed(() => {
  const s = status.data.value;
  if (!s?.updatedAt) return "Never switched on. The list on Dispatch › Lumper fees runs without reminders until it is.";
  return `${s.remindersOn ? "Switched on" : "Switched off"} ${formatDisplayDateTime(s.updatedAt)}${s.updatedByName ? ` by ${s.updatedByName}` : ""}.`;
});
const lastRun = computed(() => {
  const r = status.data.value?.lastRun;
  if (!r) return null;
  return `Last sent ${formatDisplayDate(r.runOn)}: ${r.cases ?? 0} load(s), ${r.bells ?? 0} dashboard item(s), ${r.emails ?? 0} email(s), ${r.texts ?? 0} text(s).`;
});

async function onToggle(next: boolean): Promise<void> {
  try {
    await save.mutateAsync(next);
    toast.success(next ? "Lumper reminders switched on" : "Lumper reminders switched off");
  } catch (e) {
    toast.error("Could not save the lumper reminder setting", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <QueryState
    :loading="status.isLoading.value"
    :error="status.isError.value ? status.error.value : null"
    :retrying="status.isFetching.value"
    loading-text="Loading the lumper reminder setting…"
    error-text="Could not load the lumper reminder setting."
    @retry="status.refetch()"
  >
    <BaseCard as="section" data-testid="lumper-reminder-switch">
      <div class="flex items-start justify-between gap-4">
        <div class="space-y-1">
          <h3 class="text-sm font-semibold text-ink">Send the daily reminder</h3>
          <p class="text-sm text-ink-muted">
            Weekdays at 8:00, one message per person listing their loads. Leave it off for the first two weeks after McLeod starts sending lumper data, and check the Lumper fees list against what billing did each day.
          </p>
          <p class="text-xs text-ink-muted" data-testid="lumper-reminder-who">{{ who }}</p>
          <p v-if="lastRun" class="text-xs text-ink-muted" data-testid="lumper-reminder-last">{{ lastRun }}</p>
        </div>
        <AppSwitch :model-value="on" label="Send the daily lumper reminder" :disabled="save.isPending.value" @update:model-value="onToggle" />
      </div>
    </BaseCard>
  </QueryState>
</template>
