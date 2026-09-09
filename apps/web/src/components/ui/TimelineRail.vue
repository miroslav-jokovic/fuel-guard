<script setup lang="ts">
/**
 * A vertical rail of dated entries (D-DS18; INVENTORY-PLAN.md I8 promotes it).
 *
 * Named for what it OWNS rather than for what it shows, which is also what `vue/multi-word-component-names`
 * required: it is the rail, and the entries on it belong to whoever fills the slot.
 *
 * ── WHY IT IS SHARED NOW AND WAS NOT BEFORE ────────────────────────────────────────────────────
 * D-DS18 is explicit: a primitive with one consumer is a primitive whose API was designed by
 * guessing, so the near-miss timeline shipped inside `features/anomalies/` and promotion waited for
 * a second consumer to be the evidence for the shape. The second consumer is an asset's movement
 * history, and comparing the two is what decided every prop below — what they SHARE is the rail,
 * the ordering, the collapse and the marker; what they do not share is every word of content.
 *
 * So this component owns exactly that and renders none of it: the caller fills `#entry`. A version
 * that had tried to own a headline, a delta and an actor would have fitted one consumer and been
 * bypassed by the other within a week — which is the failure D-DS18 describes.
 *
 * ── AN EMPTY RAIL IS FURNITURE THAT REPORTS A FINDING ──────────────────────────────────────────
 * Zero entries renders NOTHING, carried over from `CaseTimeline`'s own rule. A rail with no dots
 * reads as "something should be here and is missing". A caller with something to say about the
 * emptiness says it itself, which is what the asset detail does and the near-miss panel does not.
 *
 * ⚠ It is a timeline BECAUSE it is short, unfiltered and about one entity. The `*History*` and
 * `ChangeLog` surfaces elsewhere are filterable `DataTable`s and are correct as tables
 * (UI-GAPS-PLAN §0). Do not convert them, and do not grow filters here.
 */
import { computed, ref } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";

export interface TimelineEntry {
  /** Stable across renders — the row's own id where there is one. */
  key: string;
  /** ISO instant. Decides the order, and the day header when one is asked for. */
  at: string;
  /** Marker classes from `@/lib/badges`. Omitted leaves the neutral dot. */
  marker?: string;
}

const props = withDefaults(
  defineProps<{
    entries: TimelineEntry[];
    /**
     * Above this many the list collapses behind a "Show all" button. Zero never collapses — the
     * asset history is paginated by the API, so its page IS the answer and hiding half of it behind
     * a second click would make the pager lie about what is on screen.
     */
    collapseAfter?: number;
    /**
     * Group into sticky day headers. Off for a short causal narrative about one entity, on for a
     * history long enough that "when did this happen" needs answering while scrolling.
     */
    groupByDay?: boolean;
    /** Newest first everywhere in this product; `oldest` exists for a narrative read forwards. */
    order?: "newest" | "oldest";
  }>(),
  { collapseAfter: 0, groupByDay: false, order: "newest" },
);

/**
 * Sorted HERE rather than trusting the payload's order.
 *
 * `CaseTimeline` made this choice first and the reasoning generalises: a list whose order is the
 * server's is a list an upstream change can silently reverse, and every list in this product is
 * newest-first.
 */
const ordered = computed(() => {
  const rows = [...props.entries].sort((a, b) => a.at.localeCompare(b.at));
  return props.order === "newest" ? rows.reverse() : rows;
});

const expanded = ref(false);
const collapsible = computed(() => props.collapseAfter > 0 && ordered.value.length > props.collapseAfter);
const visible = computed(() =>
  collapsible.value && !expanded.value ? ordered.value.slice(0, props.collapseAfter) : ordered.value,
);

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

/**
 * One section per day when asked, otherwise one unlabelled section holding everything.
 *
 * Grouping on the rendered LABEL rather than on a sliced ISO date, because the label is what the
 * reader compares: a date sliced off the ISO string is UTC, so two movements either side of
 * midnight local time would land under different headers than the timestamps beside them say.
 */
const sections = computed(() => {
  if (!props.groupByDay) return [{ label: null as string | null, entries: visible.value }];
  const out: Array<{ label: string; entries: TimelineEntry[] }> = [];
  for (const entry of visible.value) {
    const label = dayLabel(entry.at);
    const last = out[out.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else out.push({ label, entries: [entry] });
  }
  return out;
});
</script>

<template>
  <div v-if="ordered.length">
    <div v-for="(section, i) in sections" :key="section.label ?? i">
      <p
        v-if="section.label"
        class="sticky top-0 z-sticky bg-surface py-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted"
      >
        {{ section.label }}
      </p>
      <ol class="relative space-y-2 pl-4" :class="section.label ? 'pb-2' : ''">
        <!-- The rail. Decorative: the <ol> already carries the sequence for a screen reader. -->
        <span class="absolute top-1 bottom-1 left-1 w-px bg-edge" aria-hidden="true" />
        <li v-for="entry in section.entries" :key="entry.key" class="relative">
          <span
            class="absolute top-1 -left-3.5 size-2 rounded-full ring-2 ring-surface"
            :class="entry.marker ?? 'bg-edge-strong'"
            aria-hidden="true"
          />
          <slot name="entry" :entry="entry" />
        </li>
      </ol>
    </div>

    <BaseButton v-if="collapsible" variant="ghost" size="sm" class="mt-2" @click="expanded = !expanded">
      {{ expanded ? "Show fewer" : `Show all ${ordered.length}` }}
    </BaseButton>
  </div>
</template>
