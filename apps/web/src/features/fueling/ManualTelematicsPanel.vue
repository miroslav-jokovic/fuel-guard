<script setup lang="ts">
import { reactive, ref } from "vue";
import { ExclamationTriangleIcon, ChevronDownIcon } from "@heroicons/vue/24/outline";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import FormField from "@/components/ui/FormField.vue";
import type { PlanRequest } from "./useFuelPlan";

defineProps<{ message?: string; loading?: boolean }>();
const emit = defineEmits<{ submit: [manual: { fuelPct: number; hos: PlanRequest["manualHos"] }] }>();

const form = reactive({ fuelPct: "", driveHours: "", breakHours: "", shiftHours: "", cycleHours: "" });
const showHos = ref(false);
const error = ref("");

function num(v: string): number | null {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
}

function submit() {
  const pct = num(form.fuelPct);
  if (pct == null || pct < 0 || pct > 100) { error.value = "Enter a current fuel level between 0 and 100%."; return; }
  error.value = "";
  const hos = showHos.value
    ? { driveHours: num(form.driveHours), breakHours: num(form.breakHours), shiftHours: num(form.shiftHours), cycleHours: num(form.cycleHours) }
    : null;
  emit("submit", { fuelPct: pct, hos });
}
</script>

<template>
  <BaseCard>
    <div class="flex items-start gap-3">
      <ExclamationTriangleIcon class="mt-0.5 size-5 shrink-0 text-caution-600" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold text-ink">Live truck data unavailable</h3>
        <p v-if="message" class="mt-0.5 text-sm text-ink-secondary">{{ message }}</p>

        <div class="mt-3 flex flex-wrap items-end gap-3">
          <FormField v-slot="{ id }" label="Current fuel level (%)" :error="error">
            <BaseInput :id="id" v-model="form.fuelPct" type="number" inputmode="decimal" step="1" placeholder="e.g. 80" class="w-40" :invalid="!!error" />
          </FormField>
          <BaseButton variant="primary" :disabled="loading" @click="submit">
            {{ loading ? "Planning…" : "Plan with manual data" }}
          </BaseButton>
        </div>

        <button type="button" class="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800" @click="showHos = !showHos">
          <ChevronDownIcon class="size-3.5 transition-transform" :class="showHos ? 'rotate-180' : ''" aria-hidden="true" />
          {{ showHos ? "Hide" : "Add" }} hours of service (optional)
        </button>
        <div v-if="showHos" class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FormField v-slot="{ id }" label="Drive (h)"><BaseInput :id="id" v-model="form.driveHours" type="number" inputmode="decimal" step="0.5" placeholder="11" /></FormField>
          <FormField v-slot="{ id }" label="Break in (h)"><BaseInput :id="id" v-model="form.breakHours" type="number" inputmode="decimal" step="0.5" placeholder="8" /></FormField>
          <FormField v-slot="{ id }" label="Shift (h)"><BaseInput :id="id" v-model="form.shiftHours" type="number" inputmode="decimal" step="0.5" placeholder="14" /></FormField>
          <FormField v-slot="{ id }" label="Cycle (h)"><BaseInput :id="id" v-model="form.cycleHours" type="number" inputmode="decimal" step="1" placeholder="70" /></FormField>
        </div>
        <p class="mt-2 text-xs text-ink-muted">Without hours of service, the plan uses fuel range only and flags that HOS wasn't checked.</p>
      </div>
    </div>
  </BaseCard>
</template>
