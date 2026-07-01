<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { RULE_IDS, thresholdsFormSchema, type ThresholdsForm } from "@fuelguard/shared";
import { useThresholdsQuery, useSaveThresholds } from "@/features/settings/useThresholds";
import { useToastStore } from "@/stores/toast";

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
const input = "mt-1 block w-full rounded-md border-0 px-3 py-1.5 text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600 sm:text-sm";
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <p class="text-sm text-gray-500">
      Tune the anomaly engine. Changes apply to future scoring only — they do not rewrite history.
    </p>

    <div v-if="isLoading" class="text-sm text-gray-500">Loading…</div>

    <form v-else class="space-y-6" @submit.prevent="onSave">
      <section class="rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <h3 class="text-base font-semibold text-gray-900">Thresholds</h3>
        <div class="mt-4 grid grid-cols-2 gap-4">
          <div v-for="f in numFields" :key="f.key">
            <label class="block text-sm font-medium text-gray-900">{{ f.label }}</label>
            <input v-model="form[f.key]" inputmode="decimal" :class="input" />
            <p v-if="fieldErr[f.key]" class="mt-1 text-xs text-red-600">{{ fieldErr[f.key] }}</p>
          </div>
        </div>
      </section>

      <section class="rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <h3 class="text-base font-semibold text-gray-900">Disabled rules</h3>
        <p class="mt-1 text-xs text-gray-500">Checked rules are turned off (everything else stays on).</p>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <label v-for="r in RULE_IDS" :key="r" class="flex items-center gap-2 text-sm text-gray-700">
            <input v-model="(form.disabled_rules as string[])" type="checkbox" :value="r" class="rounded border-gray-300" />
            <span class="font-mono text-xs">{{ r }}</span>
          </label>
        </div>
      </section>

      <section class="rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <h3 class="text-base font-semibold text-gray-900">AI verification</h3>
        <label class="mt-3 flex items-center gap-2 text-sm text-gray-700">
          <input v-model="form.ai_verification_enabled" type="checkbox" class="rounded border-gray-300" />
          Enable Claude AI verification on flagged transactions
        </label>
        <div class="mt-4">
          <label class="block text-sm font-medium text-gray-900">Monthly token budget (optional)</label>
          <input v-model="form.ai_monthly_token_budget" inputmode="numeric" class="mt-1 max-w-xs rounded-md border-0 px-3 py-1.5 text-gray-900 ring-1 ring-gray-300 ring-inset sm:text-sm" />
        </div>
      </section>

      <div class="flex items-center gap-3">
        <button type="submit" :disabled="save.isPending.value" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50">
          {{ save.isPending.value ? "Saving…" : "Save thresholds" }}
        </button>
      </div>
    </form>
  </div>
</template>
