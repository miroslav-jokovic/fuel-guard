/**
 * The web half of the widget catalogue: which component draws each widget (LM9, D-DW1).
 *
 * ── WHY THE SPLIT, AND WHY THIS EXACT SHAPE ──────────────────────────────────────────────────────
 * `DASHBOARD_WIDGETS` lives in `packages/shared` because a gate is a permission fact that the API and
 * the permissions preview must be able to read. Components cannot follow it there: shared depends on
 * `zod` alone and is compiled for React Native for `apps/driver`, so importing `.vue` files into it
 * would break that build. This is the same split `lib/navIcons.ts` already makes for surface icons,
 * for the same reason — and like that file it is NOT a second home for a permission. `lint:surfaces`
 * asserts these keys are exactly the catalogue's, in both directions, so the split cannot drift.
 *
 * ── ⚠ AND WHY IT IS IN `lib/` RATHER THAN IN `features/dashboard/` ───────────────────────────────
 * Because a widget may come from ANY feature, and the live map does. `check-feature-boundaries.mjs`
 * refuses `features/dashboard → features/livemap`, and `WEB_ALLOW` is deliberately empty with a
 * comment recording that the intended fix is always to promote the shared thing OUT of `features/`
 * rather than to allow-list the leak. A registry outside `features/` is that promotion: it is the
 * composition root for the Dashboard, exactly as a page is for a route, so it may name any feature's
 * top-level surface without any feature reaching into another.
 *
 * Every widget is loaded EAGERLY. They are small, the heaviest of them (`LiveMapPanel`) already
 * splits its own maplibre chunk through `useMapLibre`, and a lazy component inside a grid that is
 * itself conditional on a gate would add a second reason for a blank square — which is the one thing
 * a dashboard must never have.
 */
import type { Component } from "vue";
import FeedFreshnessWidget from "@/features/dashboard/widgets/FeedFreshnessWidget.vue";
import KpiHeroWidget from "@/features/dashboard/widgets/KpiHeroWidget.vue";
import OperatingMetricsWidget from "@/features/dashboard/widgets/OperatingMetricsWidget.vue";
import SpendTrendWidget from "@/features/dashboard/widgets/SpendTrendWidget.vue";
import MpgTrendWidget from "@/features/dashboard/widgets/MpgTrendWidget.vue";
import CostCompositionWidget from "@/features/dashboard/widgets/CostCompositionWidget.vue";
import SeverityWidget from "@/features/dashboard/widgets/SeverityWidget.vue";
import TopVehiclesWidget from "@/features/dashboard/widgets/TopVehiclesWidget.vue";
import TopDriversWidget from "@/features/dashboard/widgets/TopDriversWidget.vue";
import LiveMapPanel from "@/features/livemap/LiveMapPanel.vue";

export const WIDGET_COMPONENTS: Record<string, Component> = {
  "fleet.feed-freshness": FeedFreshnessWidget,
  "fleet.kpi-hero": KpiHeroWidget,
  "fleet.operating-metrics": OperatingMetricsWidget,
  "fleet.spend-trend": SpendTrendWidget,
  "fleet.mpg-trend": MpgTrendWidget,
  "fleet.cost-composition": CostCompositionWidget,
  "fleet.severity": SeverityWidget,
  "fleet.top-vehicles": TopVehiclesWidget,
  "fleet.top-drivers": TopDriversWidget,
  /**
   * D-DW5 — the same panel `/live-map` renders, embedded rather than reimplemented. The tab is the
   * glance and the page is the work surface; neither substitutes for the other, and a second
   * "dashboard version" of the map would be a second thing to keep correct.
   *
   * It replaces a placeholder card that read "Not connected yet — vehicle positions are still being
   * wired up to the Samsara feed", which had been false since LM8 merged.
   */
  "dispatch.live-map": LiveMapPanel,
};

/** Widgets that need the page's date range. The live map is live — it has no window to scope. */
export const WIDGETS_TAKING_RANGE = new Set([
  "fleet.kpi-hero",
  "fleet.operating-metrics",
  "fleet.spend-trend",
  "fleet.mpg-trend",
  "fleet.cost-composition",
  "fleet.severity",
  "fleet.top-vehicles",
  "fleet.top-drivers",
]);
