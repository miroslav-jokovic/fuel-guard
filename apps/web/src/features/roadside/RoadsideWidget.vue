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
import { VIOLATION_CATEGORY_NAMES, type DayWindow, type RoadsideRate } from "@silvicom/shared";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList, { type CountRow } from "@/components/ui/CountList.vue";
import { formatDateRange } from "@/lib/format";
import { useRoadsideSummaryQuery } from "./useRoadsideInspections";
import { roadsideFeedSentence } from "./feedFreshness";
import { useOrgTimezone } from "@/composables/useOrgTimezone";

const props = defineProps<{ range: DayWindow }>();
const { data: summary, isError } = useRoadsideSummaryQuery(computed(() => props.range));
const { zone } = useOrgTimezone();
// How current the record behind these figures is (IC1c): a figure from a feed that stopped is still shown —
// it is the last good record — but never without saying so.
const freshness = computed(() => (summary.value ? roadsideFeedSentence(summary.value.feed, zone.value) : null));

const list = (extra: Record<string, string> = {}) => {
  const q = new URLSearchParams({ view: "all", from: props.range.from, to: props.range.to, ...extra });
  return `/roadside-inspections?${q.toString()}`;
};
const pct = (r: RoadsideRate | undefined) => (r?.share == null ? "—" : `${Math.round(r.share * 100)}%`);
const ofCaption = (r: RoadsideRate | undefined, what: string) => (r ? `${r.count} of ${r.of} ${what}` : what);

const rows = computed<CountRow[]>(() => {
  const s = summary.value?.stats;
  const out: CountRow[] = [
    { key: "inspections", label: "Inspections", value: s?.inspections ?? null, caption: "on our FMCSA record", to: list(), door: "Inspections" },
    { key: "clean", label: "Clean", value: s?.clean.count ?? null, display: s ? pct(s.clean) : undefined, caption: ofCaption(s?.clean, "with no violation"), to: list({ clean: "1" }), door: "Clean" },
    {
      key: "vehicle-oos", label: "Vehicle out-of-service rate", value: s?.vehicleOos.count ?? null, display: s ? pct(s.vehicleOos) : undefined,
      caption: ofCaption(s?.vehicleOos, "vehicle inspections"), to: list({ oos: "vehicle", insp: "vehicle" }), door: "Vehicle OOS", alarm: true,
    },
    {
      key: "driver-oos", label: "Driver out-of-service rate", value: s?.driverOos.count ?? null, display: s ? pct(s.driverOos) : undefined,
      caption: ofCaption(s?.driverOos, "driver inspections"), to: list({ oos: "driver", insp: "driver" }), door: "Driver OOS", alarm: true,
    },
    { key: "hazmat-oos", label: "Hazmat out of service", value: s?.hazmatOos ?? null, caption: "inspections with a hazmat order", to: list({ oos: "hazmat" }), door: "Hazmat OOS", alarm: true },
    { key: "points", label: "CSA points added", value: s?.points ?? null, caption: "today's weight of these inspections, verified categories" },
    { key: "needs", label: "Needs action", value: s?.needsAction ?? null, caption: "a repair, a ticket or the driver left", to: list({ view: "needs" }), door: "Needs action", alarm: true },
  ];
  for (const c of s?.topCategories ?? []) {
    out.push({
      key: `category-${c.categoryId}`,
      label: VIOLATION_CATEGORY_NAMES[c.categoryId] ?? `Category ${c.categoryId}`,
      value: c.inspections,
      caption: "inspections with this violation",
      to: list({ category: String(c.categoryId) }),
      door: "Inspections",
    });
  }
  return out;
});
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
