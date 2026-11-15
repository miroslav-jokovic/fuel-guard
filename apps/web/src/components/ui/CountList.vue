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
 * ── …AND A ZERO IS QUIET (SMALL-SCREENS-PLAN.md Q-SM1 (a), D-SM12, 2026-11-14) ──────────────────────
 * It still renders — that ruling stands — but as ONE line: the label, the figure in the tertiary ink,
 * and its door as the arrow alone. The owner's audit counted Operations on staging: 37 rows, 28 of
 * them zero, each spending three lines (label, caption, door) to say "nothing". A fleet manager
 * scanning the tab now finds the rows that hold a number by their weight, and can still read down
 * the quiet ones to see that nothing is late. An unknown (`null`) keeps its full row and its caption:
 * a dash needs the sentence that says what is not yet known.
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
  /**
   * The figure as it should read when it is not a plain count — a rate ("17%"). `value` stays the number the
   * alarm and the tests read; a row whose figure has no answer (a rate of nothing) gives "—".
   */
  display?: string;
}

/**
 * `more` is the card's door to the whole list, drawn under the rows rather than in the card header:
 * at four columns of twelve a header door beside the title and subtitle squeezed them to one word a
 * line (browser pass, 2026-10-12, 1104 px).
 */
defineProps<{ rows: readonly CountRow[]; more?: { to: string; label: string } }>();

const fmt = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
/** A zero that PRINTS as a zero. A rate of nothing has `value` 0 and `display` "—": that is an unknown. */
const quiet = (r: CountRow) => r.value === 0 && (r.display ?? "0") !== "—";
</script>

<template>
  <ul class="divide-y divide-edge-subtle">
    <template v-for="r in rows" :key="r.key">
      <li v-if="quiet(r)" class="flex items-center gap-2 py-2 first:pt-0 last:pb-0" data-quiet>
        <span class="min-w-0 flex-1 truncate text-sm text-ink-secondary" :title="r.label">{{ r.label }}</span>
        <span class="text-sm font-medium tabular-nums text-ink-tertiary" :data-test="`count-${r.key}`">{{ r.display ?? fmt(r.value) }}</span>
        <!-- The door stays (D-FM9: every figure is a door), as its arrow; the words are for a screen reader. -->
        <DoorLink v-if="r.to" :to="r.to"><span class="sr-only">{{ r.door ?? "Open" }}: {{ r.label }}</span></DoorLink>
      </li>
      <li v-else class="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 py-3 first:pt-0 last:pb-0">
        <span class="text-sm font-medium text-ink">{{ r.label }}</span>
        <span
          class="text-lg font-bold tabular-nums"
          :class="r.alarm && (r.value ?? 0) > 0 ? 'text-danger-text' : 'text-ink'"
          :data-test="`count-${r.key}`"
        >{{ r.display ?? fmt(r.value) }}</span>
        <span
          v-if="r.caption || r.to"
          class="col-span-2 flex flex-wrap items-center justify-between gap-x-2 text-xs text-ink-tertiary"
        >
          <span>{{ r.caption }}</span>
          <DoorLink v-if="r.to" :to="r.to">{{ r.door ?? "Open" }}</DoorLink>
        </span>
      </li>
    </template>
  </ul>
  <div v-if="more" class="mt-3 flex justify-end border-t border-edge-subtle pt-3">
    <DoorLink :to="more.to">{{ more.label }}</DoorLink>
  </div>
</template>
