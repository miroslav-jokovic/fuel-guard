<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  FOLLOW_UP_CATEGORIES,
  FOLLOW_UP_CATEGORY_LABELS,
  FOLLOW_UP_SEVERITIES,
  followUpRuleSaveSchema,
  type FollowUpCategory,
  type FollowUpRuleView,
  type FollowUpSeverity,
} from "@silvicom/shared";
import { AppButton, AppFormField, AppInput, AppSelect, AppSwitch } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { useSaveFollowUpRule } from "./useFollowUps";
import { ruleCountText } from "./followUpRows";

/**
 * One follow-up rule (D-WD10): on or off, the Nth time, the window, how long a state warning must last
 * (an open defect, an engine lamp), the category and how urgent. Saved whole — the database keeps only
 * this override; "Reset to default" on the card removes it.
 */
const props = defineProps<{ rule: FollowUpRuleView | null }>();
const emit = defineEmits<{ close: [] }>();
const save = useSaveFollowUpRule();
const toast = useToastStore();

const enabled = ref(true);
const count = ref("");
const days = ref("");
const hours = ref("");
const category = ref<FollowUpCategory>("maintenance");
const severity = ref<FollowUpSeverity>("normal");
const errors = ref<Record<string, string>>({});

watch(
  () => props.rule,
  (r) => {
    if (!r) return;
    enabled.value = r.enabled;
    count.value = String(r.thresholdCount);
    days.value = String(r.windowDays);
    hours.value = String(r.minActiveHours);
    category.value = r.category;
    severity.value = r.severity;
    errors.value = {};
  },
  { immediate: true },
);

const SEVERITY_WORDS: Record<FollowUpSeverity, string> = { urgent: "Urgent — rings the bell", high: "High", normal: "Normal" };
const categoryOptions = FOLLOW_UP_CATEGORIES.map((c) => ({ value: c, label: FOLLOW_UP_CATEGORY_LABELS[c] }));
const severityOptions = FOLLOW_UP_SEVERITIES.map((s) => ({ value: s, label: SEVERITY_WORDS[s] }));
const defaultsText = computed(() => (props.rule ? `${props.rule.defaults.enabled ? "On" : "Off"} · ${ruleCountText(props.rule.defaults)} · ${FOLLOW_UP_CATEGORY_LABELS[props.rule.defaults.category]}` : ""));

const MESSAGES: Record<string, string> = {
  thresholdCount: "A whole number from 1 to 50.",
  windowDays: "A whole number of days from 1 to 30.",
  minActiveHours: "A whole number of hours from 0 to 720.",
};

async function onSave() {
  if (!props.rule) return;
  const parsed = followUpRuleSaveSchema.safeParse({
    enabled: enabled.value,
    thresholdCount: Number(count.value),
    windowDays: Number(days.value),
    minActiveHours: Number(hours.value),
    category: category.value,
    severity: severity.value,
  });
  if (!parsed.success) {
    errors.value = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), MESSAGES[String(i.path[0])] ?? i.message]));
    return;
  }
  errors.value = {};
  try {
    await save.mutateAsync({ key: props.rule.key, rule: parsed.data });
    toast.success("Rule saved");
    emit("close");
  } catch (e) {
    toast.error("Could not save the rule", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="rule !== null" :title="rule?.label ?? 'Follow-up rule'" :description="`Default: ${defaultsText}`" @close="emit('close')">
    <form v-if="rule" class="space-y-4" @submit.prevent="onSave">
      <AppSwitch v-model="enabled" label="Open follow-ups for this warning" />
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AppFormField v-slot="{ id }" label="Open at this many times" :error="errors.thresholdCount">
          <AppInput :id="id" v-model="count" inputmode="numeric" class="w-28" :invalid="Boolean(errors.thresholdCount)" />
        </AppFormField>
        <AppFormField v-slot="{ id }" label="Within this many days" :error="errors.windowDays">
          <AppInput :id="id" v-model="days" inputmode="numeric" class="w-28" :invalid="Boolean(errors.windowDays)" />
        </AppFormField>
        <AppFormField v-slot="{ id }" label="Only once it has lasted (hours)" :error="errors.minActiveHours">
          <AppInput :id="id" v-model="hours" inputmode="numeric" class="w-28" :invalid="Boolean(errors.minActiveHours)" />
        </AppFormField>
      </div>
      <p class="text-xs text-ink-tertiary">
        "Only once it has lasted" is for a warning that stays on — an open defect, an engine lamp. 0 counts it the moment it happens.
      </p>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AppFormField v-slot="{ id }" label="Category">
          <AppSelect :id="id" v-model="category" :options="categoryOptions" />
        </AppFormField>
        <AppFormField v-slot="{ id }" label="How urgent">
          <AppSelect :id="id" v-model="severity" :options="severityOptions" />
        </AppFormField>
      </div>
      <p class="text-xs text-ink-tertiary">Route follow-ups are shown on the dispatchers' Route follow-ups page too.</p>
    </form>
    <template #footer>
      <div class="flex justify-end gap-3">
        <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
        <AppButton variant="primary" :disabled="save.isPending.value" @click="onSave">{{ save.isPending.value ? "Saving…" : "Save rule" }}</AppButton>
      </div>
    </template>
  </SlideOver>
</template>
