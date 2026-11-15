<script setup lang="ts">
/**
 * Roadside inspections — how are our trucks doing at the scale and the roadside? (FLEET-MANAGER-HOME-PLAN §4
 * card 10, FM5; rebuilt for INSPECTION-CHALLENGE-PLAN IC16, owner 2026-10-19).
 *
 * ── OVER THE PAGE'S RANGE ──────────────────────────────────────────────────────────────────────
 * Until 2026-10-19 the card counted a fixed 90 days under a page whose range picker said 30 (it showed 111
 * inspections where the page's 30 days held 32). It now takes the Operations tab's range like the fleet cards
 * (`WIDGETS_TAKING_RANGE`), and the server cuts it on the carrier's calendar.
 *
 * ── EVERY FIGURE IS A LIST ─────────────────────────────────────────────────────────────────────
 * `GET /api/roadside-inspections/summary` answers `roadsideStats` over the range; each row's door opens the
 * Roadside inspections list on that range with the same predicate (D-FM7, D-FM9): `clean=1`, `oos=` with
 * `insp=` (the rate's own denominator — SMS's Vehicle or Driver Inspection), `view=needs`, `category=`.
 * The rates are FMCSA's (`roadsideStats.ts`); a rate of no inspections is a dash, never 0% or 100% (US6b F14).
 * Q-FM8 (a), owner 2026-10-19: clean is no violations at all.
 */
import { computed } from "vue";
import { RoadIcon } from "@silvicom/ui/icons";
import type { DayWindow } from "@silvicom/shared";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList from "@/components/ui/CountList.vue";
import { formatDateRange } from "@/lib/format";
import { useRoadsideRows } from "./useRoadsideRows";
import { roadsideFeedSentence } from "./feedFreshness";
import { useOrgTimezone } from "@/composables/useOrgTimezone";

const props = defineProps<{ range: DayWindow }>();
const { summary, isError, rows } = useRoadsideRows(computed(() => props.range));
const { zone } = useOrgTimezone();
// How current the record behind these figures is (IC1c): a figure from a feed that stopped is still shown —
// it is the last good record — but never without saying so.
const freshness = computed(() => (summary.value ? roadsideFeedSentence(summary.value.feed, zone.value) : null));
const subtitle = computed(() => `FMCSA's record, ${formatDateRange(props.range.from, props.range.to)}`);
</script>

<template>
  <ChartCard title="Roadside inspections" :subtitle="subtitle" :icon="RoadIcon" tone="warning" class="h-full">
    <!-- ui-adoption: server-message — the card's own sentence; a failed read draws dashes, never zeros. -->
    <p v-if="isError" class="mb-3 text-sm text-danger-700" data-test="roadside-error">Could not load the roadside inspections.</p>
    <CountList :rows="rows" />
    <p v-if="freshness" class="mt-3 text-xs" :class="freshness.late ? 'text-caution-700' : 'text-ink-tertiary'" data-test="feed">{{ freshness.text }}</p>
  </ChartCard>
</template>
