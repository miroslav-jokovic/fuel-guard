<script setup lang="ts">
/**
 * Parts of a whole as ONE bar with a legend carrying value and share (D-FO4's sibling ruling: the
 * composition stays a part-to-whole picture, but a stacked bar reads three shares in one pass where
 * a ring asks the eye to compare arc lengths — and it takes 10px of height, not 192).
 *
 * The legend is the accessible reading: every segment is named with its value and share in text,
 * so the bar itself is `aria-hidden` decoration. A 2px surface gap separates fills (the dataviz
 * rule for stacked segments: a gap, never a border), and a zero-value segment draws nothing rather
 * than a sliver that would claim a share it does not have.
 */
import { computed } from "vue";

const props = defineProps<{
  items: readonly { key: string; label: string; value: number; valueLabel: string; color: string }[];
  /** What the whole is, for the spoken summary: "fuel cost composition". */
  name: string;
}>();

const total = computed(() => props.items.reduce((n, i) => n + i.value, 0));
const pct = (v: number) => (total.value > 0 ? Math.round((v / total.value) * 100) : 0);
const summary = computed(() =>
  `${props.name}: ${props.items.map((i) => `${i.label} ${i.valueLabel}, ${pct(i.value)}%`).join("; ")}`,
);
</script>

<template>
  <div>
    <div class="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
      <span v-for="i in items.filter((x) => x.value > 0)" :key="i.key" class="block h-full" :style="{ width: `${pct(i.value)}%`, backgroundColor: i.color }" /> <!-- token-check-disable-line: token-resolved chart color -->
    </div>
    <ul class="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs" :aria-label="summary">
      <li v-for="i in items" :key="i.key" class="flex items-center gap-1.5">
        <span class="size-2 shrink-0 rounded-detail" :style="{ backgroundColor: i.color }" aria-hidden="true" /> <!-- token-check-disable-line: token-resolved chart color -->
        <span class="text-ink-muted">{{ i.label }}</span>
        <span class="font-semibold tabular-nums text-ink">{{ i.valueLabel }}</span>
        <span class="tabular-nums text-ink-tertiary">· {{ pct(i.value) }}%</span>
      </li>
    </ul>
  </div>
</template>
