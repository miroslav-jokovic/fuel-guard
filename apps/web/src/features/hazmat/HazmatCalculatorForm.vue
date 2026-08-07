<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { AppIcon } from "@fuelguard/ui";
import { ClipboardDocumentCheckIcon, PlusIcon, XMarkIcon } from "@fuelguard/ui/icons";
import type { HazmatProduct } from "@fuelguard/shared";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseCheckbox from "@/components/ui/BaseCheckbox.vue";
import FormField from "@/components/ui/FormField.vue";
import ComboSelect from "@/components/ui/ComboSelect.vue";
import ProductPicker from "@/features/hazmat/ProductPicker.vue";
import VerdictPanel from "@/features/hazmat/VerdictPanel.vue";
import {
  buildCalcRequest,
  emptyForm,
  emptyLine,
  hasResolvedLine,
  useHazmatCalc,
  VEHICLE_KIND_OPTIONS,
  TANK_STATE_OPTIONS,
  QUANTITY_UNIT_OPTIONS,
  PACKAGING_KIND_OPTIONS,
  type CalcForm,
  type CalcResult,
} from "@/features/hazmat/useHazmatCalc";

const props = withDefaults(defineProps<{ basePath?: string }>(), { basePath: "/api/hazmat" });

const form = reactive<CalcForm>(emptyForm());
const calc = useHazmatCalc(props.basePath);
const result = ref<CalcResult | null>(null);

const canCalculate = computed(() => hasResolvedLine(form));

function addLine() {
  form.lines.push(emptyLine());
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
  Object.assign(form, emptyForm());
  result.value = null;
  calc.reset();
}
</script>

<template>
  <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
    <form class="space-y-4" @submit.prevent="calculate">
      <BaseCard as="section">
        <div class="flex items-center gap-3">
          <span class="flex size-7 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">1</span>
          <div>
            <h2 class="text-sm font-semibold text-ink">Vehicle and context</h2>
            <p class="mt-0.5 text-sm text-ink-muted">Define the equipment and any details that affect display requirements.</p>
          </div>
        </div>
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="Vehicle type">
            <ComboSelect :id="id" v-model="form.vehicleKind" :options="VEHICLE_KIND_OPTIONS" />
          </FormField>
          <FormField
            v-if="form.vehicleKind === 'cargo_tank'"
            v-slot="{ id }"
            label="Cargo tank capacity (gal)"
            hint="Optional. Used when capacity affects the applicable cargo-tank requirements."
          >
            <BaseInput :id="id" v-model="form.cargoTankCapacityGal" type="number" inputmode="decimal" min="0" placeholder="9200" />
          </FormField>
          <FormField v-slot="{ id }" label="Tank state">
            <ComboSelect :id="id" v-model="form.tankState" :options="TANK_STATE_OPTIONS" />
          </FormField>
          <FormField
            v-slot="{ id }"
            label="Previous/current business-day IDs"
            hint="§172.336(c): IDs retained from the last load, e.g. UN1203. Comma-separated."
          >
            <BaseInput :id="id" v-model="form.businessDayIds" placeholder="UN1203, UN1202" />
          </FormField>
        </div>
      </BaseCard>

      <BaseCard as="section">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="flex size-7 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">2</span>
            <div>
              <h2 class="text-sm font-semibold text-ink">Regulated products</h2>
              <p class="mt-0.5 text-sm text-ink-muted">Add every hazardous material declared on the load.</p>
            </div>
          </div>
          <BaseButton variant="soft" size="sm" @click="addLine">
            <AppIcon :icon="PlusIcon" class="size-4" aria-hidden="true" />
            Add product
          </BaseButton>
        </div>

        <div class="mt-3 space-y-4">
          <div v-for="(line, i) in form.lines" :key="i" class="rounded-lg bg-surface-subtle p-4 ring-1 ring-inset ring-edge">
            <div class="flex items-start justify-between gap-2">
              <p class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Product {{ i + 1 }}</p>
              <BaseButton
                v-if="form.lines.length > 1"
                variant="ghost"
                size="sm"
                @click="removeLine(i)"
              >
                <AppIcon :icon="XMarkIcon" class="size-4" aria-hidden="true" />
                Remove
              </BaseButton>
            </div>

            <div class="mt-2">
              <template v-if="line.product">
                <div class="flex items-center justify-between gap-2 rounded-md bg-surface px-3 py-2 ring-1 ring-inset ring-edge">
                  <span class="truncate text-sm text-ink">{{ line.product.label }}</span>
                  <BaseButton variant="ghost" size="sm" @click="clearProduct(i)">Change</BaseButton>
                </div>
              </template>
              <ProductPicker v-else :base-path="props.basePath" @select="(p) => selectProduct(i, p)" />
            </div>

            <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <FormField v-slot="{ id }" label="Quantity">
                <BaseInput :id="id" v-model="line.quantityValue" type="number" inputmode="decimal" min="0" placeholder="8000" />
              </FormField>
              <FormField v-slot="{ id }" label="Unit">
                <ComboSelect :id="id" v-model="line.quantityUnit" :options="QUANTITY_UNIT_OPTIONS" />
              </FormField>
              <FormField v-slot="{ id }" label="Packaging">
                <ComboSelect :id="id" v-model="line.packagingKind" :options="PACKAGING_KIND_OPTIONS" />
              </FormField>
              <FormField v-slot="{ id }" label="Gross wt (lb)" hint="Non-bulk Table 2.">
                <BaseInput :id="id" v-model="line.grossWeightLb" type="number" inputmode="decimal" min="0" placeholder="1254" />
              </FormField>
            </div>

            <div class="mt-3 flex flex-wrap gap-4">
              <BaseCheckbox v-model="line.isResidueLine">Residue only</BaseCheckbox>
              <BaseCheckbox v-model="line.reclassedCombustible">Reclassified combustible (§173.150(f))</BaseCheckbox>
            </div>
          </div>
        </div>
      </BaseCard>

      <div class="flex items-center gap-3">
        <BaseButton type="submit" variant="primary" :disabled="!canCalculate || calc.isPending.value">
          <AppIcon :icon="ClipboardDocumentCheckIcon" class="size-4" aria-hidden="true" />
          {{ calc.isPending.value ? "Calculating…" : "Calculate placards" }}
        </BaseButton>
        <BaseButton variant="secondary" type="button" @click="resetAll">Reset</BaseButton>
      </div>
      <p v-if="!canCalculate" class="text-xs text-ink-muted">Add at least one regulated product to calculate.</p>

      <p v-if="calc.isError.value" class="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
        {{ calc.error.value instanceof Error ? calc.error.value.message : "Calculation failed." }}
      </p>
    </form>

    <div class="lg:sticky lg:top-20 lg:self-start">
      <VerdictPanel v-if="result" :result="result" />
      <BaseCard v-else class="text-center">
        <div class="py-10">
          <span class="mx-auto flex size-11 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <AppIcon :icon="ClipboardDocumentCheckIcon" class="size-6" aria-hidden="true" />
          </span>
          <p class="mt-3 text-sm font-medium text-ink">Results will appear here</p>
          <p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">Complete the vehicle and product details, then calculate to see placards, ID displays, eligibility, and citations.</p>
        </div>
      </BaseCard>
    </div>
  </div>
</template>
