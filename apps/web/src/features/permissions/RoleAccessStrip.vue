<script setup lang="ts">
import { computed } from "vue";
import type { SectionAccess } from "@silvicom/shared";

/**
 * A role's eleven section answers as eleven marks, read at a glance from the rail (S8, step 3).
 *
 * The rail names seven roles; without this an admin opens each one to learn whether it is a
 * read-mostly role or a manage-mostly one. Eleven marks in the matrix's own section order say it
 * before the click: filled is Manage, outlined is View, faint is None. The marks are decorative to a
 * screen reader — the same fact is given once, in words, in a visually hidden sentence — so the rail
 * does not read eleven times "presentation" to somebody hearing it.
 *
 * Colour comes from the selection tokens, not a status hue: an access level is not a health.
 */
const props = defineProps<{ levels: SectionAccess[] }>();

const MARK: Record<SectionAccess, string> = {
  manage: "bg-brand-600",
  view: "bg-brand-100 ring-1 ring-inset ring-brand-600/50",
  none: "bg-edge-strong/60",
};

const summary = computed(() => {
  const n = { manage: 0, view: 0, none: 0 };
  for (const l of props.levels) n[l] += 1;
  return `Manage ${n.manage}, view ${n.view}, none ${n.none}`;
});
</script>

<template>
  <span class="inline-flex items-center gap-0.5" :title="summary">
    <span
      v-for="(level, i) in levels"
      :key="i"
      aria-hidden="true"
      class="size-1.5 shrink-0 rounded-detail"
      :class="MARK[level]"
    />
    <span class="sr-only">{{ summary }}</span>
  </span>
</template>
