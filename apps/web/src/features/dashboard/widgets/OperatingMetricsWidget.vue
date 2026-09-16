<script setup lang="ts">
/**
 * The compact scan strip: the five measured figures, then what the checks made of them, then the
 * trust line. Secondary measures share one strip rather than competing as hero cards.
 *
 * The ledger tiles sit AFTER the five and not among them, because they answer a different kind of
 * question: the first five are what the fleet did, and these two are what somebody still has to do
 * about it. They are also the only tiles here that can be absent for a caller (C9's per-row gate),
 * so keeping them at the end means the strip does not reflow around a hole.
 *
 * ── DR7a: WHY THIS IS STILL A STRIP AND NOT EIGHT `StatCard`s ─────────────────────────────────────
 * Tempting, and deliberately not done. Every tile below is already shaped like `StatCard`'s props —
 * `moneyGate.ts`'s `MoneyGateable` says so in as many words — so binding the strip to the primitive
 * would compile. It would also overturn the first paragraph of this comment: `StatCard` renders an
 * elevated card each, and eight of those directly beneath `KpiHeroWidget`'s four `text-3xl` tiles is
 * precisely the "competing as hero cards" this widget exists to avoid. The anatomy DR2 settled is
 * rolled ONTO the strip below instead — the chip, the KPI weight — deriving each detail from
 * `StatCard` rather than restating it. Whether the strip archetype survives the refresh at all is a
 * question for the owner, recorded in DESIGN-REFRESH-2026-09.md §7, not one this step answers.
 */
import { computed } from "vue";
import { RouterLink } from "vue-router";
import {
  CurrencyDollarIcon, GallonsIcon, GaugeIcon, InvoiceIcon, RadarIcon,
  ReeferTruckIcon, RejectionIcon, RoadIcon,
} from "@silvicom/ui/icons";
import { AppCard as BaseCard, AppIcon } from "@silvicom/ui";
import { useFuelRangeTotals, type FuelFilters } from "@/composables/useFuelLog";
import { fuelTileDestinations } from "@/composables/dashboardFuelLinks";
import { useFindingsSummaryQuery, ledgerTiles } from "@/composables/useFindingsSummary";
import { applyMoneyGate } from "../moneyGate";
import { useFleetWidgetData, fmtInt, type FleetRange } from "../fleetWidgetData";
import { fmtMoney, fmtCompact } from "@/lib/chartTheme";

const props = defineProps<{ range: FleetRange }>();
const range = computed(() => props.range);
const { s, isLoading, canSeeMoney, mpgTotal, mpgSub, mpgTitle, rangeLabel } = useFleetWidgetData(range);

// The same UTC bounds `useDashboard` uses, so the fill count and miles cover exactly the fills
// behind the spend/gallons/MPG figures taken from the summary — the whole row stays consistent.
const fuelRange = computed<FuelFilters>(() => ({
  from: new Date(`${range.value.from}T00:00:00`).toISOString(),
  to: new Date(`${range.value.to}T23:59:59.999`).toISOString(),
}));
const { data: fuelTotals, isLoading: fuelLoading } = useFuelRangeTotals(fuelRange);
const { data: findings } = useFindingsSummaryQuery();

const ledgerStats = computed(() =>
  ledgerTiles(findings.value, { open: InvoiceIcon, money: CurrencyDollarIcon },
    { int: fmtInt, compact: fmtCompact, money: fmtMoney }),
);

const fuelingStats = computed(() => {
  const t = fuelTotals.value;
  const d = s.value;
  // Destinations live in `dashboardFuelLinks` — pure, and TOTAL over the strip's labels, so a tile
  // added here without a destination is a compiler error.
  const to = fuelTileDestinations(range.value);
  return [
    { label: "Fill-ups", value: t ? fmtInt(t.fillUps) : "—", sub: "in selected range", icon: InvoiceIcon, tone: "text-brand-600 bg-brand-50", to: to["Fill-ups"] },
    { label: "Gallons", value: d ? fmtInt(d.totalGallons) : "—", sub: "total fuel", icon: GallonsIcon, tone: "text-info-600 bg-info-50", to: to.Gallons },
    { label: "Miles driven", value: t ? fmtInt(t.totalMiles) : "—", sub: "odometer span in range", icon: RoadIcon, tone: "text-success-600 bg-success-50", to: to["Miles driven"] },
    { label: "Fuel spend", money: true as const, value: d ? `$${fmtCompact(d.totalSpend)}` : "—", valueTitle: d ? fmtMoney(d.totalSpend) : undefined, sub: "total cost", icon: CurrencyDollarIcon, tone: "text-success-600 bg-success-50", to: to["Fuel spend"] },
    { label: "Avg MPG", value: mpgTotal.value?.mpg != null ? mpgTotal.value.mpg.toFixed(1) : "—", valueTitle: mpgTitle.value, sub: mpgSub.value, icon: GaugeIcon, tone: "text-brand-600 bg-brand-50", to: to["Avg MPG"] },
  ];
});

const trust = computed(() => [
  {
    label: "Telematics coverage",
    value: s.value?.coveragePct != null ? `${s.value.coveragePct}%` : "—",
    // D-SAM7. The big number is the window the reader picked; the subtitle is the whole history, and
    // the pair is the point. Over 90 days this reads ~95% and looks healthy; against the carrier's
    // entire history on 2026-09-01 it was 23%, because 76.8% of fills had never had telematics
    // fetched at all. Showing only the first turned an unanswered question into a reassuring answer.
    sub: s.value?.allTimeCoveragePct != null ? `${s.value.allTimeCoveragePct}% all time` : "fills corroborated",
    icon: RadarIcon, tone: "text-info-600 bg-info-50", to: "/coverage",
  },
  {
    label: "Reefer fuel", money: true as const,
    value: s.value ? `$${fmtCompact(s.value.reeferSpend)}` : "—",
    valueTitle: s.value ? fmtMoney(s.value.reeferSpend) : undefined,
    sub: "refrigerated tank", icon: ReeferTruckIcon, tone: "text-info-600 bg-info-50", to: "/reefer-coverage",
  },
  {
    label: "Declined attempts",
    value: s.value ? String(s.value.declinedCount) : "—",
    sub: "blocked at the pump", icon: RejectionIcon,
    tone: (s.value?.declinedCount ?? 0) > 0 ? "text-caution-700 bg-caution-50" : "text-ink-muted bg-surface-muted",
    // FUEL-C2: the declines are a TAB of the Fuel Log now. `/rejections` still redirects and always
    // will, but a tile should name where the thing lives rather than lean on the compatibility path.
    to: "/fuel-log?tab=declines",
  },
]);

const metricStrip = computed(() =>
  applyMoneyGate([...fuelingStats.value, ...ledgerStats.value, ...trust.value], canSeeMoney.value),
);
</script>

<template>
  <BaseCard padding="none" as="section">
    <div class="border-b border-edge-subtle px-4 py-3">
      <h2 class="text-sm font-semibold text-ink">Operating metrics · {{ rangeLabel }}</h2>
    </div>
    <!--
      ⚠ `xl:grid-cols-8` WAS HERE AND NEVER FITTED AT ANY WIDTH IT EXISTED AT (DR7a, measured
      2026-09-16). Eight columns turn on at 1280px, which is also their worst case: the cell is 116px
      there, and "Telematics coverage" ran 27px past it while "odometer span in range" ran 44px past.
      Widening did not rescue it — 1440px still clipped a label and three captions, and even 1512px,
      the widest laptop this is read on, left two captions short. `truncate` throws nothing and warns
      nothing, which is why the widget looked finished for as long as it did.

      ⚠⚠ THE COLUMN COUNTS BELOW ARE DERIVED FROM A MEASURED TILE WIDTH, NOT CHOSEN. The widest
      caption here ("odometer span in range") needs 128px; the chip and its gap take 48 and the cell
      padding 32, so a tile needs a 208px cell and the grid may only take a column count that leaves
      one. Measured after, at ten widths: 1-up from 390 to 700, 3-up at 768–1024 (235px and 224px
      cells), 4-up at 1280 and 1512 (232px and 290px). Nothing truncates at any of them.

      ⚠ The three-up starts at `md` and not `sm`, and that is the SECOND worst-case-at-its-own-
      breakpoint this widget has had: three columns at exactly 640px gives a 192px cell, 16px under
      what the caption needs, so `sm:grid-cols-3` clipped at the one width it switched on at and
      nowhere else. The same shape as the eight-up above it, found the same way, and the reason every
      breakpoint here was checked AT its boundary rather than in the middle of its range.

      ⚠⚠⚠ And a VIEWPORT rule is what nearly got this wrong for the third time in this programme
      (D-DR17, then `FilterBar` in DR5). The first pass here capped the grid at four columns full
      stop, which measured clean — until the chip below reserved its 48px and 1024px started clipping
      again. The two numbers that settle it: the four-up cell at a 1024px viewport is 168px and the
      two-up cell at a 390px viewport is 172px. Nearly the same tile at viewports 634px apart, so
      "narrow phone" and "roomy laptop" are the SAME layout problem here and any rule keyed on the
      window gets one of them backwards. Hence a phone stacks (1-up) and 1024 does not (3-up), which
      reads upside-down until those two numbers are in front of you.
    -->
    <dl class="grid grid-cols-1 divide-x divide-y divide-edge-subtle md:grid-cols-3 xl:grid-cols-4">
      <RouterLink
        v-for="stat in metricStrip"
        :key="stat.label"
        :to="stat.to"
        class="group flex min-w-0 items-start gap-3 px-4 py-3 hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring"
      >
        <div class="min-w-0 flex-1">
          <dt class="truncate text-xs font-medium text-ink-tertiary">{{ stat.label }}</dt>
          <!--
            `font-bold`, not the `font-semibold` this shipped with: DESIGN-SYSTEM-CONTRACT.md §2.3
            reserves bold for KPI numbers and gives headings semibold, and these are KPI numbers that
            were wearing the heading's weight. The identical correction D-DR2 made to `StatCard`'s
            hero value, for the identical reason.

            ⚠ The SIZE deliberately stays `text-lg` rather than following the contract's
            `text-2xl font-bold` pairing. That pairing describes a KPI row that leads a page; this
            strip is the secondary measures, sitting under four `text-3xl` hero tiles that are
            supposed to out-rank it. Taking the full KPI size here would flatten that order — the
            weight is what was wrong, not the scale.
          -->
          <dd class="mt-1 truncate text-lg font-bold tabular-nums text-ink" :title="stat.valueTitle">
            {{ isLoading || fuelLoading ? "—" : stat.value }}
          </dd>
          <dd class="truncate text-xs text-ink-tertiary">{{ stat.sub }}</dd>
        </div>
        <!--
          The chip every tile in this strip has always carried and none has ever drawn (DR7a). Each
          entry below already sets `icon` and `tone`, `applyMoneyGate` passes both through, and the
          template dropped them — `LedgerTile.icon` was typed `unknown`, so drawing one needed a cast
          and the missing cast read as intent.

          `size-9` / `size-5` / `rounded-surface` and the TRAILING position are copied from
          `StatCard`'s `size="kpi"` branch on purpose. D-DR2 moved the chip to the LEFT in the hero
          anatomy only; the KPI anatomy keeps it on the right, and these are KPI tiles. Two surfaces
          agreeing because one read the other beats two surfaces agreeing by coincidence.
        -->
        <span
          v-if="stat.icon"
          :class="['inline-flex size-9 shrink-0 items-center justify-center rounded-surface', stat.tone]"
          aria-hidden="true"
        >
          <AppIcon :icon="stat.icon" class="size-5" />
        </span>
      </RouterLink>
    </dl>
  </BaseCard>
</template>
