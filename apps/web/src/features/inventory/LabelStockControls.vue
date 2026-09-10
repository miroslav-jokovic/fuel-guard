<script setup lang="ts">
import { computed } from "vue";
import { AppCallout, AppFormField as FormField, AppInput as BaseInput, AppSelect } from "@silvicom/ui";
import { MAX_NUDGE_POINTS } from "@silvicom/shared";
import type { LabelPresetDto } from "@/features/inventory/useLabels";

/**
 * Choosing the stock, where to start on it, and how far to shove the whole sheet
 * (INVENTORY-PLAN.md I10; D-INV25, research §5.15).
 *
 * ── THREE CONTROLS, AND THE ONE THAT IS NOT HERE IS THE POINT ─────────────────────────────────
 * There is no scale control, and no designer. Cheqroom's in-app label designer is described by its
 * own users as "a frustrating version of excel", and a shop needs five known-good sheets far more
 * than it needs a canvas (D-INV25). A SCALE control would be worse than useless: it is the exact
 * thing Avery's alignment guidance tells people to stop touching, because printing at anything other
 * than 100 % is what causes the drift that then gets "fixed" by scaling further.
 *
 * ── THE NUDGE ANSWERS ONE FAULT AND THE COPY SAYS WHICH ───────────────────────────────────────
 * A whole-sheet offset models a printer whose registration is off by a constant. It cannot fix drift
 * that GROWS down the page — that is a scaling fault, and the only cure is printing at actual size.
 * Telling the two apart is the whole diagnostic, so the screen states it rather than leaving somebody
 * to nudge four times and conclude the product is broken.
 *
 * ── `QuantityStepper` WAS THE OBVIOUS REUSE AND IS THE WRONG CONTROL ──────────────────────────
 * It is the shelf-walk stepper: 56 dp targets for a gloved thumb, a "None left" chip because zero is
 * the commonest answer on a walk, and an input handler that strips every non-digit — which silently
 * eats the minus sign a nudge of −6 needs. It is right for a phone in a bay and wrong at a desk in
 * front of a printer, so this uses the ordinary text input the other inventory forms use. Reusing it
 * would have meant widening a control built around one posture to serve the opposite one.
 *
 * ── AND THE MATERIAL SENTENCE IS SHOWN AT THE MOMENT IT CAN CHANGE AN OUTCOME ─────────────────
 * §2.4 measured that adhesive paper fails in 60–90 days in a shop, that polyester with matte
 * laminate is what survives a bin, and that anything on a truck wants photo-anodized aluminium. The
 * only moment that advice is worth anything is while somebody is choosing what to print onto, which
 * is this control and no other.
 */

const props = defineProps<{
  presets: LabelPresetDto[];
  presetId: string;
  startPosition: number;
  nudgeX: number;
  nudgeY: number;
}>();

const emit = defineEmits<{
  "update:presetId": [value: string];
  "update:startPosition": [value: number];
  "update:nudgeX": [value: number];
  "update:nudgeY": [value: number];
}>();

const preset = computed(() => props.presets.find((p) => p.id === props.presetId) ?? null);
/** A 24-up sheet has no position 30, so the ceiling moves with the stock. */
const perSheet = computed(() => preset.value?.perSheet ?? 1);

/** ±½ inch — `MAX_NUDGE_POINTS` in the contract, which the API also validates against. */
const MAX_NUDGE = MAX_NUDGE_POINTS;

/**
 * Read a typed number back, refusing what the API would refuse.
 *
 * Clamping here rather than letting a bad value travel is not defensive decoration: the contract
 * caps the nudge at ±36 and the API caps the start position at the chosen preset's own capacity, so
 * an unclamped field produces a 422 at the end of a flow instead of a control that simply cannot be
 * put in a state the printer will not accept. An unparseable field reads as the floor, because a
 * half-typed "-" must not blank the preview.
 */
function clamp(raw: string, min: number, max: number): number {
  const n = Number.parseInt(raw.replace(/[^\d-]/g, ""), 10);
  if (Number.isNaN(n)) return min < 0 ? 0 : min;
  return Math.min(max, Math.max(min, n));
}
</script>

<template>
  <div class="space-y-4">
    <FormField v-slot="{ id }" label="Label stock">
      <AppSelect
        :id="id"
        :model-value="presetId"
        :options="presets.map((p) => ({ value: p.id, label: p.name }))"
        @update:model-value="emit('update:presetId', String($event))"
      />
    </FormField>

    <p v-if="preset" class="text-xs text-ink-tertiary">{{ preset.material }}</p>

    <FormField
      v-slot="{ id }"
      label="Start at position"
      :hint="`Skip labels already peeled off the sheet. 1 to ${perSheet}.`"
    >
      <BaseInput
        :id="id"
        :model-value="String(startPosition)"
        inputmode="numeric"
        @update:model-value="emit('update:startPosition', clamp($event, 1, perSheet))"
      />
    </FormField>

    <div class="grid grid-cols-2 gap-3">
      <FormField v-slot="{ id }" label="Nudge right" hint="Points. Negative moves left.">
        <BaseInput
          :id="id"
          :model-value="String(nudgeX)"
          inputmode="numeric"
          @update:model-value="emit('update:nudgeX', clamp($event, -MAX_NUDGE, MAX_NUDGE))"
        />
      </FormField>
      <FormField v-slot="{ id }" label="Nudge down" hint="Points. Negative moves up.">
        <BaseInput
          :id="id"
          :model-value="String(nudgeY)"
          inputmode="numeric"
          @update:model-value="emit('update:nudgeY', clamp($event, -MAX_NUDGE, MAX_NUDGE))"
        />
      </FormField>
    </div>

    <AppCallout tone="info">
      <p class="font-semibold text-ink">Before you print</p>
      <p class="mt-1">
        In the print dialog set <strong>Scale to 100 % (Actual size)</strong> and choose
        <strong>Labels</strong> as the paper type. Anything else shrinks the sheet and no nudge can
        put it back.
      </p>
      <p class="mt-2">
        If every label is off by the same amount, nudge. If they drift further off further down the
        page, the print scale is wrong — fix that instead.
      </p>
    </AppCallout>
  </div>
</template>
