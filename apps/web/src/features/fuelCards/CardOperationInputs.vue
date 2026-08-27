<script setup lang="ts">
import { computed } from "vue";
import {
  EFS_MATCH_VALUE_MAX,
  PROMPT_INPUT_UNSET,
  type EfsLimitOption,
  type EfsLocation,
  type PromptInput,
  infoLabel,
} from "@silvicom/shared";
import { AppCombobox as ComboSelect } from "@silvicom/ui";
import { AppFormField as FormField } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppCheckbox } from "@silvicom/ui";
import { AppRadioGroup as RadioGroup } from "@silvicom/ui";
import EfsLocationPicker from "./EfsLocationPicker.vue";
import OverrideLimitPicker from "./OverrideLimitPicker.vue";
import { type CardOperationId, type OperationDraft, type StatusRow, blockedSentence } from "./cardOperations";
import { CLEAR_EXCEPTION_HELP, cardHasArmedException, clearExceptionLabel } from "./overrideException";
import { ALLOW_HAND_ENTER_HELP, ALLOW_HAND_ENTER_LABEL } from "./overrideLimits";

/**
 * The controls for whichever operation the drawer is showing — its third region.
 *
 * ── Why these are hand-written and not generated from `ui.inputs` ────────────────────────────────
 * The contract's `CapabilityInput` describes a stepper, a radio, a text box, a select — and three of
 * the five operations need something it cannot express: a location scope needs `EfsLocationPicker`,
 * which searches EFS's own location list; prompts need per-record removal with its own danger button;
 * and the status list needs one tick across three rows that write through TWO capabilities. A generic
 * factory would render two of five and special-case the rest, which is a second and weaker UI
 * vocabulary sitting next to components that already do the job (standing rule 5).
 *
 * What IS read from the contract is the frame — title, verb, tone, and the diff rows — which is the
 * part two surfaces could disagree about. The drawer does that; this renders controls.
 *
 * `clear` has no inputs at all. That is not an omission: removing an exception takes no decision
 * beyond the one already made, and a form with nothing in it would imply otherwise.
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
  /** The card's override count. H16's clear-and-lock checkbox appears only when it is above zero. */
  overrideUses?: number | null;
  /**
   * The products THIS account can cap (Step 10.3). Fed from `allowedLimitsFrom(capabilities)`, never
   * from `EFS_LIMIT_LABELS` — that table is our transcription of the guide and this account carries
   * fifteen groups it does not contain, including nothing at all for `DSL` if products are used
   * instead of groups. Offering an id the account does not have is a decline at the pump.
   */
  limitOptions?: readonly EfsLimitOption[];
}>();

const emit = defineEmits<{ "update:draft": [value: OperationDraft] }>();

const patch = (over: Partial<OperationDraft>): void => emit("update:draft", { ...props.draft, ...over });

/** Vendor range is 1–9 (guide p194). Above three the API demands a fresh sign-in — the drawer warns. */
const useOptions = Array.from({ length: 9 }, (_, i) => ({
  value: String(i + 1),
  label: i === 0 ? "1 purchase" : `${i + 1} purchases`,
}));

/**
 * A hand-typed location id becomes a location with NO name, and that is deliberate.
 *
 * `EfsLocationPicker` sets a full record because it searched for one; typing an id gives us the only
 * fact we actually have. The confirmation's `whereLabel` already falls back to "location <id>" when
 * it cannot name the station — the id is what a driver is declined at, so it is the part that must
 * never be invented.
 */
const patchLocationId = (locId: string): void => {
  const digits = locId.replace(/\D/g, "").slice(0, 7);
  patch({ location: digits ? { locId: digits, name: null, city: null, state: null } as EfsLocation : null });
};

/** The picker owns everything else about `limits` — see `OverrideLimitPicker.vue`. */
const limitDraft = computed(() => props.draft.limits ?? []);

/**
 * A real either/or, not a checkbox: EFS's recipe (p194) sets `overrideAllLocations=true` for
 * everywhere and `locationOverride=<id>` with `overrideAllLocations=false` for one truck stop. A UI
 * that let both be true at once would be describing a document EFS does not accept.
 */
const scopeOptions = [
  { value: "all", label: "All locations" },
  /**
   * "Network plus one", NOT "one only" — and the difference is the whole point.
   *
   * Guide p194: `locationOverride` is the id "that you want to **open the card up to**", and the WEX
   * portal names this option "Network Plus Optional Location". It WIDENS where the exception applies;
   * it does not confine the card. This read "One location only" until 2026-08-17, which told an
   * operator trying to contain a card that picking it would narrow access. It does the opposite.
   */
  {
    value: "location",
    label: "Network plus optional location",
    description: "The card keeps its usual network AND gains this one site.",
  },
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
      ...PROMPT_INPUT_UNSET,
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

    <!--
      docs/22 H16 — the way THROUGH, not a warning. EFS silently ignores a status change while a fuel
      exception is armed, so without this the change is refused; with it the exception leaves in the
      same write. Never pre-ticked: it destroys something the operator did not come here to destroy.
    -->
    <div v-if="cardHasArmedException(props.overrideUses)" class="space-y-1 rounded-control bg-caution-50 px-3 py-2">
      <AppCheckbox
        :model-value="props.draft.clearException"
        :disabled="props.busy"
        :label="clearExceptionLabel(props.overrideUses ?? 0)"
        @update:model-value="(on: boolean) => patch({ clearException: on })"
      />
      <p class="text-sm text-caution-700">{{ CLEAR_EXCEPTION_HELP }}</p>
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

    <!--
      The portal's `Location(s)` fieldset: two radios visible at once, not a dropdown. Both choices
      being readable without opening anything is the point — "All Locations" and "Network Plus
      Optional Location" are a real either/or and the second one WIDENS rather than confines.
    -->
    <RadioGroup
      legend="Location(s)"
      :model-value="props.draft.scopeKind"
      :options="scopeOptions"
      :disabled="props.busy"
      @update:model-value="patch({ scopeKind: $event as 'all' | 'location', location: null })"
    />

    <!--
      Two ways in, exactly as the portal has: type the EFS id straight in, or search for it. The
      portal's field is a bare text box beside a `Lookup Location` button, and an operator who
      already knows the id — off a dispatch note, or from the driver on the phone — should not have
      to search for a station they can already name.
    -->
    <div v-if="props.draft.scopeKind === 'location'" class="space-y-3">
      <FormField
        label="EFS location id"
        hint="Six digits, from the truck stop or a lookup below. The exception opens the card up to this location as well as its usual network."
      >
        <template #default="{ id }">
          <BaseInput
            :id="id"
            inputmode="numeric"
            placeholder="For example, 442001"
            :model-value="props.draft.location?.locId ?? ''"
            :disabled="props.busy"
            @update:model-value="patchLocationId(String($event))"
          />
        </template>
      </FormField>

      <EfsLocationPicker
        :model-value="props.draft.location"
        :disabled="props.busy"
        @update:model-value="patch({ location: $event as EfsLocation | null })"
      />
    </div>

    <!--
      Step 10.3's product picker. Collapsed to a single button until the operator asks for it, because
      a scope-only exception is the ordinary case and a product override DELETES the card's other
      product limits for the duration (p194) — not something to walk into by finding a form open.
    -->
    <!--
      The portal's `Optional` fieldset gates the limit screens behind a checkbox, and so does this:
      a product override DELETES the card's other product limits for the duration (p194), which is
      not something to walk into by finding a form already open. Ticking it opens one empty line, the
      way `Product/Limit Override` → `Override Card` lands you on `Create Limit`.
    -->
    <!-- The portal's `Optional` fieldset holds both. `Allow Hand Enter` is scoped to the exception
         in NO vendor artefact, so its help says so rather than repeating the portal's three words. -->
    <section class="space-y-3 border-t border-edge pt-5" aria-labelledby="optional-heading">
      <h3 id="optional-heading" class="text-sm font-semibold text-ink">Optional</h3>

      <AppCheckbox
        :model-value="props.draft.allowHandEnter"
        :label="ALLOW_HAND_ENTER_LABEL"
        :disabled="props.busy"
        @update:model-value="(on: boolean) => patch({ allowHandEnter: on })"
      />
      <p class="text-sm text-caution-700">{{ ALLOW_HAND_ENTER_HELP }}</p>

      <OverrideLimitPicker
        :limits="limitDraft"
        :busy="props.busy"
        :limit-options="props.limitOptions"
        @update:limits="patch({ limits: $event })"
      />
    </section>
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

  <!--
    Step 9.6's third action: pick ONE prompt, and read what stops happening at the pump.
    A select rather than a row of buttons — the decision is which prompt, and a list of red buttons
    invites the click that a confirmation then has to talk somebody out of.
  -->
  <div v-else-if="props.operation === 'promptRemove'" class="space-y-4">
    <FormField label="Prompt to remove">
      <template #default="{ id }">
        <ComboSelect
          :id="id"
          :model-value="props.draft.removeInfoId ?? ''"
          :options="props.draft.prompts.map((p) => ({ value: p.infoId, label: infoLabel(p.infoId) }))"
          :disabled="props.busy"
          @update:model-value="patch({ removeInfoId: $event })"
        />
      </template>
    </FormField>
    <p v-if="props.draft.removeInfoId" class="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700">
      The pump will stop asking for
      {{ infoLabel(props.draft.removeInfoId) }} on this card after you confirm.
      <span v-if="props.draft.removeInfoId === 'DRID'">
        Silvicom 360 also loses its strongest signal for attributing a fill to a driver.
      </span>
    </p>
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
          : `Maximum ${EFS_MATCH_VALUE_MAX} characters. Use Remove prompt to take it off the card.`"
      >
        <template #default="{ id }">
          <BaseInput
            :id="id"
            type="text"
            :maxlength="EFS_MATCH_VALUE_MAX"
            :model-value="prompt.validationType === 'REPORT_ONLY' ? prompt.reportValue ?? '' : prompt.matchValue ?? ''"
            :disabled="props.busy"
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
            :disabled="props.busy"
            @update:model-value="patchPrompt(index, { validationType: $event as PromptInput['validationType'] })"
          />
        </template>
      </FormField>
      <!--
        No Remove button here since Step 9.6. Removal is its own action, because one destructive
        write with two routes into it means two confirmations and two audit stories to keep in step
        — the shape audit P0-3 names. Clearing a value is NOT removing a prompt: an empty value is
        valid for REPORT_ONLY, and conflating the two is how a prompt gets deleted by someone who
        meant to blank it.
      -->
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
