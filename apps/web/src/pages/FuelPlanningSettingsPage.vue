<script setup lang="ts">
import { reactive, ref, computed, watch } from "vue";
import { routeFuelSettingsFormSchema, ROUTE_FUEL_SETTINGS_DEFAULTS, type RouteFuelSettingsForm } from "@fuelguard/shared";
import { useRouteFuelSettings, useSaveRouteFuelSettings } from "@/features/fueling/useRouteFuelSettings";
import { useToastStore } from "@/stores/toast";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseCheckbox from "@/components/ui/BaseCheckbox.vue";
import FormField from "@/components/ui/FormField.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { PlusIcon, XMarkIcon } from "@heroicons/vue/24/outline";
import { useDiscountRules, useSaveDiscountRules, DISCOUNT_TYPES, type DiscountRule } from "@/features/fueling/useDiscountRules";

const { data, isLoading } = useRouteFuelSettings();
const save = useSaveRouteFuelSettings();
const toast = useToastStore();

const form = reactive<RouteFuelSettingsForm>({ ...ROUTE_FUEL_SETTINGS_DEFAULTS });
watch(data, (d) => { if (d) Object.assign(form, d); }, { immediate: true });

// Array fields edit as comma-separated text; brands lower-cased, states upper-cased on save.
const csv = (key: "preferred_brands" | "avoid_brands" | "emergency_brands" | "avoid_states" | "fuel_before_states", upper = false) =>
  computed({
    get: () => (form[key] ?? []).join(", "),
    set: (v: string) => {
      form[key] = v.split(",").map((s) => (upper ? s.trim().toUpperCase() : s.trim().toLowerCase())).filter(Boolean);
    },
  });
const preferredBrands = csv("preferred_brands");
const avoidBrands = csv("avoid_brands");
const emergencyBrands = csv("emergency_brands");
const avoidStates = csv("avoid_states", true);
const fuelBeforeStates = csv("fuel_before_states", true);

const fieldErr = ref<Record<string, string>>({});
async function onSave() {
  const result = routeFuelSettingsFormSchema.safeParse({ ...form });
  if (!result.success) {
    const m: Record<string, string> = {};
    for (const i of result.error.issues) {
      const k = i.path[0];
      if (typeof k === "string" && !m[k]) m[k] = i.message;
    }
    fieldErr.value = m;
    toast.error("Please fix the highlighted fields");
    return;
  }
  fieldErr.value = {};
  try {
    await save.mutateAsync(result.data as RouteFuelSettingsForm);
    toast.success("Planned-fueling settings saved");
  } catch (e) {
    toast.error("Could not save settings", e instanceof Error ? e.message : undefined);
  }
}

// Per-brand discount rules (independent save; separate table).
const SELECT_CLS = "w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-sm text-ink";
const { data: discountData } = useDiscountRules();
const saveDiscounts = useSaveDiscountRules();
const rules = ref<DiscountRule[]>([]);
watch(discountData, (d) => { if (d) rules.value = d.map((r) => ({ ...r })); }, { immediate: true });
function addRule() { rules.value.push({ brand: "", type: "flat", cents_off: 0 }); }
function removeRule(i: number) { rules.value.splice(i, 1); }
async function onSaveDiscounts() {
  try {
    await saveDiscounts.mutateAsync(rules.value);
    toast.success("Discount rules saved");
  } catch (e) {
    toast.error("Could not save discount rules", e instanceof Error ? e.message : undefined);
  }
}

interface NumField { key: keyof RouteFuelSettingsForm; label: string; hint?: string; step?: string }
const safety: NumField[] = [
  { key: "reserve_pct", label: "Reserve (% of usable tank)", hint: "Safety floor never crossed while planning.", step: "1" },
  { key: "mpg_safety_factor", label: "MPG safety factor", hint: "Derates baseline MPG for range (0.5–1.0).", step: "0.01" },
  { key: "emergency_fill_gallons", label: "Emergency fill (gal)", hint: "Minimum splash-and-go when no good stop is reachable.", step: "1" },
  { key: "min_purchase_gal", label: "Min purchase (gal)", hint: "Loyalty / minimum-fill threshold.", step: "1" },
];
const corridor: NumField[] = [
  { key: "corridor_miles", label: "Corridor buffer (mi)", hint: "How far off the route to search for stations.", step: "0.5" },
  { key: "deviation_threshold_mi", label: "Off-route recompute (mi)", hint: "Deviation that triggers a re-plan.", step: "0.5" },
];
const prices: NumField[] = [
  { key: "price_ttl_hours", label: "Price freshness window (hours)", hint: "Prices older than this are excluded from cheapest-selection.", step: "1" },
];
const truck: NumField[] = [
  { key: "default_height_in", label: "Height (in)", step: "1" },
  { key: "default_length_in", label: "Length (in)", step: "1" },
  { key: "default_width_in", label: "Width (in)", step: "1" },
  { key: "default_axle_count", label: "Axles", step: "1" },
  { key: "default_gross_weight_lb", label: "Gross weight (lb)", hint: "Legal max — loads are never routed heavier.", step: "500" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Control how the planner picks fuel stops — safety reserves, corridor width, price freshness, brand policy, and the default truck routing profile. Applies org-wide." />

    <p v-if="isLoading" class="text-sm text-ink-muted">Loading…</p>

    <form v-else class="space-y-6" @submit.prevent="onSave">
      <BaseCard>
        <h3 class="text-sm font-semibold text-ink">Safety &amp; feasibility</h3>
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-for="f in safety" :key="f.key" v-slot="{ id }" :label="f.label" :hint="f.hint" :error="fieldErr[f.key]">
            <BaseInput :id="id" v-model="form[f.key] as number" type="number" :step="f.step" inputmode="decimal" :invalid="!!fieldErr[f.key]" />
          </FormField>
        </div>
      </BaseCard>

      <BaseCard>
        <h3 class="text-sm font-semibold text-ink">Corridor &amp; routing</h3>
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-for="f in corridor" :key="f.key" v-slot="{ id }" :label="f.label" :hint="f.hint" :error="fieldErr[f.key]">
            <BaseInput :id="id" v-model="form[f.key] as number" type="number" :step="f.step" inputmode="decimal" :invalid="!!fieldErr[f.key]" />
          </FormField>
        </div>
      </BaseCard>

      <BaseCard>
        <h3 class="text-sm font-semibold text-ink">Prices</h3>
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-for="f in prices" :key="f.key" v-slot="{ id }" :label="f.label" :hint="f.hint" :error="fieldErr[f.key]">
            <BaseInput :id="id" v-model="form[f.key] as number" type="number" :step="f.step" inputmode="numeric" :invalid="!!fieldErr[f.key]" />
          </FormField>
        </div>
      </BaseCard>

      <BaseCard>
        <h3 class="text-sm font-semibold text-ink">Fueling policy</h3>
        <div class="mt-4 space-y-4">
          <div>
            <BaseCheckbox v-model="form.always_fill_full">Always fill to full</BaseCheckbox>
            <p class="mt-1 text-xs text-ink-muted">Off (default) = min-drawdown: buy only enough to reach the next cheaper stop, topping off at the cheapest reachable one.</p>
          </div>
          <FormField v-if="!form.always_fill_full" v-slot="{ id }" label="Partial-fill cap (% of tank)" hint="Non-cheapest stops fill to at most this level (a full top-off still happens at the cheapest reachable stop and the California border)." :error="fieldErr.fill_cap_pct">
            <BaseInput :id="id" v-model="form.fill_cap_pct as number" type="number" step="1" inputmode="numeric" :invalid="!!fieldErr.fill_cap_pct" class="sm:max-w-xs" />
          </FormField>
          <div>
            <BaseCheckbox v-model="form.plan_def">Plan DEF stops</BaseCheckbox>
            <p class="mt-1 text-xs text-ink-muted">Include diesel exhaust fluid (DEF) in the plan.</p>
          </div>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField v-slot="{ id }" label="Preferred brands" hint="Comma-separated (e.g. pilot, flying_j).">
              <BaseInput :id="id" v-model="preferredBrands" placeholder="pilot, flying_j" />
            </FormField>
            <FormField v-slot="{ id }" label="Avoided brands" hint="Never routed to for a normal fill.">
              <BaseInput :id="id" v-model="avoidBrands" placeholder="one9" />
            </FormField>
            <FormField v-slot="{ id }" label="Emergency brands" hint="Allowed only for an emergency splash.">
              <BaseInput :id="id" v-model="emergencyBrands" placeholder="one9" />
            </FormField>
            <FormField v-slot="{ id }" label="Avoided states" hint="2-letter, comma-separated (e.g. CA). Fuel is avoided here; enter full.">
              <BaseInput :id="id" v-model="avoidStates" placeholder="CA" />
            </FormField>
            <FormField v-slot="{ id }" label="Fuel-before states" hint="Top off before entering (sparse fueling, e.g. MA). Stations here stay usable.">
              <BaseInput :id="id" v-model="fuelBeforeStates" placeholder="MA" />
            </FormField>
          </div>
        </div>
      </BaseCard>

      <BaseCard>
        <h3 class="text-sm font-semibold text-ink">Default truck profile</h3>
        <p class="mt-1 text-sm text-ink-muted">Used for HERE truck routing when a vehicle has no stored dimensions. Per-truck values override these.</p>
        <div class="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <FormField v-for="f in truck" :key="f.key" v-slot="{ id }" :label="f.label" :hint="f.hint" :error="fieldErr[f.key]">
            <BaseInput :id="id" v-model="form[f.key] as number" type="number" :step="f.step" inputmode="numeric" :invalid="!!fieldErr[f.key]" />
          </FormField>
        </div>
      </BaseCard>

      <div class="flex justify-end">
        <BaseButton variant="primary" type="submit" :disabled="save.isPending.value">
          {{ save.isPending.value ? "Saving…" : "Save settings" }}
        </BaseButton>
      </div>
    </form>

    <BaseCard>
      <h3 class="text-sm font-semibold text-ink">Chain discount rules</h3>
      <p class="mt-1 text-sm text-ink-muted">For chains that quote a posted price plus a contract discount. Pilot isn't needed here — its daily report already gives your net price.</p>
      <div class="mt-4 space-y-3">
        <div v-for="(r, i) in rules" :key="i" class="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <FormField v-slot="{ id }" label="Brand">
            <BaseInput :id="id" v-model="r.brand" placeholder="ta_petro" />
          </FormField>
          <FormField v-slot="{ id }" label="Type">
            <select :id="id" v-model="r.type" :class="SELECT_CLS">
              <option v-for="t in DISCOUNT_TYPES" :key="t" :value="t">{{ t }}</option>
            </select>
          </FormField>
          <FormField v-slot="{ id }" label="Cents off / gal">
            <BaseInput :id="id" v-model="r.cents_off" type="number" step="0.001" inputmode="decimal" />
          </FormField>
          <BaseButton variant="ghost" size="sm" type="button" @click="removeRule(i)"><XMarkIcon class="size-4" /></BaseButton>
        </div>
        <p v-if="!rules.length" class="text-sm text-ink-muted">No discount rules — planning uses net prices as loaded.</p>
        <div class="flex items-center justify-between">
          <BaseButton variant="ghost" size="sm" type="button" @click="addRule"><PlusIcon class="-ml-0.5 size-4" /> Add rule</BaseButton>
          <BaseButton variant="secondary" size="sm" type="button" :disabled="saveDiscounts.isPending.value" @click="onSaveDiscounts">
            {{ saveDiscounts.isPending.value ? "Saving…" : "Save discount rules" }}
          </BaseButton>
        </div>
      </div>
    </BaseCard>
  </div>
</template>
