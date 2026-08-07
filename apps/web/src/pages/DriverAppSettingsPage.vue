<script setup lang="ts">
import { computed, ref } from "vue";
import {
  FEATURE_CATALOG,
  FEATURE_KEYS,
  MODULE_LABELS,
  featureConfigSchemas,
  moduleEnabled,
  type FeatureDef,
  type FeatureKey,
  type ModuleKey,
} from "@fuelguard/shared";
import { useModulesQuery } from "@/composables/useModules";
import { useDriversQuery } from "@/composables/useDrivers";
import {
  useClearDriverOverride,
  useDriverAppFeaturesQuery,
  useDriverOverridesQuery,
  useSaveDriverAppFeature,
  useSaveDriverOverride,
} from "@/features/settings/useDriverAppFeatures";
import { useToastStore } from "@/stores/toast";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseCheckbox from "@/components/ui/BaseCheckbox.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import FormField from "@/components/ui/FormField.vue";
import PageHeader from "@/components/ui/PageHeader.vue";

/**
 * Driver App settings (hardening plan Phase 5.1/5.2, D-PM1..D-PM6) — the Samsara-style control
 * panel: every block the driver app can show, grouped by owning module, with per-feature config
 * and per-driver exceptions. The catalog (labels, defaults, released state) ships from shared;
 * this page renders ONLY released features — an unreleased feature gets no inert toggle (D-PM5).
 * A feature whose module isn't in the org's plan renders disabled with the reason, never hidden —
 * an admin should see what exists to buy. All writes ride /api/driver-app (role-gated, audited).
 */

const toast = useToastStore();
const modulesQ = useModulesQuery();
const rowsQ = useDriverAppFeaturesQuery();
const saveFeature = useSaveDriverAppFeature();

const rowByKey = computed(() => new Map((rowsQ.data.value ?? []).map((r) => [r.feature_key, r])));

/** Dashboard-visible features: released, excluding the core.app policy card (rendered separately). */
const visible: FeatureDef[] = FEATURE_KEYS.map((k) => FEATURE_CATALOG[k]).filter(
  (d) => d.released && d.key !== "core.app",
);
const coreFeatures = visible.filter((d) => d.module === "core");
const moduleFeatures = visible.filter((d) => d.module !== "core");

const entitled = (def: FeatureDef): boolean =>
  def.module === "core" ? true : moduleEnabled(modulesQ.data.value, def.module as ModuleKey);

const effectiveEnabled = (def: FeatureDef): boolean => {
  const row = rowByKey.value.get(def.key);
  return row ? row.enabled : def.defaultEnabled;
};

const savingKey = ref<string | null>(null);
async function setFeature(def: FeatureDef, enabled: boolean, config?: Record<string, unknown>) {
  savingKey.value = def.key;
  try {
    const existing = rowByKey.value.get(def.key);
    await saveFeature.mutateAsync({
      featureKey: def.key,
      enabled,
      config: config ?? (existing?.config as Record<string, unknown> | undefined),
    });
    toast.success(`${def.label} ${enabled ? "enabled" : "disabled"} for your drivers`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not save the setting");
  } finally {
    savingKey.value = null;
  }
}

// ── duty.odometer mode (D-PM2) ────────────────────────────────────────────────
const odometerModes = [
  { label: "Off — never asked", value: "off" },
  { label: "Optional (default)", value: "optional" },
  { label: "Required to start a shift", value: "required" },
];
const odometerMode = computed<string>(() => {
  const row = rowByKey.value.get("duty.odometer");
  if (row && !row.enabled) return "off";
  const parsed = featureConfigSchemas["duty.odometer"].safeParse(row?.config ?? {});
  return parsed.success ? parsed.data.mode : "optional";
});
async function setOdometerMode(mode: string) {
  const def = FEATURE_CATALOG["duty.odometer"];
  savingKey.value = def.key;
  try {
    await saveFeature.mutateAsync({
      featureKey: def.key,
      enabled: mode !== "off",
      config: { mode: mode === "off" ? "optional" : mode },
    });
    toast.success("Odometer policy saved");
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not save the setting");
  } finally {
    savingKey.value = null;
  }
}

// ── core.app minimum version (4.6) ────────────────────────────────────────────
const minVersionInput = ref<string>("");
const minVersionCurrent = computed<string | null>(() => {
  const parsed = featureConfigSchemas["core.app"].safeParse(rowByKey.value.get("core.app")?.config ?? {});
  return parsed.success ? parsed.data.minVersion : null;
});
const minVersionValid = computed(
  () => minVersionInput.value.trim() === "" || /^\d+(\.\d+)*$/.test(minVersionInput.value.trim()),
);
async function saveMinVersion() {
  if (!minVersionValid.value) return;
  const v = minVersionInput.value.trim();
  savingKey.value = "core.app";
  try {
    await saveFeature.mutateAsync({ featureKey: "core.app", enabled: true, config: { minVersion: v === "" ? null : v } });
    toast.success(v === "" ? "Minimum version cleared" : `Drivers below ${v} will be asked to update`);
    minVersionInput.value = "";
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not save the app policy");
  } finally {
    savingKey.value = null;
  }
}

// ── per-driver exceptions (5.2, D-PM6) ────────────────────────────────────────
const driversQ = useDriversQuery();
// FilterSelect models a plain string ("" = nothing picked); the query hook wants string | null.
const selectedDriverId = ref<string>("");
const selectedDriverIdOrNull = computed<string | null>(() => selectedDriverId.value || null);
const driverOptions = computed(() =>
  (driversQ.data.value ?? []).map((d) => ({ label: d.full_name, value: d.id })),
);
const overridesQ = useDriverOverridesQuery(selectedDriverIdOrNull);
const saveOverride = useSaveDriverOverride();
const clearOverride = useClearDriverOverride();

const overrideFeature = ref<string>("");
const overrideEnabled = ref<string>("false");
const overrideNote = ref<string>("");
const overrideFeatureOptions = visible.map((d) => ({ label: d.label, value: d.key }));
const overrideStateOptions = [
  { label: "Disable for this driver", value: "false" },
  { label: "Enable for this driver", value: "true" },
];

const featureLabel = (key: string): string =>
  FEATURE_CATALOG[key as FeatureKey]?.label ?? key;

async function addOverride() {
  const driverId = selectedDriverId.value;
  if (!driverId || !overrideFeature.value) return;
  try {
    await saveOverride.mutateAsync({
      driverId,
      featureKey: overrideFeature.value,
      enabled: overrideEnabled.value === "true",
      note: overrideNote.value.trim() || null,
    });
    toast.success("Override saved");
    overrideFeature.value = "";
    overrideNote.value = "";
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not save the override");
  }
}
async function removeOverride(featureKey: string) {
  const driverId = selectedDriverId.value;
  if (!driverId) return;
  try {
    await clearOverride.mutateAsync({ driverId, featureKey });
    toast.success("Override removed — the org setting applies again");
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not remove the override");
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      description="Control what your drivers see and how the app behaves — changes reach their phones on the next refresh, no app update needed."
    />

    <!-- Standard blocks (no purchase required) -->
    <BaseCard>
      <h2 class="text-sm font-semibold text-ink-secondary">Standard features</h2>
      <ul class="mt-3 divide-y divide-edge-subtle">
        <li v-for="def in coreFeatures" :key="def.key" class="flex items-start justify-between gap-4 py-3">
          <div class="min-w-0">
            <div class="text-sm font-medium text-ink">{{ def.label }}</div>
            <p class="mt-0.5 text-sm text-ink-muted">{{ def.description }}</p>
            <div v-if="def.key === 'duty.odometer'" class="mt-2 max-w-xs">
              <FilterSelect
                :model-value="odometerMode"
                label="Odometer"
                :options="odometerModes"
                @update:model-value="(v: string) => setOdometerMode(v)"
              />
            </div>
          </div>
          <BaseCheckbox
            v-if="def.key !== 'duty.odometer'"
            :model-value="effectiveEnabled(def)"
            :disabled="savingKey === def.key || rowsQ.isLoading.value"
            @update:model-value="(v: boolean) => setFeature(def, v)"
          />
        </li>
      </ul>
    </BaseCard>

    <!-- Module blocks (entitlement-gated) -->
    <BaseCard>
      <h2 class="text-sm font-semibold text-ink-secondary">Product modules</h2>
      <p class="mt-1 text-sm text-ink-muted">
        Features from modules in your plan. A module that isn't in your plan shows why it's off —
        contact FuelGuard to add it.
      </p>
      <ul class="mt-3 divide-y divide-edge-subtle">
        <li v-for="def in moduleFeatures" :key="def.key" class="flex items-start justify-between gap-4 py-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-ink">{{ def.label }}</span>
              <span class="rounded-full bg-surface-subtle px-2 py-0.5 text-xs text-ink-muted">
                {{ MODULE_LABELS[def.module as ModuleKey] }}
              </span>
              <span v-if="!entitled(def)" class="rounded-full bg-warning-50 px-2 py-0.5 text-xs text-warning-700">
                Not in your plan
              </span>
            </div>
            <p class="mt-0.5 text-sm text-ink-muted">{{ def.description }}</p>
          </div>
          <BaseCheckbox
            :model-value="entitled(def) && effectiveEnabled(def)"
            :disabled="!entitled(def) || savingKey === def.key || rowsQ.isLoading.value"
            @update:model-value="(v: boolean) => setFeature(def, v)"
          />
        </li>
      </ul>
    </BaseCard>

    <!-- App policy -->
    <BaseCard>
      <h2 class="text-sm font-semibold text-ink-secondary">App policy</h2>
      <p class="mt-1 text-sm text-ink-muted">
        Minimum supported app version. Drivers on an older build see a blocking "update required"
        screen; their queued offline work is preserved.
        <template v-if="minVersionCurrent"> Currently: <strong>{{ minVersionCurrent }}</strong>.</template>
        <template v-else> Currently: no minimum set.</template>
      </p>
      <form class="mt-3 flex items-end gap-2" @submit.prevent="saveMinVersion">
        <FormField label="Minimum version" :error="minVersionValid ? undefined : 'Use a dotted number, e.g. 1.4.0'">
          <BaseInput v-model="minVersionInput" placeholder="e.g. 1.4.0 (empty to clear)" />
        </FormField>
        <BaseButton type="submit" :disabled="!minVersionValid || savingKey === 'core.app'">Save</BaseButton>
      </form>
    </BaseCard>

    <!-- Per-driver exceptions -->
    <BaseCard>
      <h2 class="text-sm font-semibold text-ink-secondary">Per-driver exceptions</h2>
      <p class="mt-1 text-sm text-ink-muted">
        Pilot a feature with a few drivers, or switch one off for one person — exceptions can only
        narrow within your plan and org settings, and every change is audited.
      </p>
      <div class="mt-3 max-w-xs">
        <FilterSelect v-model="selectedDriverId" label="Driver" :options="driverOptions" />
      </div>

      <template v-if="selectedDriverId">
        <ul v-if="(overridesQ.data.value ?? []).length" class="mt-4 divide-y divide-edge-subtle">
          <li
            v-for="o in overridesQ.data.value"
            :key="o.feature_key"
            class="flex items-center justify-between gap-3 py-2 text-sm"
          >
            <div>
              <span class="font-medium text-ink">{{ featureLabel(o.feature_key) }}</span>
              <span :class="o.enabled ? 'text-success-700' : 'text-danger-600'" class="ml-2">
                {{ o.enabled ? "enabled" : "disabled" }}
              </span>
              <span v-if="o.note" class="ml-2 text-ink-muted">— {{ o.note }}</span>
            </div>
            <BaseButton size="sm" variant="ghost" @click="removeOverride(o.feature_key)">Remove</BaseButton>
          </li>
        </ul>
        <p v-else class="mt-4 text-sm text-ink-muted">No exceptions — the org settings apply.</p>

        <form class="mt-4 flex flex-wrap items-end gap-2" @submit.prevent="addOverride">
          <FormField label="Feature">
            <FilterSelect v-model="overrideFeature" label="Feature" :options="overrideFeatureOptions" />
          </FormField>
          <FormField label="State">
            <FilterSelect v-model="overrideEnabled" label="State" :options="overrideStateOptions" />
          </FormField>
          <FormField label="Why (shown next to the exception)">
            <BaseInput v-model="overrideNote" placeholder="e.g. hazmat pilot group" />
          </FormField>
          <BaseButton type="submit" :disabled="!overrideFeature || saveOverride.isPending.value">Add exception</BaseButton>
        </form>
      </template>
    </BaseCard>
  </div>
</template>
