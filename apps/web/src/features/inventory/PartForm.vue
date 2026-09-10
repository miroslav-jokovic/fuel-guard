<script setup lang="ts">
import { reactive, ref } from "vue";
import {
  UNITS_OF_MEASURE,
  UNIT_OF_MEASURE_LABELS,
  partInputSchema,
  type PartDto,
  type PartInput,
} from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSelect,
  AppTextarea as BaseTextarea,
} from "@silvicom/ui";

/**
 * A part in the catalogue — the definition, never the stock (INVENTORY-PLAN.md I4).
 *
 * ── IT DOES NOT ASK WHERE THE PART IS, AND THAT IS THE POINT ──────────────────────────────────
 * No aisle, no row, no bin, no quantity. The quantity is the ledger's projection and
 * `record_part_movement` is its only writer (D-INV4) — there is no payload in the contract that
 * could set one. The shelf address is per (part, location) and lives on the stock line, and **this
 * shop has no shelf numbers at all** (owner, 2026-09-09): what addresses a shelf here is the
 * printed label and D-INV7's resolver, which arrive at I6/I10. Leading a Parts form with three
 * empty fragments nobody fills in would teach the shop that the product wants an address it does
 * not have.
 *
 * ── A BLANK OPTIONAL FIELD IS SENT AS NULL, NOT AS "" ─────────────────────────────────────────
 * `optionalText` accepts both, so an empty string would pass validation and be stored — and then
 * `manufacturer` is present-but-empty on some rows and absent on others, which is two spellings of
 * one fact for every consumer downstream to handle. The FleetPal sync (I14) resolves manufacturer
 * from a VMRS id into this column; it should find null or a name, never "".
 */

const props = defineProps<{
  part?: PartDto | null;
  submitting?: boolean;
  /**
   * A barcode to start a NEW part from — the scan page's "attach or create" path (I6).
   *
   * A technician at the receiving desk scans a carton from a supplier the shop has never bought
   * from, the resolve endpoint answers `malformed`, and the honest next action is to create the part
   * carrying that barcode (research §2.5: never a shrug). The code has to travel into the form,
   * because the alternative is reading twelve digits off one part of the screen and typing them into
   * another with the carton still in the other hand — which is the transcription error the barcode
   * existed to prevent.
   *
   * Ignored when `part` is set: an existing part's own UPC is the truth about it, and a scan is not
   * a reason to overwrite it silently.
   */
  initialUpc?: string;
}>();
const emit = defineEmits<{ submit: [input: PartInput]; cancel: [] }>();

const form = reactive({
  partNumber: props.part?.partNumber ?? "",
  description: props.part?.description ?? "",
  manufacturer: props.part?.manufacturer ?? "",
  category: props.part?.category ?? "",
  unitOfMeasure: props.part?.unitOfMeasure ?? "each",
  upc: props.part?.upc ?? props.initialUpc ?? "",
  notes: props.part?.notes ?? "",
  active: props.part?.active ?? true,
});

const blankToNull = (v: string): string | null => (v.trim() === "" ? null : v);

const errors = ref<Record<string, string>>({});

function onSubmit() {
  const result = partInputSchema.safeParse({
    partNumber: form.partNumber,
    description: form.description,
    manufacturer: blankToNull(form.manufacturer),
    category: blankToNull(form.category),
    unitOfMeasure: form.unitOfMeasure,
    upc: blankToNull(form.upc),
    notes: blankToNull(form.notes),
    active: form.active,
  });
  if (!result.success) {
    const map: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !map[key]) map[key] = issue.message;
    }
    errors.value = map;
    return;
  }
  errors.value = {};
  emit("submit", result.data);
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="onSubmit">
    <FormField v-slot="{ id }" label="Part number" :error="errors.partNumber">
      <BaseInput :id="id" v-model="form.partNumber" :invalid="!!errors.partNumber" />
    </FormField>

    <FormField v-slot="{ id }" label="Description" :error="errors.description">
      <BaseInput :id="id" v-model="form.description" :invalid="!!errors.description" placeholder="Oil filter, spin-on" />
    </FormField>

    <div class="grid grid-cols-2 gap-3">
      <FormField v-slot="{ id }" label="Manufacturer">
        <BaseInput :id="id" v-model="form.manufacturer" />
      </FormField>
      <FormField v-slot="{ id }" label="Category">
        <BaseInput :id="id" v-model="form.category" placeholder="Filters" />
      </FormField>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <FormField v-slot="{ id }" label="Counted in" :error="errors.unitOfMeasure">
        <AppSelect
          :id="id"
          v-model="form.unitOfMeasure"
          :options="UNITS_OF_MEASURE.map((u) => ({ value: u, label: UNIT_OF_MEASURE_LABELS[u] }))"
        />
      </FormField>
      <!-- The supplier's own barcode. A scan of a factory carton falls through to this column when
           the code is not one of ours (D-INV7), so it is worth typing once. -->
      <FormField v-slot="{ id }" label="Barcode (UPC)" hint="From the supplier's carton. Optional.">
        <BaseInput :id="id" v-model="form.upc" inputmode="numeric" />
      </FormField>
    </div>

    <FormField v-slot="{ id }" label="Notes">
      <BaseTextarea :id="id" v-model="form.notes" :rows="3" />
    </FormField>

    <!-- Retiring, not deleting. History is denominated in this part, so the row stays and stops
         being offered; the API records it as its own audit action for exactly that reason. -->
    <div v-if="props.part" class="rounded-control bg-surface-subtle px-3 py-2.5 ring-1 ring-edge">
      <BaseCheckbox v-model="form.active">
        <span class="text-sm">
          <span class="font-medium text-ink">Still carried</span>
          <span class="block text-xs text-ink-muted">
            Clear this to retire the part. It keeps its history and stops being offered.
          </span>
        </span>
      </BaseCheckbox>
    </div>

    <div class="flex justify-end gap-2 pt-2">
      <BaseButton type="button" @click="emit('cancel')">Cancel</BaseButton>
      <BaseButton type="submit" variant="primary" :disabled="props.submitting">
        {{ props.part ? "Save part" : "Add part" }}
      </BaseButton>
    </div>
  </form>
</template>
