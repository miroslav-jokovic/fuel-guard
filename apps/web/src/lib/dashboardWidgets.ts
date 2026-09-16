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
import LiveMapWorkspace from "@/features/livemap/LiveMapWorkspace.vue";

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
   * ── D-DR24: THE WORKSPACE, NOT THE CARD ─────────────────────────────────────────────────────────
   * D-DW5 had two shapes of one board — `LiveMapWorkspace` at `/live-map` and `LiveMapPanel` here,
   * "the tab is the glance and the page is the work". The owner ruled them into one on 2026-09-16
   * and kept THIS surface, so the work shape is what the tab renders and `LiveMapPanel.vue` is
   * deleted rather than left unreferenced.
   *
   * ⚠ It is catalogued `span: "workspace"`, so `TabWidgets` renders it without a card and the route
   * drops the shell's gutters. Putting a floating-panel workspace inside a dashboard grid cell is
   * exactly what DR5 refused, and this is the other resolution of that: the cell is gone.
   */
  "dispatch.live-map": LiveMapWorkspace,
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
