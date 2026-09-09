<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppIcon } from "@silvicom/ui";
import { PlusIcon } from "@silvicom/ui/icons";

/**
 * The number a technician types with one thumb, standing at a shelf (INVENTORY-PLAN.md I5).
 *
 * ── ⚠ NEVER `type="number"`, AND THIS IS THE WHOLE REASON THE COMPONENT EXISTS ────────────────
 * A numeric input on a phone looks right and behaves badly in three ways that all cost a count:
 * a stray scroll over a focused field changes the value silently; the spinner arrows are a 12 px
 * target beside a 48 px one; and `valueAsNumber` is `NaN` for an empty field, so "clear it and type
 * 12" passes NaN through every handler in between. `inputmode="numeric"` gives the same keypad with
 * none of that, and the value stays a string until this component converts it once.
 *
 * ── THE SIZES ARE MEASUREMENTS, NOT TASTE (plan I5) ───────────────────────────────────────────
 * 56 dp for −/+, a 12 dp gap between them, and a separate 48 dp "0" chip. The gap is the important
 * one: two 56 dp targets flush against each other are one 112 dp target as far as a thumb in a
 * glove is concerned, and the count that follows is off by one in a direction nobody can
 * reconstruct. The "0" chip is separate because "none left" is the single most common answer on a
 * shelf walk and tapping − eleven times to reach it is how a technician stops counting honestly.
 *
 * ── SELECTING ON FOCUS ────────────────────────────────────────────────────────────────────────
 * The numeral opens with its value SELECTED, so typing replaces rather than appends. A field
 * pre-filled with `12` that a thumb taps into and types `8` at reads `128` or `812` depending on
 * where the caret landed — both plausible shelf quantities, neither detectable afterwards.
 */

const props = withDefaults(
  defineProps<{
    modelValue: number | null;
    /** Lowest allowed value. Zero is a real count, so it is the floor and not a disabled state. */
    min?: number;
    label?: string;
  }>(),
  { min: 0, label: "Counted" },
);
const emit = defineEmits<{ "update:modelValue": [value: number | null] }>();

/** The field holds a STRING, because an empty field is not a zero and must not become one. */
const draft = ref(props.modelValue === null ? "" : String(props.modelValue));
watch(
  () => props.modelValue,
  (v) => {
    const next = v === null ? "" : String(v);
    if (next !== draft.value) draft.value = next;
  },
);

const current = computed(() => (draft.value.trim() === "" ? null : Number(draft.value)));

function commit(next: number | null) {
  draft.value = next === null ? "" : String(next);
  emit("update:modelValue", next);
}

function onInput(event: Event) {
  // Digits only. A pasted "1 2" or a keypad that offers a decimal point must not reach the contract
  // as NaN — stripping here keeps the field showing what will actually be recorded.
  const cleaned = (event.target as HTMLInputElement).value.replace(/[^\d]/g, "");
  draft.value = cleaned;
  emit("update:modelValue", cleaned === "" ? null : Number(cleaned));
}

const step = (by: number) => commit(Math.max(props.min, (current.value ?? 0) + by));

/** Select on focus so a thumb-tap into a filled field replaces it. */
const onFocus = (event: FocusEvent) => (event.target as HTMLInputElement).select();

const BUTTON =
  "inline-flex size-14 shrink-0 items-center justify-center rounded-dialog border border-edge-control " +
  "bg-surface text-2xl font-semibold text-ink transition-colors active:bg-surface-muted " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
</script>

<template>
  <div class="space-y-2">
    <!-- 12 dp between the two 56 dp targets — see the header for what happens without it. -->
    <div class="flex items-center gap-3">
      <button type="button" :class="BUTTON" :aria-label="`One fewer ${label}`" @click="step(-1)">−</button>
      <input
        v-model="draft"
        type="text"
        inputmode="numeric"
        :aria-label="label"
        class="h-14 min-w-0 flex-1 rounded-dialog border border-edge-control bg-surface text-center text-3xl font-bold tabular-nums text-ink focus:outline-2 focus:outline-offset-2 focus:outline-focus-ring"
        placeholder="—"
        @focus="onFocus"
        @input="onInput"
      />
      <button type="button" :class="BUTTON" :aria-label="`One more ${label}`" @click="step(1)">
        <AppIcon :icon="PlusIcon" class="size-6" aria-hidden="true" />
      </button>
    </div>

    <!-- "None left" is the commonest answer on a shelf walk, and its own control for that reason. -->
    <button
      type="button"
      class="inline-flex h-12 items-center justify-center rounded-dialog border border-edge-control bg-surface px-5 text-base font-semibold text-ink active:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      @click="commit(0)"
    >
      0
    </button>
  </div>
</template>
