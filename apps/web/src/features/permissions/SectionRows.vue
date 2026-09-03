<script setup lang="ts">
import type { AppSection, SectionAccess } from "@silvicom/shared";
import { AppBadge, AppButton as BaseButton, AppSegmentedControl } from "@silvicom/ui";
import { ACCESS_OPTIONS } from "./layers";
import type { RowTag } from "./rows";

/**
 * One principal's DATA access, a row per editable section (P5 for a role, S5 for a person).
 *
 * ── ONE ROW SHAPE FOR BOTH TABS ───────────────────────────────────────────────────────────────
 * A role and a person answer the same eleven questions with the same three words, so they share
 * one row and differ only in what the parent puts on it: which tag marks the row, whether the
 * control is drawn as held (`inherited: false`) or as showing an answer that came from a lower
 * layer (`inherited: true`), and what the reset link says — "Reset to View" for a role, whose
 * fallback is the shipped matrix, "Follow role (View)" for a person, whose fallback is their role.
 * The row has no opinion about layers; `layers.ts` does, and the tabs apply it.
 *
 * The rows are a list, not a table: eleven labelled controls with no column to compare down, and
 * a table cannot re-stack for a phone, which is where this page was unusable.
 */
export interface SectionRowModel {
  section: AppSection;
  label: string;
  caveat?: string;
  access: SectionAccess;
  inherited: boolean;
  tag?: RowTag;
  /** The reset link's own words; absent when the row already sits at its fallback. */
  reset?: string;
}

defineProps<{ rows: SectionRowModel[]; disabled: boolean }>();
const emit = defineEmits<{
  set: [value: { section: AppSection; access: SectionAccess }];
  reset: [section: AppSection];
}>();

function onSet(row: SectionRowModel, value: string) {
  const access = value as SectionAccess;
  // A click on the segment already chosen is only a write when the row is INHERITED — that is how a
  // person takes their role's answer as their own, and it is a real row afterwards.
  if (access === row.access && !row.inherited) return;
  emit("set", { section: row.section, access });
}
</script>

<template>
  <ul class="divide-y divide-edge-subtle">
    <li
      v-for="row in rows"
      :key="row.section"
      class="grid grid-cols-1 gap-x-4 gap-y-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
    >
      <div class="min-w-0">
        <p class="text-sm font-medium text-ink">{{ row.label }}</p>
        <p v-if="row.caveat" class="mt-0.5 text-xs text-ink-muted">{{ row.caveat }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 sm:justify-end">
        <BaseButton
          v-if="row.reset"
          variant="link"
          :disabled="disabled"
          @click="emit('reset', row.section)"
        >
          {{ row.reset }}
        </BaseButton>
        <AppBadge v-if="row.tag" :tone="row.tag.tone">{{ row.tag.label }}</AppBadge>
        <AppSegmentedControl
          class="w-full sm:w-auto"
          :model-value="row.access"
          :options="ACCESS_OPTIONS"
          :label="`${row.label} access`"
          :disabled="disabled"
          :inherited="row.inherited"
          @update:model-value="onSet(row, $event)"
        />
      </div>
    </li>
  </ul>
</template>
