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
 * Local to `features/anomalies/` by D-DS18: one consumer does not get to design a shared API, and
 * `lint:ui-adoption` fails a `@silvicom/ui` barrel export that nothing calls. It is promoted when a
 * second consumer exists and can argue for the shape.
 */
import { computed, ref } from "vue";
import { formatRuleId } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
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
 * Newest first, sorted here rather than trusting the payload's order.
 *
 * ⚠ The plan said "renders in `fueledAt` order" without fixing a direction. Descending is the choice:
 * this panel is context for a case being reviewed NOW, the most recent near miss is the most
 * probative, and every other list in the product is newest-first. Sorting locally also means an
 * upstream change to `analyzeFills`'s ordering cannot silently reverse the display.
 */
const ordered = computed(() =>
  [...props.entries].sort((a, b) => b.fueledAt.localeCompare(a.fueledAt)),
);
const expanded = ref(false);
const collapsible = computed(() => ordered.value.length > COLLAPSE_AFTER);
const visible = computed(() =>
  collapsible.value && !expanded.value ? ordered.value.slice(0, COLLAPSE_AFTER) : ordered.value,
);
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
  <div v-if="ordered.length" class="rounded-control bg-surface-subtle px-3 py-2">
    <div class="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span class="font-semibold text-ink-secondary">Near-miss timeline</span>
      <span class="text-2xs text-ink-tertiary">
        Fills that stayed clear while scoring ≥ {{ threshold }}
        <template v-if="truncated">· most recent {{ entries.length }} of {{ total }}</template>
      </span>
    </div>

    <ol class="relative space-y-2 pl-4">
      <!-- The rail. Decorative: the <ol> already carries the sequence for a screen reader. -->
      <span class="absolute top-1 bottom-1 left-1 w-px bg-edge" aria-hidden="true" />
      <li v-for="e in visible" :key="e.fueledAt + e.score" class="relative">
        <span
          class="absolute top-1 -left-3.5 size-2 rounded-full ring-2 ring-surface"
          :class="nearMissMarker(e.score)"
          aria-hidden="true"
        />
        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span class="font-medium text-ink">{{ fmt(e.fueledAt) }}</span>
          <span class="text-ink-tertiary">scored {{ e.score }}</span>
        </div>
        <p v-if="e.signals.length" class="text-ink-muted">
          <span v-for="(sig, i) in e.signals" :key="sig"
            ><span v-if="i > 0">, </span>{{ formatRuleId(sig) }}</span
          >
        </p>
      </li>
    </ol>

    <BaseButton
      v-if="collapsible"
      variant="ghost"
      size="sm"
      class="mt-2"
      @click="expanded = !expanded"
    >
      {{ expanded ? "Show fewer" : `Show all ${ordered.length}` }}
    </BaseButton>
  </div>
</template>
