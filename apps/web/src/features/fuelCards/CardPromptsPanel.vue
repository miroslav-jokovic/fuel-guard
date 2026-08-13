<script setup lang="ts">
import { computed } from "vue";
import { EFS_MATCH_VALUE_MAX, infoLabel, type PromptInput } from "@fuelguard/shared";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppInput as BaseInput } from "@fuelguard/ui";
import { AppCombobox as ComboSelect } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
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
 * Empty values are valid for REPORT_ONLY prompts. Removal is an explicit action with its own danger
 * button, confirmation and step-up requirement.
 */

interface PromptRow {
  infoId: string;
  validationType: string | null;
  matchValue: string | null;
  reportValue: string | null;
  editable: boolean;
}

const props = defineProps<{
  rows: PromptRow[];
  drafts: PromptInput[];
  busy: boolean;
}>();

const emit = defineEmits<{
  "update:drafts": [value: PromptInput[]];
  save: [];
}>();

const validationOptions = [
  { value: "EXACT_MATCH", label: "Must match exactly — the pump checks it" },
  { value: "REPORT_ONLY", label: "Report only — the pump records whatever is typed" },
];

const readOnlyRows = computed(() => props.rows.filter((r) => !r.editable));

function update(index: number, patch: Partial<PromptInput>): void {
  emit("update:drafts", props.drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)));
}
</script>

<template>
  <section class="space-y-4">
    <h3 class="text-sm font-semibold text-ink">Prompts</h3>
    <div v-for="(draft, index) in props.drafts" :key="draft.infoId" class="space-y-3 rounded-control border border-edge p-3">
      <p class="text-sm font-medium text-ink">{{ infoLabel(draft.infoId) }}</p>
      <FormField
        :label="draft.validationType === 'REPORT_ONLY' ? 'Value to report' : 'Value the driver must enter'"
        :hint="draft.validationType === 'REPORT_ONLY'
          ? `Maximum ${EFS_MATCH_VALUE_MAX} characters. An empty report value is allowed.`
          : `Maximum ${EFS_MATCH_VALUE_MAX} characters. Choose Remove this prompt to remove it.`"
      >
        <template #default="{ id }">
          <BaseInput
            :id="id"
            type="text"
            :maxlength="EFS_MATCH_VALUE_MAX"
            :model-value="draft.validationType === 'REPORT_ONLY' ? draft.reportValue ?? '' : draft.matchValue ?? ''"
            :disabled="props.busy || draft.remove"
            @update:model-value="update(index, draft.validationType === 'REPORT_ONLY' ? { reportValue: $event } : { matchValue: $event })"
          />
        </template>
      </FormField>
      <FormField label="How the pump treats it">
        <template #default="{ id }">
          <ComboSelect
            :id="id"
            :model-value="draft.validationType"
            :options="validationOptions"
            :disabled="props.busy || draft.remove"
            @update:model-value="update(index, { validationType: $event as PromptInput['validationType'] })"
          />
        </template>
      </FormField>
      <div class="flex justify-end gap-2">
        <BaseButton
          v-if="draft.remove"
          variant="ghost"
          size="sm"
          :disabled="props.busy"
          @click="update(index, { remove: false })"
        >
          Keep this prompt
        </BaseButton>
        <BaseButton
          v-else
          variant="danger"
          size="sm"
          :disabled="props.busy"
          @click="update(index, { remove: true })"
        >
          Remove this prompt
        </BaseButton>
      </div>
      <p v-if="draft.remove" class="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700">
        This prompt will be removed from the card after confirmation.
      </p>
    </div>

    <div v-if="readOnlyRows.length > 0" class="space-y-1">
      <p class="text-sm text-ink-muted">Also on this card, and left untouched:</p>
      <ul class="space-y-1">
        <li v-for="row in readOnlyRows" :key="row.infoId" class="flex items-center gap-2 text-sm text-ink-tertiary">
          <span>{{ infoLabel(row.infoId) }}</span>
          <span v-if="row.validationType" :class="[BADGE_BASE, toneClass('neutral')]">{{ row.validationType }}</span>
          <span v-if="row.validationType === 'REPORT_ONLY' ? row.reportValue : row.matchValue">
            {{ row.validationType === "REPORT_ONLY" ? row.reportValue : row.matchValue }}
          </span>
        </li>
      </ul>
    </div>

    <div class="flex justify-end">
      <BaseButton variant="primary" :disabled="props.busy" @click="emit('save')">
        Save prompts
      </BaseButton>
    </div>
  </section>
</template>
