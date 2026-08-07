<script setup lang="ts">
import { computed, ref } from "vue";
import { AppIcon } from "@fuelguard/ui";
import {
  ArrowsRightLeftIcon,
  BellIcon,
  CheckCircleIcon,
  Cog6ToothIcon,
  DevicePhoneMobileIcon,
  InformationCircleIcon,
  LoadsIcon,
  OdometerIcon,
  PaperAirplaneIcon,
  ShieldCheckIcon,
  TrophyIcon,
  UsersIcon,
  type Icon,
} from "@fuelguard/ui/icons";
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
import AppSelect from "@/components/AppSelect.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseSwitch from "@/components/ui/BaseSwitch.vue";
import FormField from "@/components/ui/FormField.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
type SettingsTab = "features" | "app" | "exceptions";
const activeTab = ref<SettingsTab>("features");
const tabs: { key: SettingsTab; label: string }[] = [
  { key: "features", label: "Features" },
  { key: "app", label: "App controls" },
  { key: "exceptions", label: "Driver exceptions" },
];
const toast = useToastStore();
const modulesQ = useModulesQuery();
const rowsQ = useDriverAppFeaturesQuery();
const saveFeature = useSaveDriverAppFeature();
const rowByKey = computed(() => new Map((rowsQ.data.value ?? []).map((r) => [r.feature_key, r])));
const visible: FeatureDef[] = FEATURE_KEYS.map((key) => FEATURE_CATALOG[key]).filter(
  (def) => def.released && def.key !== "core.app",
);
const coreFeatures = visible.filter((def) => def.module === "core");
const moduleFeatures = visible.filter((def) => def.module !== "core");
const entitled = (def: FeatureDef): boolean =>
  def.module === "core" || moduleEnabled(modulesQ.data.value, def.module as ModuleKey);
const effectiveEnabled = (def: FeatureDef): boolean => rowByKey.value.get(def.key)?.enabled ?? def.defaultEnabled;
const availableFeatureCount = computed(() => visible.filter(entitled).length);
const activeFeatureCount = computed(() => visible.filter((def) => entitled(def) && effectiveEnabled(def)).length);
const featureIcons: Partial<Record<FeatureKey, Icon>> = {
  "tab.loads": LoadsIcon,
  "tab.score": TrophyIcon,
  "hazmat.capture": ShieldCheckIcon,
  messages: PaperAirplaneIcon,
  notifications: BellIcon,
  "duty.odometer": OdometerIcon,
  "duty.takeover": ArrowsRightLeftIcon,
};
const featureIcon = (key: FeatureKey): Icon => featureIcons[key] ?? Cog6ToothIcon;
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
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not save the setting");
  } finally {
    savingKey.value = null;
  }
}
const odometerModes = [
  { label: "Off — never ask", value: "off" },
  { label: "Optional", value: "optional" },
  { label: "Required at check-in", value: "required" },
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
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not save the setting");
  } finally {
    savingKey.value = null;
  }
}
const scoreDepths = [
  { label: "Home + Score tab", value: "tab" },
  { label: "Home summary only", value: "home" },
];
const scoreDepth = computed<string>(() => {
  const parsed = featureConfigSchemas["tab.score"].safeParse(rowByKey.value.get("tab.score")?.config ?? {});
  return parsed.success && !parsed.data.detailTab ? "home" : "tab";
});
async function setScoreDepth(depth: string) {
  savingKey.value = "tab.score";
  try {
    await saveFeature.mutateAsync({
      featureKey: "tab.score",
      enabled: effectiveEnabled(FEATURE_CATALOG["tab.score"]),
      config: { detailTab: depth === "tab" },
    });
    toast.success("Score visibility saved");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not save the setting");
  } finally {
    savingKey.value = null;
  }
}
const minVersionInput = ref("");
const minVersionCurrent = computed<string | null>(() => {
  const parsed = featureConfigSchemas["core.app"].safeParse(rowByKey.value.get("core.app")?.config ?? {});
  return parsed.success ? parsed.data.minVersion : null;
});
const minVersionValid = computed(
  () => minVersionInput.value.trim() === "" || /^\d+(\.\d+)*$/.test(minVersionInput.value.trim()),
);
async function saveMinVersion() {
  if (!minVersionValid.value) return;
  const version = minVersionInput.value.trim();
  savingKey.value = "core.app";
  try {
    await saveFeature.mutateAsync({
      featureKey: "core.app",
      enabled: true,
      config: { minVersion: version || null },
    });
    toast.success(version ? `Drivers below ${version} will be asked to update` : "Minimum version cleared");
    minVersionInput.value = "";
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not save the app policy");
  } finally {
    savingKey.value = null;
  }
}
const driversQ = useDriversQuery();
const selectedDriverId = ref("");
const selectedDriverIdOrNull = computed<string | null>(() => selectedDriverId.value || null);
const driverOptions = computed(() =>
  (driversQ.data.value ?? []).map((driver) => ({ label: driver.full_name, value: driver.id })),
);
const selectedDriverName = computed(
  () => driverOptions.value.find((driver) => driver.value === selectedDriverId.value)?.label ?? "this driver",
);
const overridesQ = useDriverOverridesQuery(selectedDriverIdOrNull);
const saveOverride = useSaveDriverOverride();
const clearOverride = useClearDriverOverride();
const overrideFeature = ref("");
const overrideEnabled = ref("false");
const overrideNote = ref("");
const overrideFeatureOptions = computed(() =>
  visible.filter(entitled).map((def) => ({ label: def.label, value: def.key })),
);
const overrideStateOptions = [
  { label: "Disable for this driver", value: "false" },
  { label: "Allow when organization setting is on", value: "true" },
];
const featureLabel = (key: string): string => FEATURE_CATALOG[key as FeatureKey]?.label ?? key;
async function addOverride() {
  if (!selectedDriverId.value || !overrideFeature.value) return;
  try {
    await saveOverride.mutateAsync({
      driverId: selectedDriverId.value,
      featureKey: overrideFeature.value,
      enabled: overrideEnabled.value === "true",
      note: overrideNote.value.trim() || null,
    });
    toast.success(`Exception saved for ${selectedDriverName.value}`);
    overrideFeature.value = "";
    overrideNote.value = "";
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not save the exception");
  }
}
async function removeOverride(featureKey: string) {
  if (!selectedDriverId.value) return;
  try {
    await clearOverride.mutateAsync({ driverId: selectedDriverId.value, featureKey });
    toast.success("Exception removed — the organization setting applies again");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not remove the exception");
  }
}
</script>
<template>
  <div class="mx-auto max-w-5xl space-y-6">
    <PageHeader description="Shape the Driver App experience for your fleet. Changes reach drivers on their next refresh—no app update required." />
    <BaseCard v-if="rowsQ.isError.value" padding="sm">
      <p class="text-sm font-semibold text-danger-600">Driver App settings could not be loaded.</p>
      <p class="mt-1 text-sm text-ink-muted">{{ rowsQ.error.value?.message }} The controls remain unavailable until the connection is restored.</p>
    </BaseCard>
    <nav class="flex gap-1 overflow-x-auto rounded-lg bg-surface-muted p-1" role="tablist" aria-label="Driver App settings">
      <button
        v-for="tab in tabs"
        :id="`driver-app-tab-${tab.key}`"
        :key="tab.key"
        type="button"
        role="tab"
        class="shrink-0 rounded-md px-3 py-2 text-sm font-medium transition"
        :class="activeTab === tab.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink-secondary'"
        :aria-selected="activeTab === tab.key"
        :aria-controls="`driver-app-panel-${tab.key}`"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </nav>
    <section
      v-if="activeTab === 'features'"
      id="driver-app-panel-features"
      role="tabpanel"
      aria-labelledby="driver-app-tab-features"
      class="space-y-6"
    >
      <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 class="text-lg font-semibold text-ink">Driver experience</h2>
          <p class="mt-1 text-sm text-ink-muted">Choose the tools and information drivers can use in the app.</p>
        </div>
        <p class="text-sm font-medium text-ink-secondary">
          <template v-if="rowsQ.isLoading.value || modulesQ.isLoading.value">Loading settings…</template>
          <template v-else>{{ activeFeatureCount }} of {{ availableFeatureCount }} available features on</template>
        </p>
      </div>
      <BaseCard as="section" padding="none">
        <div class="border-b border-edge-subtle px-5 py-4">
          <h3 class="text-sm font-semibold text-ink">Core experience</h3>
          <p class="mt-1 text-sm text-ink-muted">Included for every fleet. Configure how everyday driver tasks behave.</p>
        </div>
        <ul class="divide-y divide-edge-subtle">
          <li v-for="def in coreFeatures" :key="def.key" class="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div class="flex min-w-0 gap-3">
              <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <AppIcon :icon="featureIcon(def.key)" class="size-5" aria-hidden="true" />
              </span>
              <div class="min-w-0">
                <h4 class="text-sm font-semibold text-ink">{{ def.label }}</h4>
                <p class="mt-1 text-sm text-ink-muted">{{ def.description }}</p>
                <div v-if="def.key === 'tab.score' && effectiveEnabled(def)" class="mt-3 max-w-xs">
                  <FormField v-slot="{ id }" label="Visibility">
                    <AppSelect
                      :id="id"
                      :model-value="scoreDepth"
                      :options="scoreDepths"
                      aria-label="Driver score visibility"
                      :disabled="savingKey === def.key"
                      @update:model-value="setScoreDepth(String($event))"
                    />
                  </FormField>
                </div>
                <div v-if="def.key === 'duty.odometer'" class="mt-3 max-w-xs">
                  <FormField v-slot="{ id }" label="Check-in policy">
                    <AppSelect
                      :id="id"
                      :model-value="odometerMode"
                      :options="odometerModes"
                      aria-label="Odometer check-in policy"
                      :disabled="savingKey === def.key"
                      @update:model-value="setOdometerMode(String($event))"
                    />
                  </FormField>
                </div>
              </div>
            </div>
            <div v-if="def.key !== 'duty.odometer'" class="flex items-center justify-between gap-3 sm:self-start">
              <span class="text-xs font-medium text-ink-muted">{{ effectiveEnabled(def) ? "On" : "Off" }}</span>
              <BaseSwitch
                :model-value="effectiveEnabled(def)"
                :disabled="savingKey === def.key || rowsQ.isLoading.value || rowsQ.isError.value"
                :aria-label="`${effectiveEnabled(def) ? 'Disable' : 'Enable'} ${def.label}`"
                @update:model-value="(value: boolean) => setFeature(def, value)"
              />
            </div>
          </li>
        </ul>
      </BaseCard>
      <BaseCard as="section" padding="none">
        <div class="border-b border-edge-subtle px-5 py-4">
          <h3 class="text-sm font-semibold text-ink">Product modules</h3>
          <p class="mt-1 text-sm text-ink-muted">Turn on capabilities included in your FuelGuard plan.</p>
        </div>
        <ul class="divide-y divide-edge-subtle">
          <li v-for="def in moduleFeatures" :key="def.key" class="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div class="flex min-w-0 gap-3">
              <span
                class="flex size-9 shrink-0 items-center justify-center rounded-lg"
                :class="entitled(def) ? 'bg-brand-50 text-brand-700' : 'bg-surface-muted text-ink-subtle'"
              >
                <AppIcon :icon="featureIcon(def.key)" class="size-5" aria-hidden="true" />
              </span>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h4 class="text-sm font-semibold text-ink">{{ def.label }}</h4>
                  <span class="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-muted">
                    {{ MODULE_LABELS[def.module as ModuleKey] }}
                  </span>
                  <span v-if="!entitled(def)" class="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-700">
                    Not in your plan
                  </span>
                </div>
                <p class="mt-1 text-sm text-ink-muted">{{ def.description }}</p>
                <p v-if="!entitled(def)" class="mt-2 text-xs text-ink-muted">
                  Contact FuelGuard to add {{ MODULE_LABELS[def.module as ModuleKey] }}.
                </p>
              </div>
            </div>
            <div class="flex items-center justify-between gap-3 sm:self-start">
              <span class="text-xs font-medium text-ink-muted">{{ entitled(def) && effectiveEnabled(def) ? "On" : "Off" }}</span>
              <BaseSwitch
                :model-value="entitled(def) && effectiveEnabled(def)"
                :disabled="!entitled(def) || savingKey === def.key || rowsQ.isLoading.value || rowsQ.isError.value"
                :aria-label="`${entitled(def) && effectiveEnabled(def) ? 'Disable' : 'Enable'} ${def.label}`"
                @update:model-value="(value: boolean) => setFeature(def, value)"
              />
            </div>
          </li>
        </ul>
      </BaseCard>
    </section>
    <section
      v-else-if="activeTab === 'app'"
      id="driver-app-panel-app"
      role="tabpanel"
      aria-labelledby="driver-app-tab-app"
      class="space-y-6"
    >
      <div>
        <h2 class="text-lg font-semibold text-ink">App controls</h2>
        <p class="mt-1 text-sm text-ink-muted">Manage operational safeguards that apply to every driver.</p>
      </div>
      <BaseCard as="section" padding="none">
        <div class="flex items-start gap-3 border-b border-edge-subtle p-5">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <AppIcon :icon="DevicePhoneMobileIcon" class="size-5" aria-hidden="true" />
          </span>
          <div>
            <h3 class="text-sm font-semibold text-ink">Minimum supported version</h3>
            <p class="mt-1 text-sm text-ink-muted">Require an app update before a driver can continue using FuelGuard.</p>
          </div>
        </div>
        <div class="space-y-5 p-5">
          <div class="flex items-start gap-3 rounded-lg bg-surface-subtle p-4 ring-1 ring-edge-subtle">
            <AppIcon :icon="InformationCircleIcon" class="mt-0.5 size-5 shrink-0 text-info-600" aria-hidden="true" />
            <div>
              <p class="text-sm font-medium text-ink">
                {{ minVersionCurrent ? `Version ${minVersionCurrent} or newer is required` : "No minimum version is set" }}
              </p>
              <p class="mt-1 text-sm text-ink-muted">Drivers on an older build see an update-required screen. Queued offline work stays on their device.</p>
            </div>
          </div>
          <form class="flex max-w-lg flex-col gap-3 sm:flex-row sm:items-end" @submit.prevent="saveMinVersion">
            <FormField
              v-slot="{ id }"
              class="min-w-0 flex-1"
              label="Minimum version"
              hint="Leave empty and save to remove the requirement."
              :error="minVersionValid ? undefined : 'Use a dotted version such as 1.4.0'"
            >
              <BaseInput :id="id" v-model="minVersionInput" inputmode="decimal" placeholder="e.g. 1.4.0" :invalid="!minVersionValid" />
            </FormField>
            <BaseButton variant="primary" type="submit" :disabled="!minVersionValid || savingKey === 'core.app'">
              {{ savingKey === "core.app" ? "Saving…" : "Save policy" }}
            </BaseButton>
          </form>
        </div>
      </BaseCard>
    </section>
    <section
      v-else
      id="driver-app-panel-exceptions"
      role="tabpanel"
      aria-labelledby="driver-app-tab-exceptions"
      class="space-y-6"
    >
      <div>
        <h2 class="text-lg font-semibold text-ink">Driver exceptions</h2>
        <p class="mt-1 text-sm text-ink-muted">Pilot a feature or narrow access for one driver. Organization and plan limits still apply.</p>
      </div>
      <BaseCard as="section">
        <div class="flex items-start gap-3">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <AppIcon :icon="UsersIcon" class="size-5" aria-hidden="true" />
          </span>
          <div class="min-w-0 flex-1">
            <h3 class="text-sm font-semibold text-ink">Choose a driver</h3>
            <p class="mt-1 text-sm text-ink-muted">Review existing exceptions before adding a new one.</p>
            <div class="mt-4 max-w-sm">
              <FormField v-slot="{ id }" label="Driver">
                <AppSelect
                  :id="id"
                  v-model="selectedDriverId"
                  :options="driverOptions"
                  placeholder="Select a driver…"
                  aria-label="Driver"
                  :disabled="driversQ.isLoading.value || driversQ.isError.value"
                />
              </FormField>
              <p v-if="driversQ.isError.value" class="mt-2 text-sm text-danger-600">Drivers could not be loaded.</p>
            </div>
          </div>
        </div>
      </BaseCard>
      <div v-if="selectedDriverId" class="grid gap-6 lg:grid-cols-2 lg:items-start">
        <BaseCard as="section" padding="none">
          <div class="border-b border-edge-subtle px-5 py-4">
            <h3 class="text-sm font-semibold text-ink">Current exceptions</h3>
            <p class="mt-1 text-sm text-ink-muted">{{ selectedDriverName }}</p>
          </div>
          <p v-if="overridesQ.isLoading.value" class="p-5 text-sm text-ink-muted">Loading exceptions…</p>
          <ul v-else-if="(overridesQ.data.value ?? []).length" class="divide-y divide-edge-subtle">
            <li v-for="override in overridesQ.data.value" :key="override.feature_key" class="flex items-start justify-between gap-3 p-5">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-semibold text-ink">{{ featureLabel(override.feature_key) }}</span>
                  <span
                    class="rounded-full px-2 py-0.5 text-xs font-medium"
                    :class="override.enabled ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'"
                  >
                    {{ override.enabled ? "Allowed" : "Disabled" }}
                  </span>
                </div>
                <p v-if="override.note" class="mt-1 text-sm text-ink-muted">{{ override.note }}</p>
              </div>
              <BaseButton size="sm" variant="ghost" @click="removeOverride(override.feature_key)">Remove</BaseButton>
            </li>
          </ul>
          <div v-else class="p-5 text-center">
            <AppIcon :icon="CheckCircleIcon" class="mx-auto size-6 text-success-600" aria-hidden="true" />
            <p class="mt-2 text-sm font-medium text-ink">Organization settings apply</p>
            <p class="mt-1 text-sm text-ink-muted">This driver has no exceptions.</p>
          </div>
        </BaseCard>
        <BaseCard as="section">
          <h3 class="text-sm font-semibold text-ink">Add an exception</h3>
          <p class="mt-1 text-sm text-ink-muted">Every change is recorded in the audit log.</p>
          <form class="mt-4 space-y-4" @submit.prevent="addOverride">
            <FormField v-slot="{ id }" label="Feature" required>
              <AppSelect
                :id="id"
                v-model="overrideFeature"
                :options="overrideFeatureOptions"
                placeholder="Select a feature…"
                aria-label="Feature"
              />
            </FormField>
            <FormField v-slot="{ id }" label="Access">
              <AppSelect :id="id" v-model="overrideEnabled" :options="overrideStateOptions" aria-label="Access" />
            </FormField>
            <FormField v-slot="{ id }" label="Reason" hint="Optional; shown alongside the exception.">
              <BaseInput :id="id" v-model="overrideNote" placeholder="e.g. Hazmat pilot group" />
            </FormField>
            <BaseButton variant="primary" type="submit" :disabled="!overrideFeature || saveOverride.isPending.value">
              {{ saveOverride.isPending.value ? "Saving…" : "Add exception" }}
            </BaseButton>
          </form>
        </BaseCard>
      </div>
      <BaseCard v-else padding="sm">
        <p class="text-sm text-ink-muted">Select a driver to review or create an exception.</p>
      </BaseCard>
    </section>
  </div>
</template>
