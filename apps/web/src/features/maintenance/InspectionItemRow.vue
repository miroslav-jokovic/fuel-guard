<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton, AppDateField, AppBadge } from "@silvicom/ui";
import { INSPECTION_RESULTS, type InspectionItem, type InspectionResult } from "@silvicom/shared";

/**
 * One of the 56 components, as a row (plan step A7).
 *
 * ── WHY THREE BUTTONS AND NOT AppRadioGroup ────────────────────────────────────────────────────
 * Radio is the right semantics and the wrong shape here: `AppRadioGroup` stacks its options
 * vertically, so 56 components would become 168 stacked rows and the page would stop being a form
 * somebody can work down. This is a toggle-button group instead — `role="group"`, one
 * `aria-pressed` per option, every option reachable by Tab and settable by Space. Raw `<button>` is
 * banned in pages and features (`lint:ui-adoption`), so these are `AppButton`s.
 *
 * ── AN INAPPLICABLE COMPONENT IS DISABLED, NOT MERELY DEFAULTED ────────────────────────────────
 * A tractor has no rear impact guard, so its row cannot be set to anything but `na` — certifying a
 * part that does not exist is a statement nobody has standing to make (the catalogue's
 * `isInspectionItemApplicable`). Contrast the fleet defaults, which are editable: this fleet's
 * tractors run air brakes, and a different unit could answer otherwise.
 */

const props = defineProps<{
  item: InspectionItem;
  result: InspectionResult;
  source: "default" | "inspector";
  repairedAt: string | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  set: [result: InspectionResult];
  "set-repaired": [value: string | null];
}>();

const untouched = computed(() => props.source === "default");

const LABELS: Record<InspectionResult, string> = {
  ok: "OK",
  needs_repair: "Repair",
  na: "N/A",
};

/** The mark the printed page will carry, so the row reads the same as the paper it becomes. */
const variantFor = (value: InspectionResult) => {
  if (props.result !== value) return "ghost" as const;
  return value === "needs_repair" ? ("danger" as const) : ("primary" as const);
};
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge-subtle px-3 py-2 last:border-b-0"
    :class="result === 'needs_repair' && !repairedAt && 'bg-danger-50'"
  >
    <!-- The item's CFR reference (`item.cfr`) is deliberately NOT rendered: on every non-hazmat page
         in this product the citations live in comments, not on screen (D-AVI15). It still travels on
         the catalogue, where the report renderer and any audit export can reach it. -->
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm text-ink" :title="item.label">{{ item.label }}</p>
    </div>

    <AppBadge v-if="untouched" tone="neutral" class="shrink-0">default</AppBadge>

    <div
      role="group"
      :aria-label="item.label"
      class="flex shrink-0 gap-1"
    >
      <BaseButton
        v-for="value in INSPECTION_RESULTS"
        :key="value"
        size="sm"
        :variant="variantFor(value)"
        :disabled="disabled"
        :aria-pressed="result === value"
        @click="emit('set', value)"
      >
        {{ LABELS[value] }}
      </BaseButton>
    </div>

    <div class="w-40 shrink-0">
      <AppDateField
        v-if="result === 'needs_repair'"
        :model-value="repairedAt"
        :aria-label="`Repair date for ${item.label}`"
        @update:model-value="(v: string) => emit('set-repaired', v === '' ? null : v)"
      />
    </div>
  </div>
</template>
