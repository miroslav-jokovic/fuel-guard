<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import {
  ShieldCheckIcon,
} from "@silvicom/ui/icons";
import { RouterLink } from "vue-router";
import type { RiskRow } from "@silvicom/shared";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import ChartCard from "./ChartCard.vue";

/**
 * ── IT WEARS `ChartCard`'S HEADER RATHER THAN ITS OWN (DR7a's sibling, 2026-09-16) ───────────────
 * This rendered `<h3 class="text-sm font-semibold text-ink">` inside a `BaseCard` — which is
 * `ChartCard`'s header, spelled out a fourth time. Nothing here is a chart, and that is the point
 * worth recording rather than a reason to keep the copy: what `ChartCard` actually owns is "a titled
 * panel on the dashboard grid", and the two risk lists sit in that grid beside the three charts that
 * use it. A copy of a header is how the four drift apart one `mb-4` at a time.
 *
 * ⚠ The card's `flex h-full flex-col` is passed as a fallthrough attribute, which works because
 * `ChartCard`'s root IS the `BaseCard`. It is load-bearing and not decoration: the empty state below
 * uses `flex-1` to centre itself over whatever height the grid row gives this card, and without the
 * column context that `flex-1` has nothing to fill — the icon and its sentence collapse to the top
 * of a tall card beside a populated neighbour.
 */
defineProps<{
  title: string;
  rows: RiskRow[];
  /** e.g. "/vehicles" — rows link to `${linkBase}/${id}`. Omit for non-linkable rows. */
  linkBase?: string;
  emptyLabel: string;
}>();
</script>

<template>
  <ChartCard :title="title" class="flex h-full flex-col">
    <div v-if="rows.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
      <AppIcon :icon="ShieldCheckIcon" class="size-8 text-success-500" aria-hidden="true" />
      <p class="text-sm font-medium text-ink">{{ emptyLabel }}</p>
      <p class="text-xs text-ink-muted">No open cases in this period.</p>
    </div>

    <ul v-else class="divide-y divide-edge-subtle">
      <li v-for="(row, i) in rows" :key="row.id">
        <component
          :is="linkBase ? RouterLink : 'div'"
          :to="linkBase ? `${linkBase}/${row.id}` : undefined"
          :class="[
            'group -mx-2 flex items-center gap-3 rounded-surface px-2 py-2.5',
            linkBase &&
              'hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus-ring',
          ]"
        >
          <span
            class="flex size-6 shrink-0 items-center justify-center rounded-control bg-surface-muted text-xs font-semibold text-ink-muted tabular-nums"
            aria-hidden="true"
          >
            {{ i + 1 }}
          </span>
          <span
            class="min-w-0 flex-1 truncate text-sm font-medium"
            :class="linkBase ? 'text-ink group-hover:text-link' : 'text-ink'"
          >
            {{ row.label }}
          </span>
          <span v-if="row.criticalCount" :class="[BADGE_BASE, toneClass('danger'), 'normal-case tabular-nums']">
            {{ row.criticalCount }} critical
          </span>
          <span :class="[BADGE_BASE, toneClass('neutral'), 'normal-case tabular-nums']">
            {{ row.anomalyCount }} open
          </span>
        </component>
      </li>
    </ul>
  </ChartCard>
</template>
