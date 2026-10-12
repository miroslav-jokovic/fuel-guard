<script setup lang="ts">
/**
 * A column of counts, each with what it counts and the door to the list behind it — the anatomy of
 * the Needs-attention rail (`AttentionWidget`, D-FO6), lifted out so the Operations cards can share it
 * without reaching into `features/dashboard` (`lint:boundaries`).
 *
 * ── A COUNT IS `null` UNTIL IT IS KNOWN ──────────────────────────────────────────────────────────
 * And renders as a dash, never as 0: a zero is a claim ("nothing is late") and a fleet manager reads
 * it as one. A row whose answer is zero still renders — FLEET-MANAGER-HOME-PLAN §4 card 2: seeing
 * that nothing is late is the point of looking.
 *
 * `to` is optional because a few rows are context for the row above rather than a list of their own;
 * D-FM9 holds that a count WITH a list links to exactly that list, and `DoorLink` hides the link when
 * the page does not open for the reader (SP5) while the figure stays.
 */
import DoorLink from "@/components/ui/DoorLink.vue";

export interface CountRow {
  key: string;
  label: string;
  value: number | null;
  /** One line under the label: what the count is OF ("trucks, now"). */
  caption?: string;
  to?: string;
  door?: string;
  /** Draw the figure in the danger ink when it is above zero. For things that are wrong, not just counts. */
  alarm?: boolean;
}

/**
 * `more` is the card's door to the whole list, drawn under the rows rather than in the card header:
 * at four columns of twelve a header door beside the title and subtitle squeezed them to one word a
 * line (browser pass, 2026-10-12, 1104 px).
 */
defineProps<{ rows: readonly CountRow[]; more?: { to: string; label: string } }>();

const fmt = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
</script>

<template>
  <ul class="divide-y divide-edge-subtle">
    <li
      v-for="r in rows"
      :key="r.key"
      class="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 py-3 first:pt-0 last:pb-0"
    >
      <span class="text-sm font-medium text-ink">{{ r.label }}</span>
      <span
        class="text-lg font-bold tabular-nums"
        :class="r.alarm && (r.value ?? 0) > 0 ? 'text-danger-text' : 'text-ink'"
        :data-test="`count-${r.key}`"
      >{{ fmt(r.value) }}</span>
      <span
        v-if="r.caption || r.to"
        class="col-span-2 flex flex-wrap items-center justify-between gap-x-2 text-xs text-ink-tertiary"
      >
        <span>{{ r.caption }}</span>
        <DoorLink v-if="r.to" :to="r.to">{{ r.door ?? "Open" }}</DoorLink>
      </span>
    </li>
  </ul>
  <div v-if="more" class="mt-3 flex justify-end border-t border-edge-subtle pt-3">
    <DoorLink :to="more.to">{{ more.label }}</DoorLink>
  </div>
</template>
