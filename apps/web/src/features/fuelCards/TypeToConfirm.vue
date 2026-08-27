<script setup lang="ts">
import { computed } from "vue";
import { AppInput } from "@silvicom/ui";

/**
 * Type the card's last four before Confirm becomes pressable — Step 8.1's gate on `card_deactivate`.
 *
 * ── Its own component rather than eight lines inside the drawer ─────────────────────────────────
 * `CardOperationDrawer.vue` was at 487 lines against `lint:filesize`'s 500-line cap when this was
 * written, and docs/35 §4.5 records what happens when a file goes over: the gate fails
 * unconditionally, which then masked a mutation probe and dropped `mutation-check` to 17/18. A
 * region with its own state and its own matching rule is worth extracting on its own merits; the
 * budget just settles when.
 *
 * ── Why it never sees a card number ─────────────────────────────────────────────────────────────
 * `expected` is the last four the caller already holds as part of a MASKED reference (`••••7671`),
 * never a PAN — the view layer has no legitimate use for one and `CapabilityCardContext` is typed to
 * make that impossible. This component only ever compares four digits against four digits.
 */

const props = defineProps<{
  /** The four digits the operator has to reproduce. */
  expected: string;
  value: string;
  label: string;
  /** Shown once they have typed something that does not match — invariant 6, a sentence not a flag. */
  mismatch: string;
  busy: boolean;
}>();

const emit = defineEmits<{ "update:value": [string] }>();

/** Blank is not a mismatch: an untouched field has not failed anything yet, it is just unfinished. */
const showMismatch = computed(() => props.value.length > 0 && !typeToConfirmSatisfied(props.expected, props.value));

/** Digits only, capped at four — so a paste of the full PAN cannot end up in this field. */
function onInput(next: string): void {
  emit("update:value", next.replace(/[^0-9]/g, "").slice(0, 4));
}
</script>

<script lang="ts">
/**
 * The match rule, exported so the drawer's `missing` computed and this component's own hint read the
 * SAME predicate. Two copies of "has the operator typed the right digits" is how a Confirm button
 * enables while the field still shows an error.
 *
 * Fails CLOSED on a reference with no recoverable last four: if we cannot say what the operator
 * should type, we must not accept anything they type. A masked ref is `••••7671`, so the last four
 * characters are the digits; anything else yields no expectation and therefore no match.
 */
export const typeToConfirmSatisfied = (expected: string, typed: string): boolean =>
  /^[0-9]{4}$/.test(expected) && typed === expected;

/** The four digits out of a masked reference like `••••7671`, or `""` when there are none. */
export const lastFourOf = (maskedRef: string): string => {
  const digits = maskedRef.replace(/[^0-9]/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
};
</script>

<template>
  <section class="space-y-2" aria-labelledby="type-to-confirm-heading">
    <label id="type-to-confirm-heading" for="type-to-confirm" class="block text-sm font-medium text-ink">
      {{ props.label }}
    </label>
    <AppInput
      id="type-to-confirm"
      :model-value="props.value"
      :invalid="showMismatch"
      :disabled="props.busy"
      class="w-28"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      maxlength="4"
      placeholder="1234"
      :aria-invalid="showMismatch"
      :aria-describedby="showMismatch ? 'type-to-confirm-error' : undefined"
      @update:model-value="onInput"
    />
    <p v-if="showMismatch" id="type-to-confirm-error" class="text-sm text-danger-600" role="alert">
      {{ props.mismatch }}
    </p>
  </section>
</template>
