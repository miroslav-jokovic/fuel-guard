<script setup lang="ts">
import { AppIcon, type ChipTone } from "@silvicom/ui";
import {
  ShieldCheckIcon,
  type Icon,
} from "@silvicom/ui/icons";
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useOpens } from "@/composables/useOpens";
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
const props = withDefaults(
  defineProps<{
    title: string;
    rows: RiskRow[];
    /** e.g. "/vehicles" — rows link to `${linkBase}/${id}`. Omit for non-linkable rows. */
    linkBase?: string;
    emptyLabel: string;
    /**
     * The header chip, passed straight through to `ChartCard` (D-DT21). Optional because the header
     * it feeds is, and because a risk list is not a dashboard-only component — but every card in
     * the dashboard grid carries one, and a card without it now reads as the odd one out.
     */
    icon?: Icon;
    tone?: ChipTone;
  }>(),
  { linkBase: undefined, icon: undefined, tone: undefined },
);

/**
 * A row links only when the detail page it names opens for the reader (SP5, plan §4b). `linkBase` is
 * the widget's wish; whether `/vehicles/:id` or `/drivers/:id` opens is the guard's answer, asked
 * through the same function. The widget is gated on the section its DATA comes from, which is not the
 * section the detail page asks (`roster` for a driver, `equipment` for a vehicle), so before this a
 * reader could be offered a row the guard then refused. Asked once per list, not per row: every row
 * resolves to the same declared route, so a placeholder id answers for all of them.
 */
const opens = useOpens();
const rowLink = computed(() => (props.linkBase && opens(`${props.linkBase}/_`) ? props.linkBase : undefined));
</script>

<template>
  <ChartCard :title="title" :icon="icon" :tone="tone" class="flex h-full flex-col">
    <div v-if="rows.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
      <AppIcon :icon="ShieldCheckIcon" class="size-8 text-success-500" aria-hidden="true" />
      <p class="text-sm font-medium text-ink">{{ emptyLabel }}</p>
      <p class="text-xs text-ink-muted">No open cases in this period.</p>
    </div>

    <ul v-else class="divide-y divide-edge-subtle">
      <li v-for="(row, i) in rows" :key="row.id">
        <component
          :is="rowLink ? RouterLink : 'div'"
          :to="rowLink ? `${rowLink}/${row.id}` : undefined"
          :class="[
            'group -mx-2 flex items-center gap-3 rounded-surface px-2 py-2.5',
            rowLink &&
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
            :class="rowLink ? 'text-ink group-hover:text-link' : 'text-ink'"
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
