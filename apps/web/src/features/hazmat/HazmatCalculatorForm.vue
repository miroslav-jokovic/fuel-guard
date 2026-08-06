<script setup lang="ts">
import { computed, reactive, ref } from "vue";
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

/**
 * The HazmatGuard placard calculator form + results (plan H5), extracted so the authenticated calculator
 * and the public M7 calculator share one implementation. `basePath` selects the API surface: the default
 * authed `/api/hazmat`, or `/api/public/hazmat` for the unauthenticated public page. Pure/stateless — a
 * line resolves against the HMT before it can be added (fail-closed at source); nothing is persisted.
 */
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
    <!-- ── inputs ─────────────────────────────────────────────────────────── -->
    <form class="space-y-4" @submit.prevent="calculate">
      <BaseCard>
        <h2 class="text-sm font-semibold text-ink">Vehicle &amp; context</h2>
        <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="Vehicle type">
            <ComboSelect :id="id" v-model="form.vehicleKind" :options="VEHICLE_KIND_OPTIONS" />
          </FormField>
          <FormField
            v-if="form.vehicleKind === 'cargo_tank'"
            v-slot="{ id }"
            label="Cargo tank capacity (gal)"
            hint="Optional. A cargo tank already gets the 4-sided bulk ID display today; capacity-specific rules are pending (H2)."
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

      <BaseCard>
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-ink">Products</h2>
          <BaseButton variant="soft" size="sm" @click="addLine">Add product</BaseButton>
        </div>

        <div class="mt-3 space-y-4">
          <div v-for="(line, i) in form.lines" :key="i" class="rounded-lg ring-1 ring-inset ring-edge p-3">
            <div class="flex items-start justify-between gap-2">
              <p class="text-xs font-medium uppercase tracking-wide text-ink-subtle">Line {{ i + 1 }}</p>
              <button
                v-if="form.lines.length > 1"
                type="button"
                class="text-xs text-ink-muted hover:text-danger-600"
                @click="removeLine(i)"
              >
                Remove
              </button>
            </div>

            <div class="mt-2">
              <template v-if="line.product">
                <div class="flex items-center justify-between gap-2 rounded-md bg-surface-muted px-3 py-2">
                  <span class="truncate text-sm text-ink">{{ line.product.label }}</span>
                  <button type="button" class="shrink-0 text-xs text-brand-600 hover:text-brand-500" @click="clearProduct(i)">
                    Change
                  </button>
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
          {{ calc.isPending.value ? "Calculating…" : "Calculate placards" }}
        </BaseButton>
        <BaseButton variant="soft" size="sm" type="button" @click="resetAll">Reset</BaseButton>
        <span v-if="!canCalculate" class="text-xs text-ink-muted">Add at least one product to calculate.</span>
      </div>

      <p v-if="calc.isError.value" class="text-sm text-danger-600">
        {{ calc.error.value instanceof Error ? calc.error.value.message : "Calculation failed." }}
      </p>
    </form>

    <!-- ── results ────────────────────────────────────────────────────────── -->
    <div>
      <VerdictPanel v-if="result" :result="result" />
      <BaseCard v-else class="text-center">
        <p class="py-10 text-sm text-ink-muted">
          Declare a load on the left and press <span class="font-medium text-ink">Calculate placards</span> to see the
          required placards, ID displays and citations here.
        </p>
      </BaseCard>
    </div>
  </div>
</template>
