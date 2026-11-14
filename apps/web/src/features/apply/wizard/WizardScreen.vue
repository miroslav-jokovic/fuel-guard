<script setup lang="ts">
import { APPLY_COPY } from "@/features/apply/strings";
import {
  AppButton,
  AppCheckbox,
  AppCombobox as ComboSelect,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppRadioGroup,
  AppTextarea,
} from "@silvicom/ui";
import {
  QUICK_PICKS,
  US_JURISDICTION_CODES,
  factChoices,
  jurisdictionOptions,
  type FactPath,
  type WizardField,
  type WizardScreen,
} from "@silvicom/shared";
import { nextTick } from "vue";
import { newRowKey } from "@/features/apply/draft";
import YesNoField from "@/features/apply/YesNoField.vue";
import ApplyDate from "@/features/apply/ApplyDate.vue";
import type { WizardBinding } from "./wizardBinding";

/**
 * Any generated screen (APPLICATION-SCREEN-MAP.md §7, F4 PR 1): one question (D-AM2), or the fields
 * of one fact typed together (D-AM3) — whatever the catalogue put on it (`WIZARD_SCREENS`).
 *
 * The control is the fact's `input` kind and nothing else: a yes/no is two big buttons, a date is the
 * one typed date box (D-AM6) in the years its `ask` says, a state is the searchable list, a choice
 * is its contract's own values (`factChoices`). So a fact moved to another screen keeps its control,
 * and a screen needs no component of its own.
 *
 * It owns nothing: answers are read and written through the page's binding, and the problems shown
 * are the ones the page's Continue found — what the screen shows and what the walk checks cannot
 * disagree.
 */
/** `row`: the row a loop screen asks about (Stage 2, F4 PR 1b-1) — every read and write is that row's. */
const props = defineProps<{ screen: WizardScreen; binding: WizardBinding; row?: number }>();

const US_STATES = jurisdictionOptions().filter((o) => US_JURISDICTION_CODES.has(o.value));
const JURISDICTIONS = jurisdictionOptions();

/** Phone keypads for numbers, the browser's text keyboard for the rest (U3 refines the rest). */
const INPUT_MODE: Partial<Record<WizardField["fact"]["input"], string>> = {
  us_mobile: "tel", phone: "tel", zip: "numeric", count: "numeric", miles: "numeric",
};
const TYPE: Partial<Record<WizardField["fact"]["input"], string>> = { us_mobile: "tel", phone: "tel", email: "email" };

/** The fact's words on THIS screen (`WizardBinding.copy`). */
const words = (f: WizardField) => props.binding.copy(f.fact.path, props.screen.id);
const read = (path: FactPath) => props.binding.read(path, props.row);
const write = (path: FactPath, value: unknown) => props.binding.write(path, value, props.row);
const id = (path: FactPath) => props.binding.id(path, props.row);
const error = (path: FactPath) => props.binding.error(path, props.row);
/** A fact's quick picks (`FactAsk.quickPicks`): the English value filed, the words in the page's language. */
const picks = (f: WizardField) =>
  f.ask.quickPicks
    ? QUICK_PICKS[f.ask.quickPicks].map((value) => ({
        value,
        label: (APPLY_COPY.quickPicks[f.ask.quickPicks!] as Record<string, string>)[value] ?? value,
      }))
    : [];
/**
 * A quick-picked answer reads in the page's language in its box, and is FILED in English (`QUICK_PICKS`):
 * the Spanish page showed "Speeding" in its own box after a tap (U7). Typing a pick's words files the pick
 * too, so the same answer is never filed in two languages.
 */
const shown = (f: WizardField): string => picks(f).find((p) => p.value === text(f.fact.path))?.label ?? text(f.fact.path);
const typed = (f: WizardField, value: string): void =>
  write(f.fact.path, picks(f).find((p) => p.label.trim().toLowerCase() === value.trim().toLowerCase())?.value ?? value);
const text = (path: FactPath): string => String(read(path) ?? "");
const yesNo = (path: FactPath): boolean | null => (read(path) as boolean | null | undefined) ?? null;
const choices = (f: WizardField) => {
  const options = words(f).options;
  return (factChoices(f.fact.path) ?? []).map((value) => ({ value, label: options?.[value] ?? value }));
};

const picked = (path: FactPath): string[] => (read(path) as string[] | undefined) ?? [];

/**
 * A list of names (`other_names`, SCREEN-MAP 2.1a): a box per name, "Add a name", and a removal per box,
 * as the section component asked it. Every change is written through the binding, the one door a
 * generated screen writes by, never into the array it read.
 */
type NameRow = { name: string; key: string };
const names = (path: FactPath): NameRow[] => (read(path) as NameRow[] | undefined) ?? [];
/** Q-AM22 (b): each name is its keyed row, so the box, its removal and an office correction follow the name. */
const setName = (path: FactPath, key: string, value: string): void =>
  write(path, names(path).map((n) => (n.key === key ? { ...n, name: value } : n)));
/** A new box is where the driver is about to type, so it takes the cursor. */
async function addName(path: FactPath): Promise<void> {
  write(path, [...names(path), { name: "", key: newRowKey() }]);
  await nextTick();
  const boxes = document.getElementById(id(path))?.querySelectorAll("input");
  boxes?.[boxes.length - 1]?.focus();
}

function toggle(f: WizardField, value: string, on: boolean): void {
  const chosen = new Set(picked(f.fact.path));
  if (on) chosen.add(value); else chosen.delete(value);
  // In the contract's order, whatever order they were ticked in.
  write(f.fact.path, (factChoices(f.fact.path) ?? []).filter((v) => chosen.has(v)));
}
</script>

<template>
  <div class="space-y-4">
    <template v-for="f in screen.fields" :key="f.fact.path">
      <YesNoField
        v-if="f.fact.input === 'yesno'"
        :id="id(f.fact.path)"
        :model-value="yesNo(f.fact.path)"
        :legend="words(f).label"
        :hint="words(f).hint"
        :error="error(f.fact.path)"
        @update:model-value="write(f.fact.path, $event)"
      />

      <div v-else-if="f.fact.input === 'choice'" :id="id(f.fact.path)">
        <AppRadioGroup
          :model-value="text(f.fact.path)"
          :legend="words(f).label"
          :options="choices(f)"
          @update:model-value="write(f.fact.path, $event)"
        />
        <p v-if="words(f).hint" class="mt-1 text-xs text-ink-muted">{{ words(f).hint }}</p>
        <p v-if="error(f.fact.path)" class="mt-1 text-sm text-danger-700" role="alert">{{ error(f.fact.path) }}</p>
      </div>

      <fieldset v-else-if="f.fact.input === 'multi_choice'" :id="id(f.fact.path)">
        <legend class="text-sm font-medium text-ink-secondary">{{ words(f).label }}</legend>
        <AppCheckbox
          v-for="c in choices(f)"
          :key="c.value"
          :model-value="picked(f.fact.path).includes(c.value)"
          :label="c.label"
          @update:model-value="toggle(f, c.value, $event)"
        />
        <p v-if="error(f.fact.path)" class="mt-1 text-sm text-danger-700" role="alert">{{ error(f.fact.path) }}</p>
      </fieldset>

      <fieldset v-else-if="f.fact.input === 'names'" :id="id(f.fact.path)" class="space-y-2">
        <legend class="text-sm font-medium text-ink-secondary">{{ words(f).label }}</legend>
        <p v-if="words(f).hint" class="text-xs text-ink-muted">{{ words(f).hint }}</p>
        <div v-for="(row, i) in names(f.fact.path)" :key="row.key" class="flex items-center gap-2">
          <BaseInput
            :model-value="row.name"
            :aria-label="`${words(f).label} ${i + 1}`"
            class="flex-1"
            autocomplete="off"
            @update:model-value="setName(f.fact.path, row.key, $event)"
          />
          <AppButton variant="ghost" size="touch" @click="write(f.fact.path, names(f.fact.path).filter((n) => n.key !== row.key))">
            {{ APPLY_COPY.identity.remove }}
          </AppButton>
        </div>
        <AppButton variant="secondary" size="touch" @click="addName(f.fact.path)">
          {{ APPLY_COPY.identity.addOtherName }}
        </AppButton>
        <p v-if="error(f.fact.path)" class="text-sm text-danger-700" role="alert">{{ error(f.fact.path) }}</p>
      </fieldset>

      <FormField
        v-else
        :id="id(f.fact.path)"
        :label="words(f).label"
        :hint="words(f).hint"
        :error="error(f.fact.path)"
      >
        <template #default="field">
          <ApplyDate
            v-if="f.fact.input === 'date' || f.fact.input === 'month'"
            v-bind="field"
            :model-value="text(f.fact.path)"
            :kind="f.ask.dates"
            :autocomplete="words(f).autocomplete"
            :invalid="Boolean(error(f.fact.path))"
            @update:model-value="write(f.fact.path, $event)"
          />
          <ComboSelect
            v-else-if="f.fact.input === 'us_state' || f.fact.input === 'jurisdiction'"
            v-bind="field"
            :model-value="text(f.fact.path)"
            :placeholder="APPLY_COPY.placeholders.choose"
            :options="f.fact.input === 'us_state' ? US_STATES : JURISDICTIONS"
            @update:model-value="write(f.fact.path, $event)"
          />
          <AppTextarea
            v-else-if="f.fact.input === 'longtext'"
            v-bind="field"
            :model-value="text(f.fact.path)"
            :rows="3"
            @update:model-value="write(f.fact.path, $event)"
          />
          <BaseInput
            v-else-if="f.ask.quickPicks"
            v-bind="field"
            :model-value="shown(f)"
            @update:model-value="typed(f, $event)"
          />
          <BaseInput
            v-else
            v-bind="field"
            :model-value="text(f.fact.path)"
            :type="TYPE[f.fact.input]"
            :inputmode="INPUT_MODE[f.fact.input]"
            :maxlength="f.fact.input === 'zip' ? 5 : undefined"
            :autocomplete="words(f).autocomplete"
            :placeholder="words(f).placeholder"
            @update:model-value="write(f.fact.path, $event)"
          />
        </template>
      </FormField>
      <!-- Quick picks (SCREEN-MAP §1): a tap fills the box, which stays open for anything else. -->
      <div v-if="picks(f).length" class="-mt-2 flex flex-wrap gap-2">
        <AppButton
          v-for="p in picks(f)"
          :key="p.value"
          variant="secondary"
          size="sm"
          :aria-pressed="text(f.fact.path) === p.value"
          @click="write(f.fact.path, p.value)"
        >
          {{ p.label }}
        </AppButton>
      </div>
    </template>
  </div>
</template>
