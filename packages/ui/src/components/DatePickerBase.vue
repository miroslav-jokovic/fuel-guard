<script setup lang="ts">
import { computed } from "vue";
import { VueDatePicker } from "@vuepic/vue-datepicker";
import AppIcon from "./AppIcon.vue";
import { CalendarIcon, XMarkIcon } from "../icons";

/**
 * The one date control. Not exported from the barrel — `AppDateField` and `AppDateTimeField` are the
 * two shapes it comes in, and a third caller would be a third opinion about what a date looks like.
 *
 * ── WHY THIS STOPPED BEING `<input type="date">` (D-DS17) ──────────────────────────────────────
 * Both fields were one line each: `AppInput` with a native type. That is not a component, it is a
 * delegation — the control, its calendar, its typography, its focus ring and its idea of a valid
 * date all belonged to the browser, and none of them were the ones in `tokens.generated.css`. Three
 * consequences, all of them visible:
 *
 *   · Chrome, Safari and Firefox draw three different pickers, so the product has three looks on a
 *     field that appears on twenty-five surfaces. Safari's is a stepper with no calendar at all.
 *   · The `--dp-*` block in `tokens.generated.css` has themed VueDatePicker onto the design tokens
 *     since the token pipeline was written — including `--dp-input-padding` and a comment reading
 *     "sizing: match BaseInput / rounded-control controls". That block was written for a picker used
 *     as an INPUT and nothing had ever used it that way: `DateRangeFilter` replaces the trigger
 *     entirely with its own button, so it touches none of it.
 *   · The 2026-08-11 UI audit recorded the gap in §6.1 as "both native date/datetime inputs and a
 *     custom Vue date-range picker without a shared DateField contract", and §6.3 prescribed the
 *     answer: one `DateField`/`DateTimeField` supporting typing, calendar selection, Escape, arrows,
 *     focus return, min/max and clear.
 *
 * ── THE INPUT IS OURS; THE CALENDAR IS THE LIBRARY'S ───────────────────────────────────────────
 * The `#dp-input` slot is used rather than VueDatePicker's own input, and the reason is the CLASS
 * STRING. `inputAttrs.id` would carry the id `AppFormField` generates, but v14 exposes no way to set
 * the input's classes, and this field has to be indistinguishable from `AppInput` beside it — same
 * height, same `ring-1 ring-inset ring-edge-control`, same focus ring, same invalid state. The
 * `--dp-*` variables cannot express a ring. So the slot hands the wiring back, `$attrs` (id,
 * aria-label, disabled, required) land on a real input carrying `AppInput`'s exact class string, and
 * everything below the input — the calendar, the keyboard model, the parsing — stays the library's.
 *
 * ⚠ v14 REGROUPED ITS PROPS and the flat names are still accepted as plain HTML attributes, so a
 * stale one lands silently on the root `<div>` and does nothing. `format` is `formats.input` now and
 * `enable-time-picker` / `is-24` are `time-config`; the first version of this file passed the flat
 * ones and rendered an empty input with no error anywhere. `DateRangeFilter` was carrying the same
 * dead `:enable-time-picker` from before the bump.
 *
 * ── THE DISPLAY FORMAT IS FIXED, NOT LOCALE-DERIVED, AND THAT IS DELIBERATE ────────────────────
 * `MM/dd/yyyy` is what a native input already showed these (US) users, and it is now the same on
 * every machine instead of following whatever locale the browser was started in. It is fixed rather
 * than computed because the format is also the PARSER: `text-input` reads back what `format` writes,
 * and a display format with no matching parser makes typing fail silently — the failure mode the
 * audit's "supports typing" line is about. A locale-aware pair is a real improvement and needs both
 * halves; it is not this change.
 *
 * The wire value never moves: `yyyy-MM-dd` (or `yyyy-MM-dd'T'HH:mm`), the same strings the native
 * inputs produced, so every caller and every API contract is untouched.
 */

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    invalid?: boolean;
    disabled?: boolean;
    /** Adds the time half — `AppDateTimeField`'s only difference. */
    withTime?: boolean;
    /** `yyyy-MM-dd`, inclusive. Both are passed straight through to the calendar. */
    minDate?: string | null;
    maxDate?: string | null;
  }>(),
  { modelValue: "", invalid: false, disabled: false, withTime: false, minDate: null, maxDate: null },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const DATE = "MM/dd/yyyy";
const DATE_TIME = "MM/dd/yyyy HH:mm";

const displayFormat = computed(() => (props.withTime ? DATE_TIME : DATE));
const modelFormat = computed(() => (props.withTime ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd"));
const placeholder = computed(() => (props.withTime ? "mm/dd/yyyy hh:mm" : "mm/dd/yyyy"));

/** An empty string is not a date; VueDatePicker wants `null` for "nothing chosen". */
const value = computed(() => props.modelValue || null);

/**
 * Cleared emits `""`, not `null`.
 *
 * The native inputs this replaces emitted `""`, callers branch on it (`v === "" ? null : v` in
 * `InspectionItemRow`), and `''::date` is a Postgres error rather than a null — so the string that
 * travels has to keep being the string that travelled.
 */
function onChange(next: string | null) {
  emit("update:modelValue", next ?? "");
}

const INPUT_CLASS =
  "block h-9 w-full rounded-control border-0 bg-surface px-3 text-base text-ink ring-1 ring-inset placeholder:text-ink-disabled focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-disabled sm:text-sm";
</script>

<template>
  <VueDatePicker
    :model-value="value"
    :model-type="modelFormat"
    :formats="{ input: displayFormat }"
    :time-config="{ enableTimePicker: withTime, is24: true }"
    :text-input="{ format: displayFormat }"
    :min-date="minDate || undefined"
    :max-date="maxDate || undefined"
    :disabled="disabled"
    auto-apply
    teleport
    @update:model-value="onChange"
  >
    <template
      #dp-input="{ value: shown, onInput, onEnter, onTab, onClear, onBlur, onKeypress, onPaste, openMenu, toggleMenu, isMenuOpen }"
    >
      <div class="relative">
        <input
          v-bind="$attrs"
          :value="shown"
          :disabled="disabled"
          :placeholder="placeholder"
          :class="[
            INPUT_CLASS,
            shown ? 'pr-16' : 'pr-9',
            invalid ? 'ring-danger-600 focus:ring-danger-600' : 'ring-edge-control focus:ring-focus-ring',
          ]"
          autocomplete="off"
          @input="onInput"
          @keydown.enter="onEnter"
          @keydown.tab="onTab"
          @keydown.down.prevent="openMenu"
          @keypress="onKeypress"
          @paste="onPaste"
          @blur="onBlur"
          @click="openMenu"
        />
        <!-- ── THE WAI-ARIA DATE-PICKER-DIALOG SHAPE: A PLAIN INPUT, PLUS A BUTTON ──────────────
             The input is a text field and nothing more. It carried `aria-expanded` for one commit,
             which `aria-allowed-attr` fails on the spot — that attribute is only legal on a role
             that has a popup, and giving a date field `role="combobox"` would then owe an
             `aria-controls` pointing at a menu the library teleports and does not name. The APG
             pattern the 2026-08-11 audit cites puts the state on a sibling BUTTON instead, which is
             what this is.

             Clear sits to the LEFT of the calendar, and both are real siblings rather than
             something inside the input's own hit area — the audit's §6.2 objection to `FilterSelect`
             and `DateRangeFilter` is that they nest a `role="button"` inside their trigger button.

             `mousedown.prevent` keeps focus on the input: without it the button takes focus, the
             input blurs, VueDatePicker commits the half-typed text, and the click lands on a value
             that changed underneath it. -->
        <button
          v-if="shown && !disabled"
          type="button"
          class="absolute inset-y-0 right-9 flex w-7 items-center justify-center rounded-control text-ink-tertiary hover:text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          aria-label="Clear date"
          @mousedown.prevent
          @click="onClear"
        >
          <AppIcon :icon="XMarkIcon" class="size-4" />
        </button>
        <button
          type="button"
          :disabled="disabled"
          class="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-control text-ink-tertiary hover:text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:text-ink-disabled"
          aria-haspopup="dialog"
          :aria-expanded="isMenuOpen"
          aria-label="Choose a date"
          @mousedown.prevent
          @click="toggleMenu"
        >
          <AppIcon :icon="CalendarIcon" class="size-4" />
        </button>
      </div>
    </template>
  </VueDatePicker>
</template>
