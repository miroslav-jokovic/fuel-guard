<script setup lang="ts">
import { computed } from "vue";
import { EFS_MATCH_VALUE_MAX, infoLabel, type PromptInput } from "@fuelguard/shared";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import ComboSelect from "@/components/ui/ComboSelect.vue";
import FormField from "@/components/ui/FormField.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";

/**
 * What the pump asks the driver for.
 *
 * ── Only DRID and UNIT are editable, and the rest are shown anyway ───────────────────────────────
 * A card can carry prompts this product does not edit in Phase 1 — odometer, trip number, trailer.
 * They are listed, greyed, and untouched: hiding them would make an operator think the card asks for
 * nothing else, and a "save" that silently preserved them would look like luck rather than design.
 * (It is design — see `promptsEdits` in the API, which echoes those records verbatim.)
 *
 * ── Clearing a value is not the same as removing a prompt ────────────────────────────────────────
 * Emptying the Driver ID box REMOVES the prompt, which stops the pump checking who is fuelling. That
 * needs an explicit acknowledgement and a fresh sign-in, so this panel makes it visible the moment it
 * happens rather than at the confirmation.
 */

interface PromptRow {
  infoId: string;
  validationType: string | null;
  matchValue: string | null;
  editable: boolean;
}

const props = defineProps<{
  rows: PromptRow[];
  drafts: PromptInput[];
  busy: boolean;
  reason: string;
}>();

const emit = defineEmits<{
  "update:drafts": [value: PromptInput[]];
  "update:reason": [value: string];
  save: [];
}>();

const validationOptions = [
  { value: "EXACT_MATCH", label: "Must match exactly — the pump checks it" },
  { value: "REPORT_ONLY", label: "Report only — the pump records whatever is typed" },
];

const readOnlyRows = computed(() => props.rows.filter((r) => !r.editable));
const reasonValid = computed(() => props.reason.trim().length >= 3);

/** A prompt whose value has been emptied is a prompt the operator is REMOVING. */
export interface Removal { infoId: string }
const removals = computed(() =>
  props.drafts.filter((d) => (d.matchValue ?? "").trim() === "").map((d) => d.infoId as string),
);
const removesDriverId = computed(() => removals.value.includes("DRID"));

function update(index: number, patch: Partial<PromptInput>): void {
  emit("update:drafts", props.drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)));
}
</script>

<template>
  <div class="space-y-4">
    <div v-for="(draft, index) in props.drafts" :key="draft.infoId" class="space-y-3 rounded-md border border-edge p-3">
      <p class="text-sm font-medium text-ink">{{ infoLabel(draft.infoId) }}</p>
      <FormField
        label="Value the driver must enter"
        :hint="`Maximum ${EFS_MATCH_VALUE_MAX} characters. Clearing this removes the prompt entirely.`"
      >
        <template #default="{ id }">
          <BaseInput
            :id="id"
            type="text"
            :maxlength="EFS_MATCH_VALUE_MAX"
            :model-value="draft.matchValue ?? ''"
            :disabled="props.busy"
            @update:model-value="update(index, { matchValue: $event })"
          />
        </template>
      </FormField>
      <FormField label="How the pump treats it">
        <template #default="{ id }">
          <ComboSelect
            :id="id"
            :model-value="draft.validationType"
            :options="validationOptions"
            :disabled="props.busy"
            @update:model-value="update(index, { validationType: $event as PromptInput['validationType'] })"
          />
        </template>
      </FormField>
    </div>

    <p v-if="removesDriverId" class="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700">
      Clearing the Driver ID stops the pump checking who is fueling this card, and FuelGuard loses its
      strongest signal for attributing a fill to a driver. You will be asked to confirm your password.
    </p>

    <div v-if="readOnlyRows.length > 0" class="space-y-1">
      <p class="text-sm text-ink-muted">Also on this card, and left untouched:</p>
      <ul class="space-y-1">
        <li v-for="row in readOnlyRows" :key="row.infoId" class="flex items-center gap-2 text-sm text-ink-subtle">
          <span>{{ infoLabel(row.infoId) }}</span>
          <span v-if="row.validationType" :class="[BADGE_BASE, toneClass('neutral')]">{{ row.validationType }}</span>
          <span v-if="row.matchValue">{{ row.matchValue }}</span>
        </li>
      </ul>
    </div>

    <FormField label="Reason" required hint="Recorded in the audit log.">
      <template #default="{ id }">
        <BaseInput
          :id="id"
          type="text"
          maxlength="200"
          :model-value="props.reason"
          :disabled="props.busy"
          placeholder="Reassigned to a new driver"
          @update:model-value="emit('update:reason', $event)"
        />
      </template>
    </FormField>

    <div class="flex justify-end">
      <BaseButton variant="primary" :disabled="props.busy || !reasonValid" @click="emit('save')">
        Save prompts
      </BaseButton>
    </div>
  </div>
</template>
