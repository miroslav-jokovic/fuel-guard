<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { homeTimeSettingsSchema, type HomeTimeSettings } from "@silvicom/shared";
import { AppButton as BaseButton, AppCard as BaseCard, AppFormField as FormField, AppInput as BaseInput, QueryState } from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import { useHomeTimeThresholds, useSaveHomeTimeThresholds } from "./useAlertRouting";

/**
 * When the three home-time alerts fire (HOME-TIME-PLAN D-HT12, HT5). The ranges are the table's own
 * (`homeTimeSettingsSchema` restates 0597's CHECKs), so a number the database would refuse is refused
 * here with its range, before a save.
 */
const FIELDS: { key: keyof HomeTimeSettings; label: string; hint: string; range: string }[] = [
  { key: "returnDueHours", label: "Warn this many hours before the return", hint: "\"Home time ending\" is sent this long before the driver is due back.", range: "1 to 168" },
  { key: "overdueAfterHours", label: "Overstayed after this many hours", hint: "How long past the return before \"Home time overstayed\" is sent. 0 sends it at the return time.", range: "0 to 72" },
  { key: "truckLimitDays", label: "Truck at a driver's home, days", hint: "\"Truck at home too long\" is sent when the truck has stayed with the driver this many days.", range: "1 to 60" },
];

const thresholds = useHomeTimeThresholds();
const save = useSaveHomeTimeThresholds();
const toast = useToastStore();
const form = reactive<Record<keyof HomeTimeSettings, string>>({ returnDueHours: "", overdueAfterHours: "", truckLimitDays: "" });

watch(
  () => thresholds.data.value,
  (s) => {
    if (!s) return;
    for (const f of FIELDS) form[f.key] = String(s[f.key]);
  },
  { immediate: true },
);

/** A whole number or NaN: "2.5" and "" are not numbers of hours. */
const asNumber = (v: string): number => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN);
const parsed = computed(() => homeTimeSettingsSchema.safeParse({ returnDueHours: asNumber(form.returnDueHours), overdueAfterHours: asNumber(form.overdueAfterHours), truckLimitDays: asNumber(form.truckLimitDays) }));
const invalid = computed(() => new Set(parsed.value.success ? [] : parsed.value.error.issues.map((i) => String(i.path[0]))));
const changed = computed(() => FIELDS.some((f) => form[f.key].trim() !== String(thresholds.data.value?.[f.key] ?? "")));

async function onSave(): Promise<void> {
  if (!parsed.value.success) return;
  try {
    await save.mutateAsync(parsed.value.data);
    toast.success("Alert times saved");
  } catch (e) {
    toast.error("Could not save the alert times", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <QueryState
    :loading="thresholds.isLoading.value"
    :error="thresholds.isError.value ? thresholds.error.value : null"
    :retrying="thresholds.isFetching.value"
    loading-text="Loading the alert times…"
    error-text="Could not load the alert times."
    @retry="thresholds.refetch()"
  >
    <BaseCard as="section">
      <form class="space-y-4" data-testid="home-time-thresholds" @submit.prevent="onSave">
        <h3 class="text-sm font-semibold text-ink">When they are sent</h3>
        <div class="grid gap-4 md:grid-cols-3">
          <FormField v-for="f in FIELDS" :key="f.key" v-slot="{ id }" :label="f.label" :hint="f.hint" :error="invalid.has(f.key) ? `A whole number, ${f.range}.` : undefined">
            <BaseInput :id="id" v-model="form[f.key]" inputmode="numeric" :invalid="invalid.has(f.key)" />
          </FormField>
        </div>
        <BaseButton variant="primary" type="submit" :disabled="!changed || !parsed.success || save.isPending.value">
          {{ save.isPending.value ? "Saving…" : "Save alert times" }}
        </BaseButton>
      </form>
    </BaseCard>
  </QueryState>
</template>
