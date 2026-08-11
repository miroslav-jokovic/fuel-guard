<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { performanceSettingsFormSchema, NORMALIZATION_METHODS, IDLE_SCORE_BASES, type PerformanceSettingsForm } from "@fuelguard/shared";
import { useDriverPerformanceSettings, useSaveDriverPerformanceSettings } from "@/features/drivers/useDriverPerformanceSettings";
import { useToastStore } from "@/stores/toast";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { AppInput as BaseInput } from "@fuelguard/ui";
import { AppCheckbox as BaseCheckbox } from "@fuelguard/ui";
import { AppSelect } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import PageHeader from "@/components/ui/PageHeader.vue";

const { data, isLoading } = useDriverPerformanceSettings();
const save = useSaveDriverPerformanceSettings();
const toast = useToastStore();

const form = reactive<Record<string, unknown>>({
  weight_safety: 0.5,
  weight_efficiency: 0.25,
  weight_idling: 0.25,
  normalization_method: "percentile",
  min_cohort_for_percentile: 20,
  min_distance_mi: 500,
  min_drive_hours: 10,
  reward_top_n: 3,
  trailing_weeks: 3,
  settle_hours: 96,
  efficiency_enabled: true,
  week_starts_on: 1,
  idle_score_basis: "intensity",
});

watch(data, (d) => { if (d) Object.assign(form, d); }, { immediate: true });

const fieldErr = ref<Record<string, string>>({});
async function onSave() {
  const result = performanceSettingsFormSchema.safeParse({ ...form });
  if (!result.success) {
    const m: Record<string, string> = {};
    for (const i of result.error.issues) {
      const k = i.path[0];
      if (typeof k === "string" && !m[k]) m[k] = i.message;
    }
    fieldErr.value = m;
    return;
  }
  fieldErr.value = {};
  try {
    await save.mutateAsync(result.data as PerformanceSettingsForm);
    toast.success("Driver performance settings saved");
  } catch (e) {
    toast.error("Could not save settings", e instanceof Error ? e.message : undefined);
  }
}

const weightFields = [
  { key: "weight_safety", label: "Safety weight" },
  { key: "weight_efficiency", label: "Efficiency weight" },
  { key: "weight_idling", label: "Idling weight" },
];
const gateFields = [
  { key: "min_distance_mi", label: "Min miles / week" },
  { key: "min_drive_hours", label: "Min drive-hours / week" },
  { key: "reward_top_n", label: "Winners per week" },
  { key: "trailing_weeks", label: "Trailing weeks" },
  { key: "settle_hours", label: "Settle delay (hours)" },
  { key: "min_cohort_for_percentile", label: "Min cohort for percentile" },
];
const normalizationOptions = NORMALIZATION_METHODS.map((value) => ({ value, label: value }));
const weekStartOptions = [
  { value: 1, label: "Monday" },
  { value: 0, label: "Sunday" },
];
const idleScoreOptions = IDLE_SCORE_BASES.map((value) => ({
  value,
  label: value === "intensity" ? "Intensity (money-aligned)" : "Share (discipline ratio)",
}));
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <PageHeader description="How drivers are graded and rewarded each week. Changes apply to future weeks and re-grade the current one." />
    <div v-if="isLoading" class="text-sm text-ink-muted">Loading…</div>
    <form v-else class="space-y-6" @submit.prevent="onSave">
      <BaseCard as="section">
        <h3 class="text-base font-semibold text-ink">Weights</h3>
        <p class="mt-1 text-xs text-ink-muted">Relative importance of each component (renormalized, so 0.5 / 0.25 / 0.25 and 2 / 1 / 1 behave the same).</p>
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField v-for="f in weightFields" :key="f.key" v-slot="{ id }" :label="f.label" :error="fieldErr[f.key]">
            <BaseInput :id="id" v-model="(form[f.key] as string)" inputmode="decimal" :invalid="Boolean(fieldErr[f.key])" />
          </FormField>
        </div>
      </BaseCard>

      <BaseCard as="section">
        <h3 class="text-base font-semibold text-ink">Method & eligibility</h3>
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="Normalization method">
            <AppSelect :id="id" v-model="(form.normalization_method as string)" :options="normalizationOptions" />
          </FormField>
          <FormField v-slot="{ id }" label="Week starts on">
            <AppSelect :id="id" v-model="(form.week_starts_on as number)" :options="weekStartOptions" />
          </FormField>
          <FormField v-slot="{ id }" label="Idle score basis" hint="Intensity = avoidable idle vs engine-on time (money-aligned). Share = avoidable vs the driver's own idle.">
            <AppSelect :id="id" v-model="(form.idle_score_basis as string)" :options="idleScoreOptions" />
          </FormField>
          <FormField v-for="f in gateFields" :key="f.key" v-slot="{ id }" :label="f.label" :error="fieldErr[f.key]">
            <BaseInput :id="id" v-model="(form[f.key] as string)" inputmode="numeric" :invalid="Boolean(fieldErr[f.key])" />
          </FormField>
        </div>
      </BaseCard>

      <BaseCard as="section">
        <h3 class="text-base font-semibold text-ink">Efficiency feed</h3>
        <div class="mt-3">
          <BaseCheckbox v-model="(form.efficiency_enabled as boolean)">
            Include the Samsara Driver Efficiency component (beta feed; auto-degrades if unavailable)
          </BaseCheckbox>
        </div>
      </BaseCard>

      <div class="flex items-center gap-3">
        <BaseButton variant="primary" type="submit" :disabled="save.isPending.value">
          {{ save.isPending.value ? "Saving…" : "Save settings" }}
        </BaseButton>
      </div>
    </form>
  </div>
</template>
