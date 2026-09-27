<script setup lang="ts">
import { computed, ref, useAttrs, useId, watch } from "vue";

/**
 * A date somebody KNOWS — a date of birth, the expiry printed on their card — typed as three boxes,
 * month, day, year; on the wire as `yyyy-MM-dd` (APPLICATION-FLOW-V2-PLAN §6.2, D-AW11, Q-AW12).
 *
 * ── WHY NOT `AppDateField` ────────────────────────────────────────────────────────────────────
 * `AppDateField` is a calendar, and a calendar is the right control for a date somebody is CHOOSING —
 * a delivery, an appointment. For a date of birth it is the wrong one: the applicant already knows the
 * answer, and a calendar makes them page back forty years to a day they could type in six keystrokes
 * (GOV.UK's "memorable date" pattern, and the reason it exists). On a phone it is worse — a popover
 * over a keyboard. Three numeric boxes open the number pad and take the answer as it is remembered.
 *
 * ── WHAT IT EMITS ─────────────────────────────────────────────────────────────────────────────
 * `yyyy-MM-dd` once all three boxes hold something that fits them, and `""` until then — never a
 * half-date the caller would have to parse. It does NOT decide whether the date is real (31 February)
 * or sensible (born next year): that is the caller's schema, which can name the rule that failed.
 * Leading zeros are the control's job, so "3 / 7 / 1985" is `1985-03-07`.
 *
 * ⚠ The boxes keep what was typed even while it is incomplete; a model that could only hold a whole
 * date would otherwise wipe the first box the moment its parent re-rendered with `""`. The model is
 * read back into the boxes only when it names a different whole date — set by the caller, not by us.
 *
 * `id` lands on the month box, so an `AppFormField` label names the first thing to type; each box
 * also carries its own visible label, because three unlabelled boxes are three guesses.
 */
const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    invalid?: boolean;
    disabled?: boolean;
    id?: string;
    /** `bday` turns on the browser's own date-of-birth autofill (`bday-month`, `bday-day`, `bday-year`). */
    autocomplete?: "bday" | "off";
    labels?: { month: string; day: string; year: string };
  }>(),
  {
    modelValue: "",
    invalid: false,
    disabled: false,
    id: undefined,
    autocomplete: "off",
    labels: () => ({ month: "Month", day: "Day", year: "Year" }),
  },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
defineOptions({ inheritAttrs: false });
/**
 * `AppFormField` hands its control `aria-describedby` (the hint or the error). It belongs on the
 * boxes, where a screen reader is when it matters — on the wrapper it is announced by nothing.
 */
const attrs = useAttrs();
const describedBy = computed(() => attrs["aria-describedby"] as string | undefined);

const generated = useId();
const baseId = computed(() => props.id ?? generated);

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const month = ref("");
const day = ref("");
const year = ref("");

function compose(): string {
  const m = month.value.trim();
  const d = day.value.trim();
  const y = year.value.trim();
  if (!/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d) || !/^\d{4}$/.test(y)) return "";
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

watch(
  () => props.modelValue,
  (value) => {
    const match = ISO.exec(value ?? "");
    if (!match || value === compose()) return;
    [year.value, month.value, day.value] = [match[1]!, match[2]!, match[3]!];
  },
  { immediate: true },
);

function update(part: "month" | "day" | "year", raw: string): void {
  const digits = raw.replace(/\D/g, "").slice(0, part === "year" ? 4 : 2);
  ({ month, day, year })[part].value = digits;
  emit("update:modelValue", compose());
}

const boxes = computed(() => [
  { part: "month" as const, label: props.labels.month, width: "w-16", max: 2, value: month.value },
  { part: "day" as const, label: props.labels.day, width: "w-16", max: 2, value: day.value },
  { part: "year" as const, label: props.labels.year, width: "w-24", max: 4, value: year.value },
]);
</script>

<template>
  <div class="flex items-end gap-3">
    <div v-for="box in boxes" :key="box.part">
      <label :for="box.part === 'month' ? baseId : `${baseId}-${box.part}`" class="block text-xs text-ink-secondary">
        {{ box.label }}
      </label>
      <!-- `type="text"` + `inputmode="numeric"`, not `type="number"`: a number input drops leading
           zeros, spins on a scroll wheel, and accepts "1e3". h-11 is the 44 px target (§6.8). -->
      <input
        :id="box.part === 'month' ? baseId : `${baseId}-${box.part}`"
        :value="box.value"
        type="text"
        inputmode="numeric"
        pattern="[0-9]*"
        :maxlength="box.max"
        :autocomplete="autocomplete === 'bday' ? `bday-${box.part}` : 'off'"
        :disabled="disabled"
        :aria-invalid="invalid ? true : undefined"
        :aria-describedby="describedBy"
        :class="[
          box.width,
          'mt-1 block h-11 rounded-control border-0 bg-surface px-3 text-base text-ink ring-1 ring-inset focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-disabled',
          invalid ? 'ring-danger-600 focus:ring-danger-600' : 'ring-edge-control focus:ring-focus-ring',
        ]"
        @input="update(box.part, ($event.target as HTMLInputElement).value)"
      />
    </div>
  </div>
</template>
