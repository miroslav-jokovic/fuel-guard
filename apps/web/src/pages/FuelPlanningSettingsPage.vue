<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import {
  PlusIcon,
  XMarkIcon,
} from "@silvicom/ui/icons";
import { reactive, ref, computed, watch } from "vue";
import { routeFuelSettingsFormSchema, ROUTE_FUEL_SETTINGS_DEFAULTS, BRAND_LABELS, EQUIPMENT_TYPES, AVOIDED_STATE_TARGET_PERIOD, STATE_NAMES, type RouteFuelSettingsForm } from "@silvicom/shared";
import { useRouteFuelSettings, useSaveRouteFuelSettings } from "@/composables/useRouteFuelSettings";
import { useToastStore } from "@/stores/toast";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppCard as BaseCard } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppCheckbox as BaseCheckbox } from "@silvicom/ui";
import { AppSelect } from "@silvicom/ui";
import { AppFormField as FormField } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useDiscountRules, useSaveDiscountRules, DISCOUNT_TYPES, type DiscountRule } from "@/features/fueling/useDiscountRules";

/**
 * The page is the planner's rule order, and holds only fields the planner reads (D-FP6,
 * docs/plans/fuel/FUEL-PLANNING-PRECISION-PLAN.md). Until 2026-09-10 it held two fields nothing read
 * (off-route recompute, DEF), one list no rule consulted (emergency brands), three fields of a policy
 * the owner retired (min-drawdown), and lacked the five numbers the planner actually ran on — the fill
 * target, the refuel window, the critical threshold, the opposite-side detour and the border top-off —
 * because they were constants or read from columns that did not exist (0335 gave them columns). The
 * owner's words for the standard: "fueled when it gets to 20% to the top … without any overcomplications".
 */
const { data, isLoading } = useRouteFuelSettings();
const save = useSaveRouteFuelSettings();
const toast = useToastStore();

const form = reactive<RouteFuelSettingsForm>({ ...ROUTE_FUEL_SETTINGS_DEFAULTS });
watch(data, (d) => { if (d) Object.assign(form, d); }, { immediate: true });

// States edit as comma-separated codes; each parsed code is echoed back as a chip with its name so a
// typo shows as "not a state" instead of silently never matching a station.
const csv = (key: "avoid_states" | "fuel_before_states") =>
  computed({
    get: () => (form[key] ?? []).join(", "),
    set: (v: string) => {
      form[key] = v.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    },
  });
const avoidStates = csv("avoid_states");
const fuelBeforeStates = csv("fuel_before_states");
const stateChips = (codes: string[]) => codes.map((c) => ({ code: c, name: STATE_NAMES[c] ?? null }));

// Networks the org has turned ON (hard registry filter). Rendered as checkboxes from the brand catalog;
// brands already enabled but no longer in the catalog (defensive) still render so they can be turned off.
const networkOptions = computed(() => {
  const known = Object.entries(BRAND_LABELS).map(([value, label]) => ({ value, label }));
  const extra = (form.enabled_brands ?? []).filter((b) => !(b in BRAND_LABELS)).map((b) => ({ value: b, label: b }));
  return [...known, ...extra];
});
const inList = (key: "enabled_brands" | "preferred_brands" | "avoid_brands", brand: string) => (form[key] ?? []).includes(brand);
function setInList(key: "enabled_brands" | "preferred_brands" | "avoid_brands", brand: string, on: boolean) {
  const set = new Set(form[key] ?? []);
  if (on) set.add(brand);
  else set.delete(brand);
  form[key] = [...set];
}
// The brand ladder has one rung per brand (D-FP4): preferred and avoided are exclusive, and a network
// that is turned off is on no rung at all.
function toggleNetwork(brand: string, on: boolean) {
  setInList("enabled_brands", brand, on);
  if (!on) { setInList("preferred_brands", brand, false); setInList("avoid_brands", brand, false); }
}
function togglePreferred(brand: string, on: boolean) {
  setInList("preferred_brands", brand, on);
  if (on) setInList("avoid_brands", brand, false);
}
function toggleAvoided(brand: string, on: boolean) {
  setInList("avoid_brands", brand, on);
  if (on) setInList("preferred_brands", brand, false);
}
const enabledOptions = computed(() => networkOptions.value.filter((o) => inList("enabled_brands", o.value)));
const offNetworkBrands = computed(() =>
  enabledOptions.value.filter((o) => !inList("preferred_brands", o.value) && !inList("avoid_brands", o.value)).map((o) => o.label),
);

// What the tank rules mean in miles, on a reference truck, so a change to any of them reads as a
// distance rather than a percentage. The reference is stated in the sentence; a real truck's own
// capacity and measured MPG are what the planner uses.
const REF_TANK_GAL = 200;
const REF_MPG = 6.5;
const exampleMiles = computed(() => {
  const fill = Number(form.fill_target_pct), reserve = Number(form.reserve_pct), factor = Number(form.mpg_safety_factor);
  if (![fill, reserve, factor].every(Number.isFinite) || fill <= reserve) return null;
  return Math.round(((fill - reserve) / 100) * REF_TANK_GAL * REF_MPG * factor);
});

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
    toast.success("Fuel planning settings saved");
  } catch (e) {
    toast.error("Could not save settings", e instanceof Error ? e.message : undefined);
  }
}

// Per-brand discount rules (independent save; separate table). Offered for the enabled brands only —
// a rule for a network the planner never considers is a setting with no reader.
const { data: discountData } = useDiscountRules();
const saveDiscounts = useSaveDiscountRules();
const rules = ref<DiscountRule[]>([]);
watch(discountData, (d) => { if (d) rules.value = d.map((r) => ({ ...r })); }, { immediate: true });
function addRule() { rules.value.push({ brand: enabledOptions.value[0]?.value ?? "", type: "flat", cents_off: 0 }); }
function removeRule(i: number) { rules.value.splice(i, 1); }
const discountTypeOptions = DISCOUNT_TYPES.map((value) => ({ value, label: value }));
async function onSaveDiscounts() {
  try {
    await saveDiscounts.mutateAsync(rules.value);
    toast.success("Discount rules saved");
  } catch (e) {
    toast.error("Could not save discount rules", e instanceof Error ? e.message : undefined);
  }
}

interface NumField { key: keyof RouteFuelSettingsForm; label: string; hint?: string; step?: string }
const tank: NumField[] = [
  { key: "fill_target_pct", label: "Fill to (% of tank)", hint: "Every planned fill tops the tank up to here. 100 is to the top.", step: "1" },
  { key: "reserve_pct", label: "Reserve (% of tank)", hint: "The gauge reading the planner never goes below. Every stop is placed so the truck arrives at or above it.", step: "1" },
  { key: "mpg_safety_factor", label: "MPG safety factor", hint: "Range is planned on the truck's measured MPG times this. 0.9 keeps a tenth in hand; 1.0 plans on the measured figure.", step: "0.01" },
  { key: "refuel_band_miles", label: "Refuel window (mi)", hint: "A stop is chosen only inside the last this-many miles of range above the reserve, so the tank runs down before it is filled.", step: "10" },
  { key: "critical_fuel_pct", label: "Critical fuel (% of tank)", hint: "At or below this with no preferred station in range, the nearest pump is an emergency whatever its brand. Never above the reserve.", step: "1" },
];
const corridor: NumField[] = [
  { key: "corridor_miles", label: "Corridor buffer (mi)", hint: "How far off the route a station may sit to be considered.", step: "0.5" },
  { key: "opposite_side_access_miles", label: "Opposite-side detour (mi)", hint: "Extra miles charged to a station on the other side of a divided highway. 0 turns it off.", step: "0.5" },
  { key: "border_top_off_pct", label: "Top off before a border unless above (% of tank)", hint: "Entering an avoided or fuel-before state, the truck fills at the last preferred station before the line unless it would already cross above this.", step: "1" },
];
const emergencies: NumField[] = [
  { key: "emergency_fill_gallons", label: "Emergency splash (gal)", hint: "The most bought inside an avoided state. Elsewhere an emergency buys just enough to reach the next preferred station, and never less than this.", step: "1" },
];
const prices: NumField[] = [
  { key: "price_ttl_hours", label: "Price freshness (hours)", hint: "A quote older than this is not a price. The planner estimates from the station's history instead and labels the stop as an estimate.", step: "1" },
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
    <PageHeader description="How the planner places fuel stops, in the order it applies the rules: the tank, then the stations it may use, then emergencies, then prices. Every field here is read by the planner. Applies company-wide." />

    <p v-if="isLoading" class="text-sm text-ink-muted">Loading…</p>

    <form v-else class="space-y-6" @submit.prevent="onSave">
      <BaseCard>
        <h3 class="text-sm font-semibold text-ink">1. Tank and safety</h3>
        <p class="mt-1 text-sm text-ink-muted">
          A stop goes where the tank needs it and nowhere else: full to the fill target, placed so the truck never
          drops below the reserve.
          <span v-if="exampleMiles != null">
            With these values a {{ REF_TANK_GAL }}-gal truck at {{ REF_MPG }} MPG runs about
            <strong class="text-ink">{{ exampleMiles.toLocaleString() }} mi</strong> between fills.
          </span>
        </p>
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField v-for="f in tank" :key="f.key" v-slot="{ id }" :label="f.label" :hint="f.hint" :error="fieldErr[f.key]">
            <BaseInput :id="id" v-model="form[f.key] as number" type="number" :step="f.step" inputmode="decimal" :invalid="!!fieldErr[f.key]" />
          </FormField>
        </div>
      </BaseCard>

      <BaseCard>
        <h3 class="text-sm font-semibold text-ink">2. Stations</h3>
        <p class="mt-1 text-sm text-ink-muted">
          Networks turned on are the only ones the planner ever considers. Within them, a planned fill goes to a
          preferred brand first, cheapest wins; an enabled brand that is neither preferred nor avoided is used only
          when no preferred station is in range, and the stop is flagged off-network; an avoided brand, or any
          station in an avoided state, is an emergency only.
        </p>
        <div class="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div>
            <p class="text-sm font-medium text-ink-secondary">Networks on</p>
            <p class="text-xs text-ink-muted">Turn one on once its locations and prices are loaded.</p>
            <div class="mt-2 space-y-1.5">
              <BaseCheckbox v-for="opt in networkOptions" :key="opt.value" :model-value="inList('enabled_brands', opt.value)" @update:model-value="(v: boolean) => toggleNetwork(opt.value, v)">
                {{ opt.label }}
              </BaseCheckbox>
            </div>
            <p v-if="fieldErr.enabled_brands" class="mt-2 text-sm text-danger-600">{{ fieldErr.enabled_brands }}</p>
          </div>
          <div>
            <p class="text-sm font-medium text-ink-secondary">Preferred</p>
            <p class="text-xs text-ink-muted">Planned fills go here first.</p>
            <div class="mt-2 space-y-1.5">
              <BaseCheckbox v-for="opt in enabledOptions" :key="opt.value" :model-value="inList('preferred_brands', opt.value)" @update:model-value="(v: boolean) => togglePreferred(opt.value, v)">
                {{ opt.label }}
              </BaseCheckbox>
            </div>
          </div>
          <div>
            <p class="text-sm font-medium text-ink-secondary">Emergency only</p>
            <p class="text-xs text-ink-muted">Used only when nothing else is in range, and then a splash, never a fill.</p>
            <div class="mt-2 space-y-1.5">
              <BaseCheckbox v-for="opt in enabledOptions" :key="opt.value" :model-value="inList('avoid_brands', opt.value)" @update:model-value="(v: boolean) => toggleAvoided(opt.value, v)">
                {{ opt.label }}
              </BaseCheckbox>
            </div>
          </div>
        </div>
        <p class="mt-3 text-xs text-ink-muted">
          <template v-if="offNetworkBrands.length">Off-network when nothing preferred is in range: {{ offNetworkBrands.join(", ") }}.</template>
          <template v-else>Every enabled network is either preferred or emergency-only, so no stop can be off-network.</template>
        </p>

        <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="Avoided states" hint="Two-letter codes, comma-separated. Fuel here is emergency only, and the truck tops off before crossing in — the California rule." :error="fieldErr.avoid_states">
            <BaseInput :id="id" v-model="avoidStates" placeholder="CA" />
            <div v-if="form.avoid_states.length" class="mt-1.5 flex flex-wrap gap-1">
              <span v-for="c in stateChips(form.avoid_states)" :key="c.code" :class="[BADGE_BASE, toneClass(c.name ? 'neutral' : 'warning')]">{{ c.code }}<template v-if="c.name"> · {{ c.name }}</template><template v-else> · not a state code</template></span>
            </div>
          </FormField>
          <FormField v-slot="{ id }" label="Fuel-before states" hint="Top off before entering (sparse fueling, e.g. Massachusetts). Stations inside stay usable." :error="fieldErr.fuel_before_states">
            <BaseInput :id="id" v-model="fuelBeforeStates" placeholder="MA" />
            <div v-if="form.fuel_before_states.length" class="mt-1.5 flex flex-wrap gap-1">
              <span v-for="c in stateChips(form.fuel_before_states)" :key="c.code" :class="[BADGE_BASE, toneClass(c.name ? 'neutral' : 'warning')]">{{ c.code }}<template v-if="c.name"> · {{ c.name }}</template><template v-else> · not a state code</template></span>
            </div>
          </FormField>
        </div>
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField v-for="f in corridor" :key="f.key" v-slot="{ id }" :label="f.label" :hint="f.hint" :error="fieldErr[f.key]">
            <BaseInput :id="id" v-model="form[f.key] as number" type="number" :step="f.step" inputmode="decimal" :invalid="!!fieldErr[f.key]" />
          </FormField>
        </div>

        <!--
          Targets, beside the lists they grade (C8, D-FUI10). Deliberately in this card and not in a
          section of their own: a target belongs to the rule it qualifies, and "at least 90% on the
          preferred network" is unreadable three cards away from which brands those are.

          Every one is optional and BLANK BY DEFAULT. The product does not invent a carrier's own
          standard — see `optionalTarget` in the settings schema for what a blank field must not
          become, and 0325 for why these three columns break this table's not-null convention.
        -->
        <div class="mt-6 border-t border-edge pt-4">
          <h4 class="text-sm font-semibold text-ink">Targets</h4>
          <p class="mt-1 text-sm text-ink-muted">
            What you hold the fleet to. Leave a target blank and the matching figure is reported without a
            standard beside it — nothing here is assumed on your behalf.
          </p>
          <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField v-slot="{ id }" label="On-network share (%)" hint="At least this share of gallons at your preferred brands." :error="fieldErr.target_on_network_pct">
              <BaseInput :id="id" v-model="form.target_on_network_pct" type="number" min="0" max="100" step="1" placeholder="No target" />
            </FormField>
            <FormField v-slot="{ id }" label="Discount capture (%)" hint="At least this share of the discount available to you, actually taken." :error="fieldErr.target_discount_capture_pct">
              <BaseInput :id="id" v-model="form.target_discount_capture_pct" type="number" min="0" max="100" step="1" placeholder="No target" />
            </FormField>
            <FormField v-slot="{ id }" :label="`Avoided-state gallons / ${AVOIDED_STATE_TARGET_PERIOD}`" :hint="`At most this many gallons a ${AVOIDED_STATE_TARGET_PERIOD} bought in the states above. A ceiling, not a floor.`" :error="fieldErr.target_avoided_state_gal">
              <BaseInput :id="id" v-model="form.target_avoided_state_gal" type="number" min="0" step="10" placeholder="No target" />
            </FormField>
          </div>
        </div>
      </BaseCard>

      <BaseCard>
        <h3 class="text-sm font-semibold text-ink">3. Emergencies</h3>
        <p class="mt-1 text-sm text-ink-muted">A planned stop is always a full fill. An emergency — nothing preferred in range and the tank at the critical level, or only an avoided pump in reach — is the one time the planner buys less.</p>
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-for="f in emergencies" :key="f.key" v-slot="{ id }" :label="f.label" :hint="f.hint" :error="fieldErr[f.key]">
            <BaseInput :id="id" v-model="form[f.key] as number" type="number" :step="f.step" inputmode="decimal" :invalid="!!fieldErr[f.key]" />
          </FormField>
        </div>
      </BaseCard>

      <BaseCard>
        <h3 class="text-sm font-semibold text-ink">4. Prices</h3>
        <p class="mt-1 text-sm text-ink-muted">Every stop shows the pump price and your price. Your daily report already carries both; a posted-only network needs a discount rule below to know yours.</p>
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-for="f in prices" :key="f.key" v-slot="{ id }" :label="f.label" :hint="f.hint" :error="fieldErr[f.key]">
            <BaseInput :id="id" v-model="form[f.key] as number" type="number" :step="f.step" inputmode="numeric" :invalid="!!fieldErr[f.key]" />
          </FormField>
        </div>
      </BaseCard>

      <BaseCard>
        <h3 class="text-sm font-semibold text-ink">5. Load and truck defaults</h3>
        <p class="mt-1 text-sm text-ink-muted">Your fleet's usual trailer pre-fills every new plan so hazmat is never assumed; dispatchers can still change it per load. The truck profile is used for routing when a vehicle has no stored dimensions.</p>
        <FormField v-slot="{ id }" label="Default equipment / trailer" class="mt-4 sm:max-w-xs">
          <AppSelect :id="id" v-model="form.default_equipment_type" :options="EQUIPMENT_TYPES" />
        </FormField>
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
      <p class="mt-1 text-sm text-ink-muted">For networks that publish a posted price and give you a contract discount off it. Pilot and Flying J need no rule — the daily report already carries your price.</p>
      <div class="mt-4 space-y-3">
        <div v-for="(r, i) in rules" :key="i" class="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <FormField v-slot="{ id }" label="Brand">
            <AppSelect :id="id" v-model="r.brand" :options="enabledOptions" />
          </FormField>
          <FormField v-slot="{ id }" label="Type">
            <AppSelect :id="id" v-model="r.type" :options="discountTypeOptions" />
          </FormField>
          <FormField v-slot="{ id }" label="Cents off / gal">
            <BaseInput :id="id" v-model="r.cents_off" type="number" step="0.001" inputmode="decimal" />
          </FormField>
          <BaseButton variant="ghost" size="sm" type="button" @click="removeRule(i)"><AppIcon :icon="XMarkIcon" class="size-4" /></BaseButton>
        </div>
        <p v-if="!rules.length" class="text-sm text-ink-muted">No discount rules — a posted-only network's price is your price.</p>
        <div class="flex items-center justify-between">
          <BaseButton variant="ghost" size="sm" type="button" @click="addRule"><AppIcon :icon="PlusIcon" class="-ml-0.5 size-4" /> Add rule</BaseButton>
          <BaseButton variant="secondary" size="sm" type="button" :disabled="saveDiscounts.isPending.value" @click="onSaveDiscounts">
            {{ saveDiscounts.isPending.value ? "Saving…" : "Save discount rules" }}
          </BaseButton>
        </div>
      </div>
    </BaseCard>
  </div>
</template>
