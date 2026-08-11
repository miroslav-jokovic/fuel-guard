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
  EQUIPMENT_OPTIONS,
  TANK_STATE_OPTIONS,
  QUANTITY_UNIT_OPTIONS,
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
 * LAYOUT (reworked 2026-08): the form asked the right questions in the wrong shapes. A measurement and
 * its unit are ONE fact, and a 4-column grid kept splitting them across a row break — "Per-package
 * size" would land at the end of one row with "Size unit" orphaned at the start of the next, which is
 * how a 4-gallon fiberboard box gets entered as 4 of something else. Value+unit are now single
 * controls, the line is grouped identify → package → measure → declare, and the offeror declarations
 * (residue, LQ, reclassified combustible) sit in their own block because each one changes the answer
 * and none of them should read as an afterthought checkbox.
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
const trailerOptions = computed(() => [
  { value: "", label: "Not from the fleet" },
  ...(trailers.value ?? []).map((t) => ({
    value: t.id,
    label: t.trailer_type ? `${t.unit_number} — ${t.trailer_type.replace("_", " ")}` : t.unit_number,
  })),
]);

const equipmentOptions = EQUIPMENT_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

/**
 * Picking a trailer states the equipment instead of asking the user to restate it. The trailer's
 * type is the same source of truth the load path uses (`resolveVehicleKind`, D-H4), and the tank
 * capacity now lives on the trailer row itself (H-C2), so the calculator and a real analysis of the
 * same equipment cannot disagree.
 */
function applyTrailer(id: string) {
  selectedTrailerId.value = id;
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

const equipmentNote = computed(() => {
  if (!selectedTrailerId.value) return null;
  const trailer = (trailers.value ?? []).find((t) => t.id === selectedTrailerId.value);
  if (!trailer) return null;
  if (form.equipmentType === "") {
    return { warn: true, text: "This trailer's type is not set — pick the equipment above, and set the type on the Trailers page so next time it is read rather than asked." };
  }
  return { warn: false, text: `Equipment read from the fleet: ${trailer.unit_number} is a ${equipmentSpec(form.equipmentType)?.label.toLowerCase() ?? form.equipmentType}.` };
});

const isTank = computed(() => equipmentSpec(form.equipmentType)?.vehicleKind === "cargo_tank");
const packageHint = (type: string): string | undefined => packageTypeSpec(type)?.hint;

/** D-H14: the measured §171.8 note for a line — shown whenever a capacity was applied, loudest
 *  when it CONTRADICTS the package type's default. */
function capacityNote(line: CalcLineForm): { text: string; warn: boolean } | null {
  const d = linePackagingDerivation(line, form.equipmentType);
  if (d.source !== "capacity" || !d.because) return null;
  return {
    text: (d.overrodeType ? "Capacity overrides the package type — " : "Measured: ") + d.because + ".",
    warn: d.overrodeType,
  };
}

/**
 * The §171.8 answer this line is currently sending to the engine, said out loud. It is the single
 * most consequential derived value on the form — bulk placards at any quantity, non-bulk waits for
 * 1,001 lb — and it used to be visible only as an indirect hint on the package-type field.
 */
function packagingBadge(line: CalcLineForm): { text: string; source: string } | null {
  if (!line.product && !line.packageType) return null;
  const d = linePackagingDerivation(line, form.equipmentType);
  const source =
    d.source === "capacity"
      ? "from the per-package size you entered (§171.8)"
      : d.source === "type"
        ? "from the package type (§171.8)"
        : "assumed from the equipment — state the packaging to be sure";
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
function onPackageTypeChange(i: number, value: string) {
  const line = form.lines[i]!;
  line.packageType = value;
  const spec = packageTypeSpec(value);
  if (spec && line.quantityValue === "") line.quantityUnit = spec.defaultUnit;
}
async function calculate() {
  result.value = await calc.mutateAsync(buildCalcRequest(form));
}
function resetAll() {
  selectedTrailerId.value = "";
  Object.assign(form, emptyForm());
  result.value = null;
  calc.reset();
}
</script>

<template>
  <div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:grid-cols-2">
    <form class="min-w-0 space-y-4" @submit.prevent="calculate">
      <!-- ── 1 · equipment ──────────────────────────────────────────────────────────────────── -->
      <BaseCard as="section">
        <div class="flex items-center gap-3">
          <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">1</span>
          <div>
            <h2 class="text-sm font-semibold text-ink">Equipment</h2>
            <p class="mt-0.5 text-sm text-ink-muted">What the load rides on — this decides which bulk and packaged-freight rules apply.</p>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <!-- Fleet equipment states the answer for you. Never mounted on the public page. -->
          <FormField
            v-if="fleet"
            v-slot="{ id }"
            label="Trailer"
            hint="Picking one fills the equipment and tank capacity from the fleet."
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
            v-slot="{ id }"
            label="Equipment"
            required
            :hint="
              form.equipmentType === ''
                ? 'Bulk or packaged decides whether the 1,001 lb threshold applies at all — there is no safe default.'
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
              hint="Optional. Used when capacity affects the applicable cargo-tank requirements."
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

        <p
          v-if="equipmentNote && equipmentNote.warn"
          class="mt-3 rounded-surface bg-warning-50 px-3 py-2 text-xs text-warning-800 ring-1 ring-inset ring-warning-200"
        >
          {{ equipmentNote.text }}
        </p>
        <p v-else-if="equipmentNote" class="mt-3 text-xs text-ink-muted">
          {{ equipmentNote.text }}
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

              <!-- package -->
              <div class="space-y-3">
                <p class="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">Packaging</p>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField
                    v-slot="{ id }"
                    label="Package type"
                    class="sm:col-span-2"
                    :hint="packageHint(line.packageType) ?? 'As the BOL states it — bulk vs non-bulk is derived from this.'"
                  >
                    <ComboSelect
                      :id="id"
                      :model-value="line.packageType"
                      :options="PACKAGE_TYPE_OPTIONS"
                      placeholder="Drums, totes, boxes…"
                      @update:model-value="(v: string) => onPackageTypeChange(i, v)"
                    />
                  </FormField>

                  <FormField
                    v-if="line.packageType !== 'bulk_cargo'"
                    v-slot="{ id }"
                    label="Package count"
                    hint="DOT packages, not pallets (§172.202(a)(7))."
                  >
                    <BaseInput :id="id" v-model="line.packageCount" type="number" inputmode="numeric" min="0" placeholder="1056" />
                  </FormField>

                  <FormField v-if="isTank && line.packageType === 'bulk_cargo'" v-slot="{ id }" label="Compartment #">
                    <BaseInput :id="id" v-model="line.compartmentIndex" type="number" inputmode="numeric" min="1" placeholder="1" />
                  </FormField>

                  <!-- D-H14: the measured §171.8 size. Value and unit are ONE control — split across a
                       grid break, this is the field most likely to be filled in wrongly. -->
                  <FormField
                    v-if="line.packageType !== 'bulk_cargo'"
                    v-slot="{ id }"
                    label="Size of each package"
                    hint="Optional. >119 gal liquid / >1,000 lb water cap. = bulk (§171.8)."
                  >
                    <div class="flex items-stretch gap-2">
                      <BaseInput :id="id" v-model="line.perPackageCapacityValue" class="min-w-0 flex-1" type="number" inputmode="decimal" min="0" placeholder="4" />
                      <ComboSelect v-model="line.perPackageCapacityUnit" class="w-32 shrink-0" :options="CAPACITY_UNIT_OPTIONS" />
                    </div>
                  </FormField>
                </div>

                <!-- the derived §171.8 answer, said out loud -->
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

              <!-- measure -->
              <div class="space-y-3">
                <p class="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">Quantity on the paper</p>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField v-slot="{ id }" label="Total quantity">
                    <div class="flex items-stretch gap-2">
                      <BaseInput :id="id" v-model="line.quantityValue" class="min-w-0 flex-1" type="number" inputmode="decimal" min="0" :placeholder="isTank ? '8000' : '4224'" />
                      <ComboSelect v-model="line.quantityUnit" class="w-24 shrink-0" :options="QUANTITY_UNIT_OPTIONS" />
                    </div>
                  </FormField>
                  <FormField v-slot="{ id }" label="Total gross weight" hint="Drives the §172.504(c) aggregate.">
                    <div class="flex items-stretch gap-2">
                      <BaseInput :id="id" v-model="line.grossWeightValue" class="min-w-0 flex-1" type="number" inputmode="decimal" min="0" placeholder="44307" />
                      <ComboSelect v-model="line.grossWeightUnit" class="w-24 shrink-0" :options="GROSS_WEIGHT_UNIT_OPTIONS" />
                    </div>
                  </FormField>
                </div>
                <p v-if="perPackageLb(line) != null" class="text-xs text-ink-muted">
                  That works out to <strong class="text-ink">{{ perPackageLb(line) }} lb</strong> per package —
                  if that looks like a pallet rather than a package, the count is the thing to fix.
                </p>
              </div>

              <!-- declare -->
              <div class="space-y-2 rounded-surface bg-surface-subtle p-3 ring-1 ring-inset ring-edge">
                <p class="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                  Offeror declarations
                </p>
                <p class="text-xs text-ink-muted">
                  Only tick what the shipping paper actually says. Each one changes the answer, and the engine
                  verifies them rather than taking them on trust.
                </p>
                <div class="space-y-1.5 pt-1">
                  <BaseCheckbox v-model="line.isResidueLine">Residue only (§173.29(c))</BaseCheckbox>
                  <BaseCheckbox v-model="line.isLimitedQuantity">Limited Quantity, as declared on the BOL (§172.203(b))</BaseCheckbox>
                  <BaseCheckbox v-model="line.reclassedCombustible">Reclassified combustible (§173.150(f))</BaseCheckbox>
                </div>
              </div>
            </div>
          </div>
        </div>
      </BaseCard>

      <!-- ── 3 · trip context ───────────────────────────────────────────────────────────────── -->
      <BaseCard as="section">
        <div class="flex items-center gap-3">
          <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">3</span>
          <div>
            <h2 class="text-sm font-semibold text-ink">Trip context</h2>
            <p class="mt-0.5 text-sm text-ink-muted">Optional — facts about the run rather than the freight.</p>
          </div>
        </div>
        <div class="mt-4">
          <FormField
            v-slot="{ id }"
            label="Identification numbers retained from the previous or current business day"
            hint="§172.336(c). Comma-separated. Leave blank if none."
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
