<script setup lang="ts">
import { computed } from "vue";
import { EFS_MATCH_VALUE_MAX, type EfsLocation, type PromptInput, infoLabel } from "@fuelguard/shared";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppCombobox as ComboSelect } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import { AppInput as BaseInput } from "@fuelguard/ui";
import { AppCheckbox } from "@fuelguard/ui";
import EfsLocationPicker from "./EfsLocationPicker.vue";
import { type CardOperationId, type OperationDraft, type StatusRow, blockedSentence } from "./cardOperations";

/**
 * The controls for whichever operation the drawer is showing — its third region.
 *
 * ── Why these are hand-written and not generated from `ui.inputs` ────────────────────────────────
 * The contract's `CapabilityInput` describes a stepper, a radio, a text box, a select — and two of
 * the six operations need neither: a location scope needs `EfsLocationPicker`, which searches EFS's
 * own location list, and prompts need per-record removal with its own danger button and its own
 * "this will be removed" line. A generic factory would therefore render four of six operations and
 * special-case the rest, which is a second and weaker UI vocabulary sitting next to the components
 * that already do the job (standing rule 5).
 *
 * What IS read from the contract is the frame — title, verb, tone, and the diff rows — which is the
 * part two surfaces could disagree about. The drawer does that; this renders controls.
 *
 * Lock, Deactivate and Unlock have no inputs at all. That is not an omission: a lock is one field,
 * the confirmation and the diff say which, and a form with nothing in it would imply otherwise.
 */

const props = defineProps<{
  operation: CardOperationId;
  draft: OperationDraft;
  busy: boolean;
  /** Editable prompt records this product does not touch, listed so nobody thinks they vanished. */
  readOnlyPrompts: { infoId: string; validationType: string | null; matchValue: string | null; reportValue: string | null }[];
  /** The three writable statuses, each already carrying the capability it writes through. */
  statusRows?: StatusRow[];
  /** Why a given status row is out of reach for this operator, keyed by status value. */
  statusBlocked?: Record<string, string | null>;
  /** Set when the card sits at Fraud or Deleted — neither is writable and neither has a row. */
  unwritableStatus?: string | null;
  /** The prompts the card does not yet carry — what `promptAdd` may offer. */
  addOptions?: readonly string[];
}>();

const emit = defineEmits<{ "update:draft": [value: OperationDraft] }>();

const patch = (over: Partial<OperationDraft>): void => emit("update:draft", { ...props.draft, ...over });

/** Vendor range is 1–9 (guide p194). Above three the API demands a fresh sign-in — the drawer warns. */
const useOptions = Array.from({ length: 9 }, (_, i) => ({
  value: String(i + 1),
  label: i === 0 ? "1 purchase" : `${i + 1} purchases`,
}));

/**
 * A real either/or, not a checkbox: EFS's recipe (p194) sets `overrideAllLocations=true` for
 * everywhere and `locationOverride=<id>` with `overrideAllLocations=false` for one truck stop. A UI
 * that let both be true at once would be describing a document EFS does not accept.
 */
const scopeOptions = [
  { value: "all", label: "Any location" },
  { value: "location", label: "One location only" },
];

const validationOptions = [
  { value: "EXACT_MATCH", label: "Must match exactly — the pump checks it" },
  { value: "REPORT_ONLY", label: "Report only — the pump records whatever is typed" },
];

function patchPrompt(index: number, over: Partial<PromptInput>): void {
  patch({ prompts: props.draft.prompts.map((p, i) => (i === index ? { ...p, ...over } : p)) });
}

/** The record being ADDED, which lives in `prompts` alongside the card's own — see `seededDraft`. */
const added = computed(() => props.draft.prompts.find((p) => p.infoId === props.draft.addInfoId) ?? null);

const patchAdded = (over: Partial<PromptInput>): void =>
  patch({ prompts: props.draft.prompts.map((p) => (p.infoId === props.draft.addInfoId ? { ...p, ...over } : p)) });

/** Swapping which prompt is being added replaces the pending record rather than keeping both. */
function chooseAdded(infoId: string): void {
  const keep = props.draft.prompts.filter((p) => p.infoId !== props.draft.addInfoId);
  patch({
    addInfoId: infoId as PromptInput["infoId"],
    prompts: [...keep, {
      infoId: infoId as PromptInput["infoId"],
      validationType: "EXACT_MATCH", matchValue: "", reportValue: null, remove: false,
    }],
  });
}
</script>

<template>
  <!--
    Three statuses, one tick, one Save — the vendor's own model (Cards → View Cards → Select →
    Change Status → New Status). Checkboxes rather than a select because the whole list is three
    items: seeing all three at once, with the card's own state already ticked, IS the diff.

    Only one may be ticked. Ticking a row REPLACES the selection rather than adding to it, which is
    radio behaviour wearing a checkbox — deliberate, and the reason each row is `readonly` to the
    keyboard's space bar only in the sense that unticking the current row does nothing: a card
    always has exactly one status, and "no status" is not a state anybody can save.
  -->
  <div v-if="props.operation === 'status'" class="space-y-1">
    <p v-if="props.unwritableStatus" class="rounded-control bg-caution-50 px-3 py-2 text-sm text-caution-700">
      This card is <strong>{{ props.unwritableStatus }}</strong>, which is not one of the three below.
      Choosing one will move it out of that state.
    </p>
    <div v-for="row in props.statusRows ?? []" :key="row.value" class="flex flex-wrap items-center gap-x-3">
      <AppCheckbox
        :model-value="props.draft.targetStatus === row.value"
        :disabled="props.busy || props.statusBlocked?.[row.value] != null"
        :label="row.label"
        @update:model-value="(on: boolean) => on && patch({ targetStatus: row.value })"
      />
      <span v-if="row.current" class="text-xs text-ink-tertiary">Current</span>
      <!-- Invariant 6: a row nobody can reach says which permission is missing, never just grey. -->
      <span v-if="props.statusBlocked?.[row.value]" class="text-sm text-ink-muted">
        {{ blockedSentence(props.statusBlocked[row.value]!) }}
      </span>
    </div>
  </div>

  <div v-else-if="props.operation === 'grant'" class="space-y-4">
    <FormField label="How many purchases" hint="The exception is used up automatically — it does not need to be revoked.">
      <template #default="{ id }">
        <ComboSelect
          :id="id"
          :model-value="String(props.draft.uses)"
          :options="useOptions"
          :disabled="props.busy"
          @update:model-value="patch({ uses: Number($event) })"
        />
      </template>
    </FormField>

    <FormField label="Where it applies">
      <template #default="{ id }">
        <ComboSelect
          :id="id"
          :model-value="props.draft.scopeKind"
          :options="scopeOptions"
          :disabled="props.busy"
          @update:model-value="patch({ scopeKind: $event as 'all' | 'location', location: null })"
        />
      </template>
    </FormField>

    <EfsLocationPicker
      v-if="props.draft.scopeKind === 'location'"
      :model-value="props.draft.location"
      :disabled="props.busy"
      @update:model-value="patch({ location: $event as EfsLocation | null })"
    />
  </div>

  <!--
    Adding a prompt to a card that has none — the gap that made an unassigned card unattributable.
    The picker only appears when the card lacks BOTH editable prompts; with one missing there is
    nothing to choose and a select of one item is a question with one answer.
  -->
  <div v-else-if="props.operation === 'promptAdd'" class="space-y-4">
    <FormField
      v-if="(props.addOptions?.length ?? 0) > 1"
      label="Which prompt"
      hint="Driver ID is what ties a fill to a person; Unit ties it to a truck."
    >
      <template #default="{ id }">
        <ComboSelect
          :id="id"
          :model-value="props.draft.addInfoId ?? ''"
          :options="(props.addOptions ?? []).map((v) => ({ value: v, label: infoLabel(v) }))"
          :disabled="props.busy"
          @update:model-value="chooseAdded($event)"
        />
      </template>
    </FormField>

    <div v-if="added" class="space-y-3 rounded-control border border-edge p-3">
      <p class="text-sm font-medium text-ink">{{ infoLabel(added.infoId) }}</p>
      <FormField
        :label="added.validationType === 'REPORT_ONLY' ? 'Value to report' : 'Value the driver must enter'"
        :hint="`Maximum ${EFS_MATCH_VALUE_MAX} characters.`"
      >
        <template #default="{ id }">
          <BaseInput
            :id="id"
            type="text"
            :maxlength="EFS_MATCH_VALUE_MAX"
            :model-value="added.validationType === 'REPORT_ONLY' ? added.reportValue ?? '' : added.matchValue ?? ''"
            :disabled="props.busy"
            @update:model-value="patchAdded(added.validationType === 'REPORT_ONLY' ? { reportValue: $event } : { matchValue: $event })"
          />
        </template>
      </FormField>
      <FormField label="How the pump treats it">
        <template #default="{ id }">
          <ComboSelect
            :id="id"
            :model-value="added.validationType"
            :options="validationOptions"
            :disabled="props.busy"
            @update:model-value="patchAdded({ validationType: $event as PromptInput['validationType'] })"
          />
        </template>
      </FormField>
    </div>
  </div>

  <div v-else-if="props.operation === 'prompts'" class="space-y-4">
    <div
      v-for="(prompt, index) in props.draft.prompts"
      :key="prompt.infoId"
      class="space-y-3 rounded-control border border-edge p-3"
    >
      <p class="text-sm font-medium text-ink">{{ infoLabel(prompt.infoId) }}</p>
      <FormField
        :label="prompt.validationType === 'REPORT_ONLY' ? 'Value to report' : 'Value the driver must enter'"
        :hint="prompt.validationType === 'REPORT_ONLY'
          ? `Maximum ${EFS_MATCH_VALUE_MAX} characters. An empty report value is allowed.`
          : `Maximum ${EFS_MATCH_VALUE_MAX} characters. Choose Remove this prompt to remove it.`"
      >
        <template #default="{ id }">
          <BaseInput
            :id="id"
            type="text"
            :maxlength="EFS_MATCH_VALUE_MAX"
            :model-value="prompt.validationType === 'REPORT_ONLY' ? prompt.reportValue ?? '' : prompt.matchValue ?? ''"
            :disabled="props.busy || prompt.remove"
            @update:model-value="patchPrompt(index, prompt.validationType === 'REPORT_ONLY' ? { reportValue: $event } : { matchValue: $event })"
          />
        </template>
      </FormField>
      <FormField label="How the pump treats it">
        <template #default="{ id }">
          <ComboSelect
            :id="id"
            :model-value="prompt.validationType"
            :options="validationOptions"
            :disabled="props.busy || prompt.remove"
            @update:model-value="patchPrompt(index, { validationType: $event as PromptInput['validationType'] })"
          />
        </template>
      </FormField>
      <div class="flex justify-end">
        <!-- Clearing a value is NOT removing a prompt: empty values are valid for REPORT_ONLY. -->
        <BaseButton
          v-if="prompt.remove"
          variant="ghost"
          size="sm"
          :disabled="props.busy"
          @click="patchPrompt(index, { remove: false })"
        >
          Keep this prompt
        </BaseButton>
        <BaseButton
          v-else
          variant="danger"
          size="sm"
          :disabled="props.busy"
          @click="patchPrompt(index, { remove: true })"
        >
          Remove this prompt
        </BaseButton>
      </div>
      <p v-if="prompt.remove" class="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700">
        The pump will stop asking for this after you confirm.
      </p>
    </div>

    <!--
      Listed, greyed and untouched. Hiding them would make an operator think the card asks for
      nothing else, and a save that silently preserved them would look like luck rather than design.
      (It is design — see `promptsEdits` in the API, which echoes those records verbatim.)
    -->
    <div v-if="props.readOnlyPrompts.length > 0" class="space-y-1">
      <p class="text-sm text-ink-muted">Also on this card, and left untouched:</p>
      <ul class="space-y-1">
        <li v-for="row in props.readOnlyPrompts" :key="row.infoId" class="text-sm text-ink-tertiary">
          {{ infoLabel(row.infoId) }}
          <span v-if="row.validationType === 'REPORT_ONLY' ? row.reportValue : row.matchValue">
            — {{ row.validationType === "REPORT_ONLY" ? row.reportValue : row.matchValue }}
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>
