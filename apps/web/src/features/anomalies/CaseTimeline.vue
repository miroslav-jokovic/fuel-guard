<script setup lang="ts">
/**
 * The near-miss timeline (G3, UI-GAPS-PLAN.md).
 *
 * `entityRisk.ts` has been computing `nearThresholdTimeline` and the API has been returning it since
 * the Phase-2 pattern report shipped. Nothing rendered it. Every entry is a fill whose case stayed
 * CLEAR while scoring at or above NEAR_THRESHOLD_SCORE — the engine looked and decided not to raise
 * a case, which is exactly the history a reviewer holding a live case wants and exactly what a
 * filterable table serves badly.
 *
 * ⚠ It is a timeline BECAUSE it is short, unfiltered and about one entity. The six `*History*` and
 * `ChangeLog` surfaces elsewhere are filterable `DataTable`s and are correct as tables; §0 of the
 * plan says so explicitly. Do not convert them, and do not grow filters here.
 *
 * ── THE RAIL MOVED OUT; THE NEAR MISS STAYED (D-DS18, INVENTORY-PLAN.md I8) ────────────────────
 * This file owned a shared shape until an asset's movement history became the second consumer, at
 * which point D-DS18's own rule applied: the second consumer is the evidence for what the shared API
 * should be. `@/components/ui/TimelineRail.vue` now owns the rail, the ordering, the collapse and the
 * marker; everything below is what is genuinely about a near miss and about nothing else — the
 * threshold sentence, the truncation notice, the score and the signal labels. Behaviour is
 * unchanged, and `CaseTimeline.test.ts` is what says so.
 */
import { computed } from "vue";
import { formatRuleId } from "@silvicom/shared";
import TimelineRail, { type TimelineEntry } from "@/components/ui/TimelineRail.vue";
import { nearMissMarker } from "@/lib/badges";

export interface NearMiss {
  fueledAt: string;
  score: number;
  signals: string[];
}

const props = defineProps<{
  /** The window's near misses. The API sends them oldest-first; ordering here is this component's. */
  entries: NearMiss[];
  /**
   * How many near misses the window actually held. ⚠ Not `entries.length`: `entityRisk.ts` caps the
   * payload at the most recent 20 (`nearThreshold.slice(-20)`), so a busy truck reports more than it
   * sends. Rendering `entries.length` as the total would quietly under-report the pattern.
   */
  total: number;
  /** The score at or above which a clear fill counts as a near miss — from the API, never hardcoded. */
  threshold: number;
}>();

/** Above this many, the list collapses; a reviewer scanning a case should not scroll past a wall. */
const COLLAPSE_AFTER = 8;

/**
 * The rail's rows, and the near-miss facts hung off each by key.
 *
 * ⚠ The plan said "renders in `fueledAt` order" without fixing a direction. Descending is the choice
 * and it is `Timeline`'s default: this panel is context for a case being reviewed NOW, the most
 * recent near miss is the most probative, and every other list in the product is newest-first.
 */
const rows = computed<TimelineEntry[]>(() =>
  props.entries.map((e) => ({ key: e.fueledAt + e.score, at: e.fueledAt, marker: nearMissMarker(e.score) })),
);
const byKey = computed(() => new Map(props.entries.map((e) => [e.fueledAt + e.score, e])));
const anyEntries = computed(() => props.entries.length > 0);
/** True when the API truncated the window — worth saying out loud rather than implying a total. */
const truncated = computed(() => props.total > props.entries.length);

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
</script>

<template>
  <!-- An empty window renders nothing at all: an empty rail is furniture that reports a finding. -->
  <div v-if="anyEntries" class="rounded-control bg-surface-subtle px-3 py-2">
    <div class="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span class="font-semibold text-ink-secondary">Near-miss timeline</span>
      <span class="text-2xs text-ink-tertiary">
        Fills that stayed clear while scoring ≥ {{ threshold }}
        <template v-if="truncated">· most recent {{ entries.length }} of {{ total }}</template>
      </span>
    </div>

    <TimelineRail :entries="rows" :collapse-after="COLLAPSE_AFTER">
      <template #entry="{ entry }">
        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span class="font-medium text-ink">{{ fmt(entry.at) }}</span>
          <span class="text-ink-tertiary">scored {{ byKey.get(entry.key)?.score }}</span>
        </div>
        <p v-if="byKey.get(entry.key)?.signals.length" class="text-ink-muted">
          <span v-for="(sig, i) in byKey.get(entry.key)!.signals" :key="sig"
            ><span v-if="i > 0">, </span>{{ formatRuleId(sig) }}</span
          >
        </p>
      </template>
    </TimelineRail>
  </div>
</template>
