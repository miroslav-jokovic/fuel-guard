<script setup lang="ts">
import { computed } from "vue";

/**
 * Label/value facts — the top of a detail page, the summary in a drawer (D-US6,
 * docs/plans/design-system/UI-STANDARDIZATION.md).
 *
 * ── WHY ────────────────────────────────────────────────────────────────────────────────────────
 * On 2026-10-12 there were 47 hand-written `<dl>`s, their labels in eight styles and their grids in a
 * dozen recipes, so the same kind of fact — a truck's tank, a card's policy — read differently on every
 * page. They also each handled a blank their own way: the vehicle page printed " gal" for a truck with
 * no tank on file. `DataTable` settled that for cells long ago (an em dash, `text-ink-tertiary`); a
 * fact is a cell with its header beside it, so it gets the same answer.
 *
 * ── TWO LAYOUTS, ONE VOCABULARY ────────────────────────────────────────────────────────────────
 * `grid` (the default): label over value, 2 columns on a phone and `columns` from `sm` — the facts card
 * of a detail page. `rows`: label left, value right, one per line — a summary inside a card or drawer,
 * where the reader runs down a column of figures. Both use the contract's secondary-text label and a
 * `font-medium text-ink` value; `numeric` adds tabular figures.
 *
 * A fact that needs more than text — a badge, a link, a value with its own tone — fills the slot
 * `#value-<key>`. The slot still sits in the fact's `<dd>`, so the label and the structure stay ours.
 */
export interface Fact {
  /** Stable key, and the slot name `value-<key>`. Defaults to the label. */
  key?: string;
  label: string;
  value?: string | number | null;
  numeric?: boolean;
  /** Tone or emphasis for the value, e.g. "text-danger-700". Replaces `text-ink`. */
  tone?: string;
}

const props = withDefaults(
  defineProps<{ facts: Fact[]; layout?: "grid" | "rows"; columns?: 2 | 3 | 4 }>(),
  { layout: "grid", columns: 4 },
);

// Spelled out: Tailwind only emits classes it can read in the source (see AppCallout's tone map).
const GRID: Record<2 | 3 | 4, string> = {
  2: "grid grid-cols-2 gap-x-6 gap-y-3",
  3: "grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3",
  4: "grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4",
};
const listClass = computed(() => (props.layout === "rows" ? "space-y-2" : GRID[props.columns]));
const keyOf = (fact: Fact) => fact.key ?? fact.label;
const blank = (v: Fact["value"]) => v == null || v === "";
</script>

<template>
  <dl class="text-sm" :class="listClass">
    <div
      v-for="fact in facts"
      :key="keyOf(fact)"
      :class="layout === 'rows' ? 'flex items-baseline justify-between gap-3' : 'min-w-0'"
    >
      <dt class="text-ink-muted">{{ fact.label }}</dt>
      <dd
        class="font-medium"
        :class="[fact.tone ?? 'text-ink', fact.numeric ? 'tabular-nums' : '', layout === 'rows' ? 'text-right' : 'break-words']"
      >
        <slot :name="`value-${keyOf(fact)}`" :fact="fact">
          <span v-if="blank(fact.value)" class="font-normal text-ink-tertiary">—</span>
          <template v-else>{{ fact.value }}</template>
        </slot>
      </dd>
    </div>
  </dl>
</template>
