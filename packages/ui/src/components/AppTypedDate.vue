<script setup lang="ts">
import { computed, ref, useAttrs, watch } from "vue";
import {
  maskTypedDate,
  parseTypedDate,
  spellTypedDate,
  typedDateText,
  type TypedDateKind,
  type TypedDateProblem,
} from "../typedDate";

/**
 * One box a date is TYPED into: "1001", "10011985", "3/15/85" (APPLICATION-SCREEN-MAP §9, D-AM6,
 * owner 2026-11-09). On the wire it is `yyyy-MM-dd`, or `yyyy-MM` for `kind="month"`, the same strings
 * `AppMemorableDate`, `AppDateField` and `AppMonthField` emit, so no contract moves.
 *
 * ── WHAT THE DRIVER SEES ──────────────────────────────────────────────────────────────────────
 * - **The number pad.** A phone's number pad has no slash key, which is why the slashes draw themselves
 *   (`maskTypedDate`). They are drawn where the reading breaks, so the screen shows how the date will be
 *   read while it is typed.
 * - **The date in words, under the box, as soon as it reads.** For example "October 1, 1985", or
 *   "1 de octubre de 1985" on a Spanish page. It is the driver's check on the year this box assumed, and
 *   the reason the year can be assumed at all.
 * - **A plain sentence when it cannot be read.** For example "There is no month 13", shown in place of
 *   the words. A half-typed date says nothing yet, because it is not wrong yet.
 *
 * ── WHAT IT EMITS ─────────────────────────────────────────────────────────────────────────────
 * A whole date, or `""` while there is none: the same contract as the controls it replaces. A date that
 * READS but is not ACCEPTABLE (born last year, expired) is still emitted. Range is the caller's schema,
 * which can name the rule that failed. This box only answers "what date did they type".
 *
 * ⚠ The box keeps what was typed, even while it is incomplete. A parent re-rendering with `""` would
 * otherwise wipe a half-typed date. The model is read back into the box only when it names a different
 * whole date (set by the caller, not by us). That is `AppMemorableDate`'s rule, kept.
 */
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    /** What the field asks; it decides the year a short answer gets (`typedDate.ts`). */
    kind?: TypedDateKind;
    invalid?: boolean;
    disabled?: boolean;
    id?: string;
    /** `YYYY-MM-DD`; the caller's calendar day. Defaults to the device's. */
    today?: string;
    /** The words under the box, in the page's language. */
    language?: "en" | "es";
    autocomplete?: "bday" | "off";
    /** The sentences for what cannot be read, in the page's language; English by default. */
    problems?: Partial<Record<TypedDateProblem, string>>;
  }>(),
  {
    modelValue: "",
    kind: "any",
    invalid: false,
    disabled: false,
    id: undefined,
    today: undefined,
    language: "en",
    autocomplete: "off",
    problems: () => ({}),
  },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const ENGLISH: Record<TypedDateProblem, string> = {
  empty: "",
  incomplete: "",
  needsYear: "Add the year you were born, like 10011985.",
  badMonth: "There is no such month. Type the month first, then the day.",
  badDay: "That month does not have that day.",
  badAge: "Type the whole year, like 1985.",
  unreadable: "Type it in numbers, like 10011985.",
};

const attrs = useAttrs();
/** Everything the field hands down except `aria-describedby`, which is merged with the reading's id below. */
const passthrough = computed(() => {
  const { "aria-describedby": _omit, ...rest } = attrs as Record<string, unknown>;
  return rest;
});
const describedBy = computed(() =>
  [attrs["aria-describedby"] as string | undefined, `${props.id ?? "typed-date"}-reading`].filter(Boolean).join(" "),
);

/** The device's calendar day, from its local parts, never `toISOString` (a day is not an instant). */
function deviceToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const text = ref(typedDateText(props.modelValue));
const reading = computed(() => parseTypedDate(text.value, props.kind, props.today ?? deviceToday()));

const said = computed(() => {
  const r = reading.value;
  if (r.ok) return { tone: "ok" as const, words: spellTypedDate(r.iso, props.language) };
  const words = props.problems[r.problem] ?? ENGLISH[r.problem];
  return words ? { tone: "problem" as const, words } : null;
});

watch(
  () => props.modelValue,
  (value) => {
    const current = reading.value.ok ? reading.value.iso : "";
    if ((value ?? "") !== current && (value ?? "") !== "") text.value = typedDateText(value);
  },
);

function onInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  const masked = maskTypedDate(input.value, props.kind);
  text.value = masked;
  if (input.value !== masked) input.value = masked;
  const r = parseTypedDate(masked, props.kind, props.today ?? deviceToday());
  emit("update:modelValue", r.ok ? r.iso : "");
}

const placeholder = computed(() => (props.kind === "month" ? "MM/YYYY" : "MM/DD/YYYY"));
</script>

<template>
  <div>
    <!-- `type="text"` + `inputmode="numeric"`, not `type="number"`: a number input drops leading zeros
         and refuses slashes. h-11 is the 44 px touch target (§6.8). -->
    <input
      :id="id"
      :value="text"
      type="text"
      inputmode="numeric"
      :autocomplete="autocomplete"
      autocorrect="off"
      spellcheck="false"
      :maxlength="kind === 'month' ? 7 : 10"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-invalid="invalid || said?.tone === 'problem' ? 'true' : undefined"
      :aria-describedby="describedBy"
      :class="[
        'block h-11 w-full max-w-48 rounded-control border-0 bg-surface px-3 text-base tabular-nums text-ink ring-1 ring-inset placeholder:text-ink-disabled focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-disabled',
        invalid || said?.tone === 'problem' ? 'ring-danger-600 focus:ring-danger-600' : 'ring-edge-control focus:ring-focus-ring',
      ]"
      v-bind="passthrough"
      @input="onInput"
    />
    <p
      :id="`${id ?? 'typed-date'}-reading`"
      aria-live="polite"
      :class="['mt-1 min-h-5 text-sm', said?.tone === 'problem' ? 'text-danger-700' : 'text-ink-secondary']"
      data-testid="typed-date-reading"
    >
      {{ said?.words ?? "" }}
    </p>
  </div>
</template>
