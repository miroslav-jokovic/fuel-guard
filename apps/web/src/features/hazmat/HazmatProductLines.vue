<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import { PlusIcon, XMarkIcon } from "@silvicom/ui/icons";
import type { HazmatProduct } from "@silvicom/shared";
import { packageTypeSpec } from "@silvicom/shared";
import { AppCard as BaseCard } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppCheckbox as BaseCheckbox } from "@silvicom/ui";
import { AppFormField as FormField } from "@silvicom/ui";
import { AppCombobox as ComboSelect } from "@silvicom/ui";
import ProductPicker from "@/features/hazmat/ProductPicker.vue";
import {
  linePackagingDerivation,
  stripCitations,
  suggestedGrossLb,
  marinePollutantThresholdPct,
  PACKAGE_TYPE_OPTIONS,
  CAPACITY_UNIT_OPTIONS,
  GROSS_WEIGHT_UNIT_OPTIONS,
  type CalcLineForm,
} from "@/features/hazmat/useHazmatCalc";

const props = defineProps<{
  lines: CalcLineForm[];
  equipmentType: string;
  isTank: boolean;
  basePath: string;
}>();

const emit = defineEmits<{
  addLine: [];
  removeLine: [index: number];
  selectProduct: [index: number, product: HazmatProduct];
  clearProduct: [index: number];
}>();

const packageHint = (type: string): string | undefined => {
  const hint = packageTypeSpec(type)?.hint;
  return hint ? stripCitations(hint) : undefined;
};

/** The bulk-or-packaged answer this line is currently sending to the engine, said out loud. It is the
 * single most consequential derived value on the form — bulk placards at any quantity, packaged
 * freight waits for the 1,001 lb threshold. */
function packagingBadge(line: CalcLineForm): { text: string; source: string } | null {
  if (!line.product && !line.packageType) return null;
  const d = linePackagingDerivation(line, props.equipmentType);
  const source =
    d.source === "capacity"
      ? "from the per-package size you entered"
      : d.source === "type"
        ? "from the package type"
        : "assumed from the equipment — set the package type to be sure";
  return { text: d.kind === "bulk" ? "Bulk packaging" : "Non-bulk packaging", source };
}

function capacityNote(line: CalcLineForm): { text: string; warn: boolean } | null {
  const d = linePackagingDerivation(line, props.equipmentType);
  if (d.source !== "capacity" || !d.because) return null;
  return {
    text: (d.overrodeType ? "The per-package size overrides the package type — " : "Measured: ") + stripCitations(d.because) + ".",
    warn: d.overrodeType,
  };
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

/** The §171.8 figure this line's product is judged against — 10% listed, 1% severe or unknown. */
const thresholdPct = (line: CalcLineForm): number => marinePollutantThresholdPct(line.product);

function applyGrossSuggestion(line: CalcLineForm) {
  const lb = suggestedGrossLb(line);
  if (lb == null) return;
  line.grossWeightValue = String(lb);
  line.grossWeightUnit = "lb";
}
</script>

<template>
  <BaseCard as="section">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold text-ink">Regulated products</h2>
        <p class="mt-0.5 text-sm text-ink-muted">Add every hazardous material declared on the load, as the BOL states it.</p>
      </div>
      <BaseButton variant="soft" size="sm" @click="emit('addLine')">
        <AppIcon :icon="PlusIcon" class="size-4" aria-hidden="true" />
        Add product
      </BaseButton>
    </div>

    <div class="mt-4 space-y-4">
      <div v-for="(line, i) in props.lines" :key="i" class="overflow-hidden rounded-dialog ring-1 ring-inset ring-edge">
        <!-- identify -->
        <div class="flex items-center justify-between gap-2 border-b border-edge bg-surface-subtle px-4 py-2">
          <p class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Product {{ i + 1 }}</p>
          <BaseButton v-if="props.lines.length > 1" variant="ghost" size="sm" @click="emit('removeLine', i)">
            <AppIcon :icon="XMarkIcon" class="size-4" aria-hidden="true" />
            Remove
          </BaseButton>
        </div>

        <div class="space-y-4 p-4">
          <template v-if="line.product">
            <div class="flex items-center justify-between gap-2 rounded-control bg-surface px-3 py-2 ring-1 ring-inset ring-edge">
              <span class="truncate text-sm text-ink">{{ line.product.label }}</span>
              <BaseButton variant="ghost" size="sm" @click="emit('clearProduct', i)">Change</BaseButton>
            </div>
          </template>
          <ProductPicker v-else :base-path="props.basePath" @select="(p) => emit('selectProduct', i, p)" />

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

              <FormField v-if="props.isTank && line.packageType === 'bulk_cargo'" v-slot="{ id }" label="Compartment #">
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
              <BaseButton variant="link" @click="applyGrossSuggestion(line)">use it</BaseButton>.
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
            <div class="flex flex-col gap-1 pt-1">
              <BaseCheckbox v-model="line.isResidueLine">Residue only — the packaging is empty but not cleaned</BaseCheckbox>
              <BaseCheckbox v-model="line.isLimitedQuantity">Marked “Limited Quantity” on the BOL</BaseCheckbox>
              <BaseCheckbox v-model="line.reclassedCombustible">Reclassified combustible by the shipper</BaseCheckbox>
            </div>

            <!--
              §171.8 — asked ONLY on a product that is actually on appendix B (roughly 132 of 2,479
              HMT entries, plus the two n.o.s. ones). On every other line the answer cannot change
              anything, and a question that never matters is one people learn to skip past.
            -->
            <div v-if="line.product?.isMarinePollutant" class="border-t border-edge pt-3">
              <FormField
                v-slot="{ id }"
                label="If this is a solution or mixture, what is it by weight?"
                :hint="`${line.product.psn} is a marine pollutant. Neat, it stays one whatever you enter — but a mixture below ${thresholdPct(line)}% by weight is not a marine pollutant at all. Leave blank if it is the material itself, or if the paper does not say.`"
              >
                <div class="flex items-stretch gap-2">
                  <BaseInput
                    :id="id"
                    v-model="line.marinePollutantConcentrationPct"
                    class="min-w-0 flex-1"
                    type="number"
                    inputmode="decimal"
                    min="0"
                    max="100"
                    :placeholder="String(thresholdPct(line))"
                  />
                  <span class="flex shrink-0 items-center rounded-control bg-surface-subtle px-3 text-sm text-ink-muted ring-1 ring-inset ring-edge">% by weight</span>
                </div>
              </FormField>
            </div>
          </div>
        </div>
      </div>
    </div>
  </BaseCard>
</template>
