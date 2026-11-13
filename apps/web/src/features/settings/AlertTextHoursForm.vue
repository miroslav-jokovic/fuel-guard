<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { alertTextClock, alertTextClockMinutes, alertTextClockValue, alertTextQuietSchema, type AlertTextQuiet } from "@silvicom/shared";
import { AppButton as BaseButton, AppCard as BaseCard, AppFormField as FormField, AppInput as BaseInput } from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import { useSaveAlertTextHours } from "./useAlertRouting";

/**
 * The hours an alert text waits (HOME-TIME-PLAN D-HT18): between the two times, on the carrier's clock, a
 * text is held and sent when the window ends. The dashboard and email are never held.
 */
const props = defineProps<{ quiet: AlertTextQuiet }>();
const save = useSaveAlertTextHours();
const toast = useToastStore();
const form = reactive({ start: "", end: "" });

watch(
  () => props.quiet,
  (q) => {
    form.start = alertTextClockValue(q.startMin);
    form.end = alertTextClockValue(q.endMin);
  },
  { immediate: true },
);

const parsed = computed(() => alertTextQuietSchema.safeParse({ startMin: alertTextClockMinutes(form.start) ?? -1, endMin: alertTextClockMinutes(form.end) ?? -1 }));
const changed = computed(() => form.start !== alertTextClockValue(props.quiet.startMin) || form.end !== alertTextClockValue(props.quiet.endMin));
const says = computed(() => (parsed.value.success ? `A text due between ${alertTextClock(parsed.value.data.startMin)} and ${alertTextClock(parsed.value.data.endMin)} is sent at ${alertTextClock(parsed.value.data.endMin)}.` : "Choose two different times."));

async function onSave(): Promise<void> {
  if (!parsed.value.success) return;
  try {
    await save.mutateAsync(parsed.value.data);
    toast.success("Quiet hours saved");
  } catch (e) {
    toast.error("Could not save the quiet hours", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <BaseCard as="section">
    <form class="space-y-4" data-testid="alert-text-hours" @submit.prevent="onSave">
      <div>
        <h3 class="text-sm font-semibold text-ink">Quiet hours for texts</h3>
        <p class="mt-1 text-xs text-ink-muted">On the company's clock. Only texts wait; the dashboard and email are told at once.</p>
      </div>
      <div class="grid max-w-md grid-cols-2 gap-4">
        <FormField v-slot="{ id }" label="No texts from">
          <BaseInput :id="id" v-model="form.start" type="time" :invalid="!parsed.success" />
        </FormField>
        <FormField v-slot="{ id }" label="Until">
          <BaseInput :id="id" v-model="form.end" type="time" :invalid="!parsed.success" />
        </FormField>
      </div>
      <p class="text-xs" :class="parsed.success ? 'text-ink-muted' : 'text-danger-700'" :role="parsed.success ? undefined : 'alert'">{{ says }}</p>
      <BaseButton variant="primary" type="submit" :disabled="!changed || !parsed.success || save.isPending.value">
        {{ save.isPending.value ? "Saving…" : "Save quiet hours" }}
      </BaseButton>
    </form>
  </BaseCard>
</template>
