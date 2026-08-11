<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { AppIcon } from "@fuelguard/ui";
import { ClipboardDocumentCheckIcon, PlusIcon, XMarkIcon } from "@fuelguard/ui/icons";
import type { HazmatProduct } from "@fuelguard/shared";
import { packageTypeSpec } from "@fuelguard/shared";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppInput as BaseInput } from "@fuelguard/ui";
import { AppCheckbox as BaseCheckbox } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import { AppCombobox as ComboSelect } from "@fuelguard/ui";
import ProductPicker from "@/features/hazmat/ProductPicker.vue";
import VerdictPanel from "@/features/hazmat/VerdictPanel.vue";
import { useHazmatTrailersQuery } from "@/features/hazmat/useHazmatEquipment";
import {
  buildCalcRequest,
  calcFormReady,
  emptyForm,
  emptyLine,
  equipmentFromTrailerType,
  equipmentSpec,
  useHazmatCalc,
  linePackagingDerivation,
  stripCitations,
  suggestedGrossLb,
  EQUIPMENT_OPTIONS,
  OTHER_FREIGHT_OPTIONS,
  TANK_STATE_OPTIONS,
  GROSS_WEIGHT_UNIT_OPTIONS,
  PACKAGE_TYPE_OPTIONS,
  CAPACITY_UNIT_OPTIONS,
  type CalcForm,
  type CalcLineForm,
  type CalcResult,
} from "@/features/hazmat/useHazmatCalc";

/**
 * `fleet` is off by default because this exact component IS the public marketing calculator
 * (`PublicPlacardCalculatorPage.vue`). An anonymous visitor has no organization, so the equipment
 * picker and the fleet query behind it must never mount there.
 *
 * LAYOUT (reworked again 2026-08, H-MX/UX pass):
 *  · EQUIPMENT is ONE question with two paths — "From my fleet" (trailer picker; the equipment is
 *    READ from the trailer and shown as a confirmation, not asked again) or "Other equipment"
 *    (the equipment picker alone). The old layout showed both controls side by side and read as two
 *    questions; users answered twice.
 *  · Each product line asks: what is it → how is it packed (type, count, optional per-package
 *    weight/volume) → what does it gross. The NET-quantity field is gone from this form — the placard
 *    ladder never reads it (every threshold runs on gross pounds), and it double-asked what the
 *    packaging block already established. When count × per-package weight are known, the gross is
 *    offered as a one-click suggestion, never silently applied.
 *  · CFR citations are stripped from all form copy (labels, hints, derived notes) — they live in the
 *    RESULTS panel, where they annotate an answer instead of intimidating a question. Plain-language
 *    grouping replaced the uppercase sub-headers.
 *  · "Offeror declarations" became "What the BOL declares" — same three verified claims, said in the
 *    words a dispatcher reads on the paper.
 *  · NEW (H-MX): "Any non-hazmat freight on this load?" — a tri-state that resolves the
 *    §172.301(a)(3) no-other-material condition instead of leaving it a standing assumption. It never
 *    touches the placard aggregate (hazmat-only by CFR).
 */
const props = withDefaults(defineProps<{ basePath?: string; fleet?: boolean }>(), {
  basePath: "/api/hazmat",
  fleet: false,
});

const form = reactive<CalcForm>(emptyForm());
const calc = useHazmatCalc(props.basePath);
const result = ref<CalcResult | null>(null);

const canCalculate = computed(() => calcFormReady(form));

// ── fleet equipment (authenticated calculator only) ─────────────────────────────────────────────
const fleetEnabled = computed(() => props.fleet);
// The hazmat feature reads trailers itself rather than importing the fleet feature's internals
// (the boundary rule — see this query's own header).
const { data: trailers } = useHazmatTrailersQuery({ enabled: fleetEnabled });
const selectedTrailerId = ref("");

/** One question, two paths: state the trailer (fleet) or state the equipment (manual/public). */
const sourceMode = ref<"fleet" | "manual">(props.fleet ? "fleet" : "manual");
/** True while the user is deliberately overriding a trailer-derived equipment answer. */
const equipmentOverride = ref(false);

const trailerOptions = computed(() =>
  (trailers.value ?? []).map((t) => ({
    value: t.id,
    label: t.trailer_type ? `${t.unit_number} — ${t.trailer_type.replace("_", " ")}` : t.unit_number,
  })),
);

const equipmentOptions = EQUIPMENT_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

function setSourceMode(mode: "fleet" | "manual") {
  if (sourceMode.value === mode) return;
  sourceMode.value = mode;
  equipmentOverride.value = false;
  if (mode === "manual") selectedTrailerId.value = "";
}

/**
 * Picking a trailer states the equipment instead of asking the user to restate it. The trailer's
 * type is the same source of truth the load path uses (`resolveVehicleKind`, D-H4), and the tank
 * capacity lives on the trailer row itself (H-C2), so the calculator and a real analysis of the
 * same equipment cannot disagree.
 */
function applyTrailer(id: string) {
  selectedTrailerId.value = id;
  equipmentOverride.value = false;
  if (!id) return;
  const trailer = (trailers.value ?? []).find((t) => t.id === id);
  if (!trailer) return;
  applyEquipment(equipmentFromTrailerType(trailer.trailer_type));
  form.cargoTankCapacityGal = trailer.cargo_capacity_gal != null ? String(trailer.cargo_capacity_gal) : "";
}

/** Setting the equipment reshapes untouched lines to its defaults (bulk gallons on a tanker, …). */
function applyEquipment(value: string) {
  form.equipmentType = value;
  for (const line of form.lines) {
    if (line.product == null) Object.assign(line, emptyLine(value));
  }
}

const selectedTrailer = computed(() =>
  selectedTrailerId.value ? ((trailers.value ?? []).find((t) => t.id === selectedTrailerId.value) ?? null) : null,
);

/** The trailer answered the question — show the answer, don't re-ask it. */
const equipmentConfirmation = computed(() => {
  if (sourceMode.value !== "fleet" || !selectedTrailer.value || equipmentOverride.value) return null;
  if (form.equipmentType === "") return null; // trailer type unset → the picker asks instead
  const spec = equipmentSpec(form.equipmentType);
  return `${selectedTrailer.value.unit_number} is a ${spec?.label.toLowerCase() ?? form.equipmentType}${
    form.cargoTankCapacityGal ? ` · ${form.cargoTankCapacityGal} gal` : ""
  }`;
});

/** When the equipment must still be asked: manual mode, or a fleet trailer with no type on file. */
const showEquipmentPicker = computed(() => {
  if (sourceMode.value === "manual") return true;
  if (!selectedTrailer.value) return false;
  return form.equipmentType === "" || equipmentOverride.value;
});

const trailerTypeMissing = computed(
  () => sourceMode.value === "fleet" && selectedTrailer.value != null && form.equipmentType === "" && !equipmentOverride.value,
);

const isTank = computed(() => equipmentSpec(form.equipmentType)?.vehicleKind === "cargo_tank");
const packageHint = (type: string): string | undefined => {
  const hint = packageTypeSpec(type)?.hint;
  return hint ? stripCitations(hint) : undefined;
};

/** The measured bulk/non-bulk note for a line — loudest when it CONTRADICTS the type's default. */
function capacityNote(line: CalcLineForm): { text: string; warn: boolean } | null {
  const d = linePackagingDerivation(line, form.equipmentType);
  if (d.source !== "capacity" || !d.because) return null;
  return {
    text: (d.overrodeType ? "The per-package size overrides the package type — " : "Measured: ") + stripCitations(d.because) + ".",
    warn: d.overrodeType,
  };
}

/**
 * The bulk-or-packaged answer this line is currently sending to the engine, said out loud. It is the
 * single most consequential derived value on the form — bulk placards at any quantity, packaged
 * freight waits for the 1,001 lb threshold.
 */
function packagingBadge(line: CalcLineForm): { text: string; source: string } | null {
  if (!line.product && !line.packageType) return null;
  const d = linePackagingDerivation(line, form.equipmentType);
  const source =
    d.source === "capacity"
      ? "from the per-package size you entered"
      : d.source === "type"
        ? "from the package type"
        : "assumed from the equipment — set the package type to be sure";
  return { text: d.kind === "bulk" ? "Bulk packaging" : "Non-bulk packaging", source };
}

/** Per-package gross implied by what has been entered — the check that catches pallets-as-packages. */
function perPackageLb(line: CalcLineForm): number | null {
  const gross = Number(line.grossWeightValue);
  const count = Number(line.packageCount);
  if (!Number.isFinite(gross) || !Number.isFinite(count) || count <= 0 || line.grossWeightValue === "" || line.packageCount === "") return null;
  const lb = line.grossWeightUnit === "kg" ? gross * 2.20462 : gross;
  return Math.round(lb / count);
}

/** count × per-package weight, offered when the gross field is still blank — one click, never silent. */
function grossSuggestion(line: CalcLineForm): number | null {
  if (line.grossWeightValue !== "") return null;
  return suggestedGrossLb(line);
}
function applyGrossSuggestion(line: CalcLineForm) {
  const lb = suggestedGrossLb(line);
  if (lb == null) return;
  line.grossWeightValue = String(lb);
  line.grossWeightUnit = "lb";
}

function addLine() {
  form.lines.push(emptyLine(form.equipmentType));
}
function removeLine(i: number) {
  form.lines.splice(i, 1);
}
function selectProduct(i: number, product: HazmatProduct) {
  form.lines[i]!.product = product;
}
function clearProduct(i: number) {
  form.lines[i]!.product = null;
}
async function calculate() {
  result.value = await calc.mutateAsync(buildCalcRequest(form));
}
function resetAll() {
  selectedTrailerId.value = "";
  equipmentOverride.value = false;
  sourceMode.value = props.fleet ? "fleet" : "manual";
  Object.assign(form, emptyForm());
  result.value = null;
  calc.reset();
}
</script>

<template>
  <div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:grid-cols-2">
    <form class="min-w-0 space-y-4" @submit.prevent="calculate">
      <!-- ── 1 · equipment: one question, two paths ─────────────────────────────────────────── -->
      <BaseCard as="section">
        <div class="flex items-center gap-3">
          <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">1</span>
          <div>
            <h2 class="text-sm font-semibold text-ink">Equipment</h2>
            <p class="mt-0.5 text-sm text-ink-muted">What the load rides on — this decides which rules apply.</p>
          </div>
        </div>

        <!-- fleet users choose the path; the public calculator goes straight to the picker -->
        <div v-if="fleet" class="mt-4 inline-flex rounded-control bg-surface-subtle p-1 ring-1 ring-inset ring-edge" role="group" aria-label="Where the equipment comes from">
          <button
            type="button"
            class="rounded-control px-3 py-1.5 text-sm font-medium transition-colors"
            :class="sourceMode === 'fleet' ? 'bg-surface text-ink shadow-sm ring-1 ring-inset ring-edge' : 'text-ink-muted hover:text-ink'"
            @click="setSourceMode('fleet')"
          >
            From my fleet
          </button>
          <button
            type="button"
            class="rounded-control px-3 py-1.5 text-sm font-medium transition-colors"
            :class="sourceMode === 'manual' ? 'bg-surface text-ink shadow-sm ring-1 ring-inset ring-edge' : 'text-ink-muted hover:text-ink'"
            @click="setSourceMode('manual')"
          >
            Other equipment
          </button>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <!-- Fleet path: the trailer states the answer. Never mounted on the public page. -->
          <FormField
            v-if="fleet && sourceMode === 'fleet'"
            v-slot="{ id }"
            label="Trailer"
            hint="The equipment and tank capacity are read from the trailer."
          >
            <ComboSelect
              :id="id"
              :model-value="selectedTrailerId"
              :options="trailerOptions"
              placeholder="Search trailers…"
              @update:model-value="applyTrailer"
            />
          </FormField>

          <FormField
            v-if="showEquipmentPicker"
            v-slot="{ id }"
            label="Equipment"
            required
            :hint="
              form.equipmentType === ''
                ? 'Bulk tank or packaged freight changes the whole answer — there is no safe default.'
                : undefined
            "
          >
            <ComboSelect
              :id="id"
              :model-value="form.equipmentType"
              :options="equipmentOptions"
              placeholder="Select…"
              @update:model-value="applyEquipment"
            />
          </FormField>

          <!-- Tank-only fields stay together so the card does not reflow around them. -->
          <template v-if="isTank">
            <FormField
              v-slot="{ id }"
              label="Cargo tank capacity"
              hint="Optional — used when capacity affects the cargo-tank requirements."
            >
              <div class="flex items-stretch gap-2">
                <BaseInput :id="id" v-model="form.cargoTankCapacityGal" class="min-w-0 flex-1" type="number" inputmode="decimal" min="0" placeholder="9200" />
                <span class="flex shrink-0 items-center rounded-control bg-surface-subtle px-3 text-sm text-ink-muted ring-1 ring-inset ring-edge">gal</span>
              </div>
            </FormField>
            <FormField v-slot="{ id }" label="Tank state">
              <ComboSelect :id="id" v-model="form.tankState" :options="TANK_STATE_OPTIONS" />
            </FormField>
          </template>
        </div>

        <!-- the trailer answered — confirm it instead of asking again -->
        <p
          v-if="equipmentConfirmation"
          class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-control bg-surface-subtle px-3 py-2 text-xs text-ink-secondary ring-1 ring-inset ring-edge"
        >
          <span>Read from the fleet: <strong class="font-semibold text-ink">{{ equipmentConfirmation }}</strong></span>
          <button type="button" class="font-medium text-brand-700 hover:underline" @click="equipmentOverride = true">Change</button>
        </p>
        <p
          v-else-if="trailerTypeMissing"
          class="mt-3 rounded-surface bg-warning-50 px-3 py-2 text-xs text-warning-800 ring-1 ring-inset ring-warning-200"
        >
          This trailer's type is not set — pick the equipment above, and set the type on the Trailers page so next time it is read rather than asked.
        </p>
      </BaseCard>

      <!-- ── 2 · regulated products ─────────────────────────────────────────────────────────── -->
      <BaseCard as="section">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-center gap-3">
            <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">2</span>
            <div>
              <h2 class="text-sm font-semibold text-ink">Regulated products</h2>
              <p class="mt-0.5 text-sm text-ink-muted">Add every hazardous material declared on the load, as the BOL states it.</p>
            </div>
          </div>
          <BaseButton variant="soft" size="sm" @click="addLine">
            <AppIcon :icon="PlusIcon" class="size-4" aria-hidden="true" />
            Add product
          </BaseButton>
        </div>

        <div class="mt-4 space-y-4">
          <div v-for="(line, i) in form.lines" :key="i" class="overflow-hidden rounded-dialog ring-1 ring-inset ring-edge">
            <!-- identify -->
            <div class="flex items-center justify-between gap-2 border-b border-edge bg-surface-subtle px-4 py-2">
              <p class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Product {{ i + 1 }}</p>
              <BaseButton v-if="form.lines.length > 1" variant="ghost" size="sm" @click="removeLine(i)">
                <AppIcon :icon="XMarkIcon" class="size-4" aria-hidden="true" />
                Remove
              </BaseButton>
            </div>

            <div class="space-y-4 p-4">
              <template v-if="line.product">
                <div class="flex items-center justify-between gap-2 rounded-control bg-surface px-3 py-2 ring-1 ring-inset ring-edge">
                  <span class="truncate text-sm text-ink">{{ line.product.label }}</span>
                  <BaseButton variant="ghost" size="sm" @click="clearProduct(i)">Change</BaseButton>
                </div>
              </template>
              <ProductPicker v-else :base-path="props.basePath" @select="(p) => selectProduct(i, p)" />

              <!-- how it's packed -->
              <div class="space-y-3 border-t border-edge pt-4">
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField
                    v-slot="{ id }"
                    label="Package type"
                    class="sm:col-span-2"
                    :hint="packageHint(line.packageType) ?? 'As the BOL states it — drums, totes, boxes, or the tank itself.'"
                  >
                    <ComboSelect
                      :id="id"
                      :model-value="line.packageType"
                      :options="PACKAGE_TYPE_OPTIONS"
                      placeholder="Drums, totes, boxes…"
                      @update:model-value="(v: string) => (line.packageType = v)"
                    />
                  </FormField>

                  <FormField
                    v-if="line.packageType !== 'bulk_cargo'"
                    v-slot="{ id }"
                    label="Package count"
                    hint="Count the drums or boxes themselves, not the pallets they ride on."
                  >
                    <BaseInput :id="id" v-model="line.packageCount" type="number" inputmode="numeric" min="0" placeholder="1056" />
                  </FormField>

                  <FormField v-if="isTank && line.packageType === 'bulk_cargo'" v-slot="{ id }" label="Compartment #">
                    <BaseInput :id="id" v-model="line.compartmentIndex" type="number" inputmode="numeric" min="1" placeholder="1" />
                  </FormField>

                  <!-- Value and unit are ONE control — split across a grid break, this is the field
                       most likely to be filled in wrongly. -->
                  <FormField
                    v-if="line.packageType !== 'bulk_cargo'"
                    v-slot="{ id }"
                    label="Per package (optional)"
                    hint="Weight or volume of one package, if the BOL lists it."
                  >
                    <div class="flex items-stretch gap-2">
                      <BaseInput :id="id" v-model="line.perPackageCapacityValue" class="min-w-0 flex-1" type="number" inputmode="decimal" min="0" placeholder="55" />
                      <ComboSelect v-model="line.perPackageCapacityUnit" class="w-32 shrink-0" :options="CAPACITY_UNIT_OPTIONS" />
                    </div>
                  </FormField>
                </div>

                <!-- the derived bulk/packaged answer, said out loud -->
                <p
                  v-if="packagingBadge(line)"
                  class="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-control bg-surface-subtle px-3 py-2 text-xs ring-1 ring-inset ring-edge"
                >
                  <span class="font-semibold text-ink">{{ packagingBadge(line)!.text }}</span>
                  <span class="text-ink-muted">{{ packagingBadge(line)!.source }}</span>
                </p>
                <p
                  v-if="capacityNote(line)"
                  class="rounded-control px-3 py-1.5 text-xs ring-1 ring-inset"
                  :class="capacityNote(line)!.warn ? 'bg-warning-50 text-warning-800 ring-warning-200' : 'bg-surface text-ink-muted ring-edge'"
                >
                  {{ capacityNote(line)!.text }}
                </p>
              </div>

              <!-- what it grosses -->
              <div class="space-y-2 border-t border-edge pt-4">
                <FormField
                  v-slot="{ id }"
                  label="Gross weight of this product"
                  hint="Packages plus contents, from the BOL — the placard thresholds run on this."
                >
                  <div class="flex items-stretch gap-2">
                    <BaseInput :id="id" v-model="line.grossWeightValue" class="min-w-0 flex-1" type="number" inputmode="decimal" min="0" placeholder="44307" />
                    <ComboSelect v-model="line.grossWeightUnit" class="w-24 shrink-0" :options="GROSS_WEIGHT_UNIT_OPTIONS" />
                  </div>
                </FormField>
                <p v-if="grossSuggestion(line) != null" class="text-xs text-ink-muted">
                  {{ line.packageCount }} × {{ line.perPackageCapacityValue }} {{ line.perPackageCapacityUnit }} works out to
                  <strong class="text-ink">{{ grossSuggestion(line)!.toLocaleString("en-US") }} lb</strong> —
                  <button type="button" class="font-medium text-brand-700 hover:underline" @click="applyGrossSuggestion(line)">use it</button>.
                </p>
                <p v-if="perPackageLb(line) != null" class="text-xs text-ink-muted">
                  That works out to <strong class="text-ink">{{ perPackageLb(line) }} lb</strong> per package —
                  if that looks like a pallet rather than a package, the count is the thing to fix.
                </p>
              </div>

              <!-- what the paper declares -->
              <div class="space-y-2 rounded-surface bg-surface-subtle p-3 ring-1 ring-inset ring-edge">
                <p class="text-sm font-medium text-ink">What the BOL declares</p>
                <p class="text-xs text-ink-muted">
                  Tick only what the shipping paper actually says — each one changes the answer, and the
                  engine double-checks every claim rather than taking it on trust.
                </p>
                <div class="space-y-1.5 pt-1">
                  <BaseCheckbox v-model="line.isResidueLine">Residue only — the packaging is empty but not cleaned</BaseCheckbox>
                  <BaseCheckbox v-model="line.isLimitedQuantity">Marked “Limited Quantity” on the BOL</BaseCheckbox>
                  <BaseCheckbox v-model="line.reclassedCombustible">Reclassified combustible by the shipper</BaseCheckbox>
                </div>
              </div>
            </div>
          </div>
        </div>
      </BaseCard>

      <!-- ── 3 · the rest of the load (H-MX) ────────────────────────────────────────────────── -->
      <BaseCard as="section">
        <div class="flex items-center gap-3">
          <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">3</span>
          <div>
            <h2 class="text-sm font-semibold text-ink">Rest of the load</h2>
            <p class="mt-0.5 text-sm text-ink-muted">Whether anything besides these products rides on the truck.</p>
          </div>
        </div>
        <div class="mt-4">
          <FormField
            v-slot="{ id }"
            label="Any non-hazmat freight on this load?"
            hint="Never changes which placards you need — but on a large single-product package load it decides whether the UN number must also be displayed on the vehicle."
          >
            <ComboSelect :id="id" v-model="form.otherFreight" :options="OTHER_FREIGHT_OPTIONS" />
          </FormField>
        </div>
      </BaseCard>

      <!-- ── 4 · trip context ───────────────────────────────────────────────────────────────── -->
      <BaseCard as="section">
        <div class="flex items-center gap-3">
          <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">4</span>
          <div>
            <h2 class="text-sm font-semibold text-ink">Trip context</h2>
            <p class="mt-0.5 text-sm text-ink-muted">Optional — facts about the run rather than the freight.</p>
          </div>
        </div>
        <div class="mt-4">
          <FormField
            v-slot="{ id }"
            label="ID numbers still displayed from an earlier load today"
            hint="If placards or number panels from the previous or current business day are still on the truck, list those IDs. Comma-separated; leave blank if none."
          >
            <BaseInput :id="id" v-model="form.businessDayIds" placeholder="UN1830, UN1789" />
          </FormField>
        </div>
      </BaseCard>

      <div class="flex flex-wrap items-center gap-3">
        <BaseButton type="submit" variant="primary" :disabled="!canCalculate || calc.isPending.value">
          <AppIcon :icon="ClipboardDocumentCheckIcon" class="size-4" aria-hidden="true" />
          {{ calc.isPending.value ? "Calculating…" : "Calculate placards" }}
        </BaseButton>
        <BaseButton variant="secondary" type="button" @click="resetAll">Reset</BaseButton>
      </div>
      <p v-if="!canCalculate" class="text-xs text-ink-muted">Choose the equipment and add at least one regulated product to calculate.</p>

      <p v-if="calc.isError.value" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
        {{ calc.error.value instanceof Error ? calc.error.value.message : "Calculation failed." }}
      </p>
    </form>

    <div class="min-w-0 lg:sticky lg:top-20 lg:self-start">
      <VerdictPanel v-if="result" :result="result" />
      <BaseCard v-else class="text-center">
        <div class="py-10">
          <span class="mx-auto flex size-11 items-center justify-center rounded-surface bg-brand-50 text-brand-700">
            <AppIcon :icon="ClipboardDocumentCheckIcon" class="size-6" aria-hidden="true" />
          </span>
          <p class="mt-3 text-sm font-medium text-ink">Results will appear here</p>
          <p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">Complete the equipment and product details, then calculate to see placards, ID displays, the weight arithmetic, and citations.</p>
        </div>
      </BaseCard>
    </div>
  </div>
</template>
