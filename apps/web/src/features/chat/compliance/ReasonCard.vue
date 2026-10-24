<script setup lang="ts">
import { computed } from "vue";
import {
  CHAT_COMPLIANCE_REASONS,
  CHAT_COMPLIANCE_REASON_LABELS,
  CHAT_COMPLIANCE_REASON_MAX,
  CHAT_COMPLIANCE_REASON_MIN,
} from "@silvicom/shared";
import { AppCard as BaseCard, AppFormField as FormField, AppSelect as BaseSelect, AppTextarea as BaseTextarea, type SelectOption } from "@silvicom/ui";

/**
 * The reason — given once, sent with every act (OFFICE-CHAT-PLAN §5.2). Nothing on the console
 * searches until it is complete, and the database refuses an act without one (CH009), so the
 * form is the convenience and the function is the rule.
 */
const category = defineModel<string | null>("category", { required: true });
const text = defineModel<string>("text", { required: true });

const options: SelectOption[] = CHAT_COMPLIANCE_REASONS.map((c) => ({ value: c, label: CHAT_COMPLIANCE_REASON_LABELS[c] }));
const length = computed(() => text.value.trim().length);
const hint = computed(() =>
  length.value === 0
    ? `At least ${CHAT_COMPLIANCE_REASON_MIN} characters. It is recorded with every search and every conversation you open.`
    : length.value < CHAT_COMPLIANCE_REASON_MIN
      ? `${CHAT_COMPLIANCE_REASON_MIN - length.value} more characters`
      : length.value > CHAT_COMPLIANCE_REASON_MAX
        ? `${length.value - CHAT_COMPLIANCE_REASON_MAX} characters too long`
        : "Recorded with every search and every conversation you open.",
);
</script>

<template>
  <BaseCard>
    <h2 class="text-sm font-semibold text-ink">Why are you looking?</h2>
    <p class="mt-1 text-sm text-ink-muted">
      Every search and every conversation you open is written into the chat record with this reason, your name and the
      time, and shows in the Access log for every other holder of this permission.
    </p>
    <div class="mt-4 grid gap-4 md:grid-cols-[14rem_1fr]">
      <FormField label="Matter" required>
        <BaseSelect v-model="category" :options="options" placeholder="Choose the kind of matter" aria-label="Kind of matter" />
      </FormField>
      <FormField label="Reason" required :hint="hint">
        <BaseTextarea v-model="text" :rows="2" aria-label="Reason" placeholder="Case or ticket, and what you are looking for" />
      </FormField>
    </div>
  </BaseCard>
</template>
