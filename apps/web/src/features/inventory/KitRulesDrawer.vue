<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  UNIT_KINDS,
  UNIT_KIND_LABELS,
  type UnitKind,
} from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSelect,
} from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useAssetTypesQuery } from "./useAssets";
import { useKitExpectationsQuery, useSetKitExpectation, useDeleteKitExpectation } from "./useUnits";
import { useToastStore } from "@/stores/toast";

/**
 * The fleet's kit rules — how many of each thing a kind of unit carries (I9, D-INV12).
 *
 * ── ONE KIND AT A TIME, BECAUSE THAT IS THE DECISION BEING MADE ───────────────────────────────
 * "Every reefer carries a download cable" is one sentence about one kind. A grid of three kinds by
 * every asset type would be a matrix nobody can read and, worse, one where a stray keystroke
 * changes a rule about trucks while the author is thinking about trailers.
 *
 * ── AN EMPTY RULE SET IS THE EXPECTED STARTING STATE (A4) ─────────────────────────────────────
 * The owner's three kit lists are still owed, and the plan's answer is "ship empty; the first unit
 * check populates them". So this drawer opens on a list of every asset type at whatever the type's
 * own `default_kit_quantity` says, and typing a number here is what turns that into a rule. It is
 * not an error state and does not read as one.
 *
 * ── ZERO IS A RULE AND BLANK IS THE ABSENCE OF ONE ────────────────────────────────────────────
 * They are different answers and the drawer keeps them apart. "0" says this kind of unit carries
 * none of this, deliberately — which is how a reefer cable is kept out of every dry van's kit.
 * Clearing the field REMOVES the rule, which drops the type back to its own default. Without the
 * distinction there is no way to say "none" that survives the next person raising the type default.
 */

const props = defineProps<{ open: boolean; unitKind?: UnitKind }>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const kind = ref<UnitKind>(props.unitKind ?? "tractor");
const { data: types } = useAssetTypesQuery();

const filter = computed(() => ({ unitKind: kind.value, fleetOnly: true }));
const { data: rules } = useKitExpectationsQuery(filter);
const save = useSetKitExpectation();
const remove = useDeleteKitExpectation();

/** What is typed, keyed by asset type. Blank means "no rule", which is not the same as "0". */
const typed = reactive<Record<string, string>>({});

/** Re-seeded whenever the kind changes, because the rules being edited change with it. */
watch(
  [rules, kind],
  () => {
    for (const key of Object.keys(typed)) delete typed[key];
    for (const r of rules.value ?? []) typed[r.assetTypeId] = String(r.quantity);
  },
  { immediate: true },
);

const ruleFor = (assetTypeId: string) => (rules.value ?? []).find((r) => r.assetTypeId === assetTypeId);

const rows = computed(() =>
  (types.value ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    /** What the type says when no rule exists — shown as the placeholder, never as a typed value. */
    typeDefault: t.defaultKitQuantity,
    ruleId: ruleFor(t.id)?.id ?? null,
  })),
);

const busy = computed(() => save.isPending.value || remove.isPending.value);

async function submit() {
  try {
    for (const row of rows.value) {
      const raw = (typed[row.id] ?? "").trim();
      const existing = row.ruleId;
      if (raw === "") {
        // Cleared: the rule goes, and the type's own default takes over again.
        if (existing) await remove.mutateAsync(existing);
        continue;
      }
      const quantity = Number(raw);
      if (!Number.isInteger(quantity) || quantity < 0) {
        toast.error("Check the numbers", `"${raw}" is not a whole number of ${row.name}.`);
        return;
      }
      const unchanged = ruleFor(row.id)?.quantity === quantity;
      if (unchanged) continue;
      await save.mutateAsync({ assetTypeId: row.id, unitKind: kind.value, quantity });
    }
    toast.success("Kit rules saved");
    emit("close");
  } catch (e) {
    toast.error("Could not save the kit rules", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="open" title="Kit rules" @close="emit('close')">
    <form class="space-y-4" @submit.prevent="submit">
      <FormField v-slot="{ id }" label="For which kind of unit">
        <AppSelect
          :id="id"
          v-model="kind"
          :options="UNIT_KINDS.map((k) => ({ value: k, label: UNIT_KIND_LABELS[k] }))"
        />
      </FormField>

      <p class="text-xs text-ink-tertiary">
        How many of each thing this kind of unit carries. Leave a row empty to use the type's own
        default; type 0 to say it carries none.
      </p>

      <div v-if="rows.length" class="space-y-3">
        <FormField
          v-for="row in rows"
          :key="row.id"
          v-slot="{ id }"
          :label="row.name"
          :hint="row.ruleId ? 'A rule for this kind' : `The type's own default is ${row.typeDefault}`"
        >
          <BaseInput
            :id="id"
            v-model="typed[row.id]"
            inputmode="numeric"
            :placeholder="String(row.typeDefault)"
          />
        </FormField>
      </div>
      <p v-else class="text-sm text-ink-secondary">
        No asset types yet. Add one on Assets first — a type is what a kit rule counts.
      </p>

      <div class="flex justify-end gap-2 pt-2">
        <BaseButton type="button" @click="emit('close')">Cancel</BaseButton>
        <BaseButton type="submit" variant="primary" :disabled="busy || !rows.length">Save rules</BaseButton>
      </div>
    </form>
  </SlideOver>
</template>
