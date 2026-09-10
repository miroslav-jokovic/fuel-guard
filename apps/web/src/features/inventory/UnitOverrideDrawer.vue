<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { KIT_EXPECTATION_SOURCE_LABELS, type UnitKitDto } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppFormField as FormField,
  AppInput as BaseInput,
} from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useAssetTypesQuery } from "./useAssets";
import { useKitExpectationsQuery, useSetKitExpectation, useDeleteKitExpectation } from "./useUnits";
import { useToastStore } from "@/stores/toast";

/**
 * This unit's own kit — the override layer (INVENTORY-PLAN.md I9, D-INV12).
 *
 * ── AN OVERRIDE IS FOR ONE UNIT AND SAYS SO ON EVERY ROW ──────────────────────────────────────
 * Each field shows where the number in force came from — this unit, the fleet rule for its kind, or
 * the type's own default. Without that the drawer is a form full of numbers whose origin nobody can
 * see, and the first thing anybody does with such a form is retype every value, which turns three
 * fleet rules into thirty per-unit ones.
 *
 * ── CLEARING A FIELD REMOVES THE OVERRIDE, IT DOES NOT SET ZERO ───────────────────────────────
 * Those are different answers and the drawer keeps them apart: "0" says this truck carries none of
 * this, deliberately; blank says "whatever the fleet says". `KitRulesDrawer.vue` draws the same
 * distinction for the fleet layer, and it is the whole reason the two layers are worth having.
 */

const props = defineProps<{ open: boolean; unit: UnitKitDto; rosterKind: "tractor" | "trailer" }>();
const emit = defineEmits<{ close: [] }>();

/** The footer submits the form by id — `PartForm.vue` records why the buttons are not in the body. */
const FORM_ID = "unit-override-form";

const toast = useToastStore();
const { data: types } = useAssetTypesQuery();

const filter = computed(() =>
  props.rosterKind === "tractor" ? { vehicleId: props.unit.unitId } : { trailerId: props.unit.unitId },
);
const { data: overrides } = useKitExpectationsQuery(filter);
const save = useSetKitExpectation();
const remove = useDeleteKitExpectation();

const typed = reactive<Record<string, string>>({});

watch(
  [overrides, () => props.unit.unitId],
  () => {
    for (const key of Object.keys(typed)) delete typed[key];
    for (const r of overrides.value ?? []) typed[r.assetTypeId] = String(r.quantity);
  },
  { immediate: true },
);

const overrideFor = (assetTypeId: string) => (overrides.value ?? []).find((r) => r.assetTypeId === assetTypeId);
/** The number in force right now, and which layer it came from — straight off the unit's DTO. */
const inForce = (assetTypeId: string) => props.unit.lines.find((l) => l.assetTypeId === assetTypeId);

const rows = computed(() =>
  (types.value ?? []).map((t) => {
    const line = inForce(t.id);
    return {
      id: t.id,
      name: t.name,
      current: line?.expected ?? t.defaultKitQuantity,
      source: line?.source ?? "type",
      overrideId: overrideFor(t.id)?.id ?? null,
    };
  }),
);

const busy = computed(() => save.isPending.value || remove.isPending.value);

async function submit() {
  try {
    for (const row of rows.value) {
      const raw = (typed[row.id] ?? "").trim();
      if (raw === "") {
        if (row.overrideId) await remove.mutateAsync(row.overrideId);
        continue;
      }
      const quantity = Number(raw);
      if (!Number.isInteger(quantity) || quantity < 0) {
        toast.error("Check the numbers", `"${raw}" is not a whole number of ${row.name}.`);
        return;
      }
      if (overrideFor(row.id)?.quantity === quantity) continue;
      await save.mutateAsync({
        assetTypeId: row.id,
        // The KIT kind, not the roster's: a reefer's override is a `reefer_trailer` rule, and the
        // schema's CHECK refuses one that disagrees with the unit it names.
        unitKind: props.unit.kind,
        ...(props.rosterKind === "tractor"
          ? { vehicleId: props.unit.unitId }
          : { trailerId: props.unit.unitId }),
        quantity,
      });
    }
    toast.success("Kit saved for this unit");
    emit("close");
  } catch (e) {
    toast.error("Could not save this unit's kit", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver
    :open="open"
    :title="`Kit for ${unit.unitNumber}`"
    :description="`Numbers for this unit alone. Leave a row empty to follow the rule for every ${unit.kind === 'tractor' ? 'truck' : unit.kind === 'reefer_trailer' ? 'reefer' : 'trailer'}; type 0 to say this one carries none.`"
    @close="emit('close')"
  >
    <form :id="FORM_ID" class="space-y-4" @submit.prevent="submit">
      <div v-if="rows.length" class="space-y-4">
        <FormField
          v-for="row in rows"
          :key="row.id"
          v-slot="{ id }"
          :label="row.name"
          :hint="
            row.overrideId
              ? 'Set for this unit'
              : `${row.current} — ${KIT_EXPECTATION_SOURCE_LABELS[row.source]}`
          "
        >
          <BaseInput :id="id" v-model="typed[row.id]" inputmode="numeric" :placeholder="String(row.current)" />
        </FormField>
      </div>
      <p v-else class="text-sm text-ink-secondary">
        No kinds of thing yet. Add one under Asset kinds on Assets first — a kind is what a kit rule counts.
      </p>
    </form>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="busy" @click="emit('close')">Cancel</BaseButton>
        <BaseButton :form="FORM_ID" type="submit" variant="primary" :disabled="busy || !rows.length">
          {{ busy ? "Saving…" : "Save kit" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
