<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { RULE_IDS, formatRuleId, thresholdsFormSchema, type ThresholdsForm } from "@fuelguard/shared";
import { useThresholdsQuery, useSaveThresholds } from "@/features/settings/useThresholds";
import { useToastStore } from "@/stores/toast";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseCheckbox from "@/components/ui/BaseCheckbox.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import FormField from "@/components/ui/FormField.vue";
import PageHeader from "@/components/ui/PageHeader.vue";

const { data, isLoading } = useThresholdsQuery();
const save = useSaveThresholds();

const form = reactive<Record<string, unknown>>({
  mpg_drop_pct: 15,
  capacity_tolerance_pct: 5,
  rapid_refuel_hours: 4,
  max_plausible_mph: 85,
  cost_min_per_gal: "",
  cost_max_per_gal: "",
  disabled_rules: [] as string[],
  ai_verification_enabled: true,
  ai_monthly_token_budget: "",
});

watch(
  data,
  (t) => {
    if (!t) return;
    Object.assign(form, {
      mpg_drop_pct: t.mpg_drop_pct,
      capacity_tolerance_pct: t.capacity_tolerance_pct,
      rapid_refuel_hours: t.rapid_refuel_hours,
      max_plausible_mph: t.max_plausible_mph,
      cost_min_per_gal: t.cost_min_per_gal ?? "",
      cost_max_per_gal: t.cost_max_per_gal ?? "",
      disabled_rules: t.disabled_rules ?? [],
      ai_verification_enabled: t.ai_verification_enabled,
      ai_monthly_token_budget: t.ai_monthly_token_budget ?? "",
    });
  },
  { immediate: true },
);

const toast = useToastStore();
const fieldErr = ref<Record<string, string>>({});

async function onSave() {
  const result = thresholdsFormSchema.safeParse({ ...form });
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
    await save.mutateAsync(result.data as ThresholdsForm);
    toast.success("Thresholds saved");
  } catch (e) {
    toast.error("Could not save thresholds", e instanceof Error ? e.message : undefined);
  }
}

const numFields: { key: string; label: string }[] = [
  { key: "mpg_drop_pct", label: "MPG drop %" },
  { key: "capacity_tolerance_pct", label: "Tank capacity tolerance %" },
  { key: "rapid_refuel_hours", label: "Rapid refuel window (hours)" },
  { key: "max_plausible_mph", label: "Max plausible speed (mph)" },
  { key: "cost_min_per_gal", label: "Min $/gal (optional)" },
  { key: "cost_max_per_gal", label: "Max $/gal (optional)" },
];
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <PageHeader description="Tune the anomaly engine. Changes apply to future scoring only — they do not rewrite history." />

    <div v-if="isLoading" class="text-sm text-ink-muted">Loading…</div>

    <form v-else class="space-y-6" @submit.prevent="onSave">
      <BaseCard as="section">
        <h3 class="text-base font-semibold text-ink">Thresholds</h3>
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-for="f in numFields" :key="f.key" :label="f.label" :error="fieldErr[f.key]" v-slot="{ id }">
            <BaseInput :id="id" v-model="(form[f.key] as string)" inputmode="decimal" :invalid="Boolean(fieldErr[f.key])" />
          </FormField>
        </div>
      </BaseCard>

      <BaseCard as="section">
        <h3 class="text-base font-semibold text-ink">Disabled rules</h3>
        <p class="mt-1 text-xs text-ink-muted">Checked rules are turned off (everything else stays on).</p>
        <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label v-for="r in RULE_IDS" :key="r" class="flex items-center gap-2 text-sm text-ink-secondary">
            <input v-model="(form.disabled_rules as string[])" type="checkbox" :value="r" class="size-4 rounded border-edge-strong accent-brand-600" />
            <span>
              <span class="block text-sm text-ink-secondary">{{ formatRuleId(r) }}</span>
              <span class="block font-mono text-xs text-ink-subtle">{{ r }}</span>
            </span>
          </label>
        </div>
      </BaseCard>

      <BaseCard as="section">
        <h3 class="text-base font-semibold text-ink">AI verification</h3>
        <div class="mt-3">
          <BaseCheckbox v-model="(form.ai_verification_enabled as boolean)">
            Enable Claude AI verification on flagged transactions
          </BaseCheckbox>
        </div>
        <FormField class="mt-4 max-w-xs" label="Monthly token budget (optional)" v-slot="{ id }">
          <BaseInput :id="id" v-model="(form.ai_monthly_token_budget as string)" inputmode="numeric" />
        </FormField>
      </BaseCard>

      <div class="flex items-center gap-3">
        <BaseButton variant="primary" type="submit" :disabled="save.isPending.value">
          {{ save.isPending.value ? "Saving…" : "Save thresholds" }}
        </BaseButton>
      </div>
    </form>
  </div>
</template>
