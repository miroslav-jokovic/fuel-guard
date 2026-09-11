<script setup lang="ts">
import { computed, useId } from "vue";

const props = withDefaults(
  defineProps<{ label?: string; hint?: string; error?: string; required?: boolean; id?: string }>(),
  { label: undefined, hint: undefined, error: undefined, required: false, id: undefined },
);
const generated = useId();
const fieldId = computed(() => props.id ?? generated);
const descriptionId = computed(() =>
  props.error || props.hint ? `${fieldId.value}-description` : undefined,
);

/**
 * The wiring a control needs, as ONE object the caller can spread.
 *
 * ── WHY THIS IS BUILT HERE AND NOT WRITTEN ON THE `<slot>` TAG (found 2026-09-11) ──────────────
 * It was four attributes on the slot element — `:aria-describedby`, `:aria-invalid`,
 * `:aria-required`, `:id` — and the template compiler CAMELIZES a slot prop's name. A caller
 * spreading them with `v-bind` therefore emitted `ariadescribedby="…"`, which is not an ARIA
 * attribute and is announced by nothing. `aria-invalid` survived only by accident: the DOM reflects
 * an `ariaInvalid` property onto the real attribute, and there is no matching reflection for
 * describedby.
 *
 * The effect was a field that showed its error in red and said nothing at all to a screen reader —
 * on a form whose whole job is telling somebody what to fix. A runtime object keeps the keys exactly
 * as written, so both halves of the message reach both kinds of reader. Pinned by "spreads ARIA
 * attributes a browser recognises, not camelised ones".
 */
const fieldAttrs = computed(() => ({
  id: fieldId.value,
  "aria-describedby": descriptionId.value,
  "aria-invalid": props.error ? true : undefined,
  "aria-required": props.required ? true : undefined,
}));
</script>

<template>
  <div>
    <label v-if="label" :for="fieldId" class="block text-sm font-medium text-ink-secondary">
      {{ label }}<span v-if="required" class="text-danger-700" aria-hidden="true"> *</span>
    </label>
    <div :class="label ? 'mt-1' : ''">
      <slot v-bind="fieldAttrs" />
    </div>
    <p v-if="error" :id="descriptionId" class="mt-1 text-sm text-danger-700">{{ error }}</p>
    <p v-else-if="hint" :id="descriptionId" class="mt-1 text-xs text-ink-tertiary">{{ hint }}</p>
  </div>
</template>
