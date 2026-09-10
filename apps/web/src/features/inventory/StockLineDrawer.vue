<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  stockLineSettingsSchema,
  type StockLineDto,
  type StockLocationDto,
} from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppCombobox,
  AppFormField as FormField,
  AppInput as BaseInput,
} from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useUpdateStockLine } from "./useInventory";
import { useToastStore } from "@/stores/toast";

/**
 * What the shop wants held of one part at one location (INVENTORY-PLAN.md I4).
 *
 * ── WHY THIS SCREEN EXISTS AT I4 AND NOT AT I12 ───────────────────────────────────────────────
 * The 2026-09-09 review of I0–I3 found that nothing in the product could set a `reorder_point`,
 * while I12 — "Low stock" — READS one; followed literally the programme would have shipped a
 * low-stock screen permanently empty for a reason no screen could explain. The review closed the
 * API half (`PATCH /stock/:partId/:locationId`) and left the consumer owed. The home's low-stock
 * card lands in THIS step, so the writer lands with it: a card that can only ever read zero is the
 * same defect one layer up.
 *
 * ── THE QUANTITY IS NOT ON THIS FORM ──────────────────────────────────────────────────────────
 * Deliberately, and there is no payload in the contract that could carry it. On-hand is the
 * ledger's projection and `record_part_movement` is its only writer (D-INV4); a typed total would
 * destroy the evidence for the question the shop actually asks, which is where the eleventh filter
 * went. Changing what is on the shelf is a movement, and those are I5's drawers.
 *
 * ── A LINE MAY NOT EXIST YET ──────────────────────────────────────────────────────────────────
 * `part_stock` rows are created by the RPC when stock first moves, so a part the shop carries but
 * has never received has no line anywhere. The endpoint behind this is a guarded UPDATE then an
 * INSERT (the 0174/0175 pattern, never a partial `.upsert()`), which is what makes "we carry this
 * at the main shelf, tell me at three" sayable before the first delivery — and what makes the line
 * show up on the low-stock list at zero, which is exactly right: we carry it and we have none.
 */

const props = defineProps<{
  open: boolean;
  partId: string;
  /** The line being edited, or null when a shelf is being added for a part that has none. */
  line?: StockLineDto | null;
  locations: StockLocationDto[];
}>();
const emit = defineEmits<{ close: [] }>();

/** The footer submits the form by id — `PartForm.vue` records why the buttons are not in the body. */
const FORM_ID = "stock-line-form";

const toast = useToastStore();
const save = useUpdateStockLine();

const form = reactive({
  locationId: props.line?.locationId ?? "",
  reorderPoint: props.line?.reorderPoint === null || props.line?.reorderPoint === undefined ? "" : String(props.line.reorderPoint),
  reorderQuantity:
    props.line?.reorderQuantity === null || props.line?.reorderQuantity === undefined ? "" : String(props.line.reorderQuantity),
  active: props.line?.active ?? true,
});

const locationOptions = computed(() =>
  props.locations.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` })),
);

const errors = ref<Record<string, string>>({});

/** "" is "nobody has said what enough means", which is a real state and not a zero (`isLowStock`). */
const blankToNull = (v: string): number | null => (v.trim() === "" ? null : Number(v));

async function onSubmit() {
  if (!form.locationId) {
    errors.value = { locationId: "Choose a location." };
    return;
  }
  const parsed = stockLineSettingsSchema.safeParse({
    reorderPoint: blankToNull(form.reorderPoint),
    reorderQuantity: blankToNull(form.reorderQuantity),
    active: form.active,
  });
  if (!parsed.success) {
    const map: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !map[key]) map[key] = issue.message;
    }
    errors.value = map;
    return;
  }
  errors.value = {};
  try {
    await save.mutateAsync({ partId: props.partId, locationId: form.locationId, settings: parsed.data });
    toast.success("Shelf saved");
    emit("close");
  } catch (e) {
    toast.error("Could not save the shelf", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="open" :title="line ? 'Edit shelf' : 'Add a shelf'" @close="emit('close')">
    <form :id="FORM_ID" class="space-y-4" @submit.prevent="onSubmit">
      <!-- The location cannot move once the line exists: a stock line IS the (part, location) pair,
           so changing it here would silently create a second line and orphan the first. Moving stock
           between shelves is the `transfer` verb (I5), which writes both legs. So an existing line
           states its location rather than offering a disabled picker — and stating it also survives
           the case a disabled picker could not, a line on a location that has since been CLOSED,
           where the active-only option list holds nothing to display. -->
      <FormField v-if="line" label="Location">
        <p class="text-sm text-ink">{{ line.locationName }}</p>
      </FormField>
      <FormField v-else v-slot="{ id }" label="Location" :error="errors.locationId">
        <AppCombobox
          :id="id"
          v-model="form.locationId"
          :options="locationOptions"
          placeholder="Choose a location"
          empty-text="No stock locations yet — add one under Stock locations on Parts."
        />
      </FormField>

      <div class="grid grid-cols-2 gap-3">
        <FormField
          v-slot="{ id }"
          label="Reorder point"
          hint="Leave blank if nobody has decided. Blank is never low."
          :error="errors.reorderPoint"
        >
          <BaseInput :id="id" v-model="form.reorderPoint" inputmode="numeric" :invalid="!!errors.reorderPoint" />
        </FormField>
        <FormField v-slot="{ id }" label="Reorder quantity" hint="How many to buy." :error="errors.reorderQuantity">
          <BaseInput
            :id="id"
            v-model="form.reorderQuantity"
            inputmode="numeric"
            :invalid="!!errors.reorderQuantity"
          />
        </FormField>
      </div>

      <div class="rounded-control bg-surface-subtle px-3 py-2.5 ring-1 ring-edge">
        <BaseCheckbox v-model="form.active">
          <span class="text-sm">
            <span class="font-medium text-ink">Still carried here</span>
            <span class="block text-xs text-ink-muted">
              Clear this to stop stocking the part at this location. The history stays.
            </span>
          </span>
        </BaseCheckbox>
      </div>

    </form>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="save.isPending.value" @click="emit('close')">Cancel</BaseButton>
        <BaseButton :form="FORM_ID" type="submit" variant="primary" :disabled="save.isPending.value">
          {{ save.isPending.value ? "Saving…" : "Save shelf" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
