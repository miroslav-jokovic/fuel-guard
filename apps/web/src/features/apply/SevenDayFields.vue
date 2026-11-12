<script setup lang="ts">
import { computed } from "vue";
import { AppFormField as FormField, AppInput as BaseInput } from "@silvicom/ui";
import { formatDisplayDayShort, sevenDayTotal, sevenDayWindow } from "@silvicom/shared";
import type { ApplicationDraft } from "@/features/apply/draft";
import { sevenDayHours } from "@/features/apply/draft";
import ApplyField from "@/features/apply/ApplyField.vue";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * Page 21, the seven-day work statement, at signing (Q-AM4, owner 2026-11-11).
 *
 * Seven boxes, each named by its day: the seven before `today`, oldest first — the window the packet
 * prints (`sevenDayWindow` of the signing day), so what the driver types under "Mon 11/09" is what page
 * 21 prints under 11/09. Then when they were last off duty, as a local date and time (the paper's
 * "____ at ____ am/pm"). Autosaved like every answer once whole (`toDraftPayload`); the office may have
 * filled it in already, "most of the time … all zeros", and the driver sees and keeps or changes it.
 */
const draft = defineModel<ApplicationDraft>({ required: true });
const props = defineProps<{ today: string }>();
const copy = APPLY_COPY.signOff.sevenDay;

const days = computed(() => sevenDayWindow(props.today));
const total = computed(() => {
  const hours = sevenDayHours(draft.value.seven_day_hours);
  return hours ? sevenDayTotal(hours.map((h, i) => ({ date: days.value[i]!, hours: h }))) : null;
});
</script>

<template>
  <section class="space-y-3" data-seven-day>
    <div>
      <h3 class="text-sm font-semibold text-ink">{{ copy.heading }}</h3>
      <p class="mt-1 text-sm text-ink-muted">{{ copy.intro }}</p>
    </div>
    <!-- No label of its own: the heading above names it. Here for the issue anchor (`seven_day_hours`). -->
    <ApplyField v-slot="f" :path="['seven_day_hours']">
      <div :id="f.id" class="grid grid-cols-4 gap-2 sm:grid-cols-7">
        <FormField
          v-for="(day, i) in days"
          :id="`seven-day-${i}`"
          :key="day"
          :label="formatDisplayDayShort(day, day)"
        >
          <template #default="g">
            <BaseInput
              v-bind="g"
              v-model="draft.seven_day_hours[i]"
              inputmode="decimal"
              autocomplete="off"
              :aria-label="copy.day(formatDisplayDayShort(day, day))"
            />
          </template>
        </FormField>
      </div>
    </ApplyField>
    <p v-if="total !== null" class="text-sm text-ink-muted" data-seven-day-total>{{ copy.total(String(total)) }}</p>
    <ApplyField v-slot="f" :path="['last_relieved_at']" :label="copy.relieved" :hint="copy.relievedHint">
      <BaseInput v-bind="f" v-model="draft.last_relieved_at" type="datetime-local" />
    </ApplyField>
  </section>
</template>
