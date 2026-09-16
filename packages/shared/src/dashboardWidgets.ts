/**
 * The Dashboard's widgets, and which of them a caller may see
 * (`docs/plans/livemap/LIVE-MAP-PLAN.md` LM9, D-DW1).
 *
 * ── IT LIVES BESIDE `SURFACES` AND REUSES ITS GATE VERBATIM ──────────────────────────────────────
 * `SurfaceGate` and `surfaceGateAllows` are imported, never re-implemented. A widget is therefore
 * gated by exactly the mechanism a sidebar entry and a route guard already are, which buys the three
 * properties D-DW1 was protecting: an org that grants `dispatch` to its safety manager gets the
 * dispatch widgets with no code change, the permissions preview page keeps telling the truth about
 * what a role sees, and an admin sees everything by PASSING every gate rather than by being named.
 *
 * ⚠ There is no `UserRole` in any gate here, and that is the rule this file exists to hold. The root
 * `CLAUDE.md` carries the worked example of what a `session.role ===` branch costs — one global
 * boolean standing in for a section × role matrix the database already models correctly. `defaultFor`
 * names roles and is the sole exception, for the reason given on it.
 *
 * ── A WIDGET IS A CARD, NOT A TILE (ruled 2026-09-15) ────────────────────────────────────────────
 * LM9's text says "every tile and chart becomes a widget". Read literally that is fifteen entries on
 * the fleet tab alone, four of which are cells inside one four-column grid — and a grid with one cell
 * hidden is still a grid. D-DW3's promise is that a user may REORDER AND HIDE their widgets, which
 * only means something at the grain a user could actually move: the card. So the nine cards below are
 * the widgets, and the finer per-tile question — which of them show money — is answered where it was
 * already being answered correctly, by `applyMoneyGate` inside the strips.
 *
 * ── `tab` IS A STRING AND IS CHECKED BY A GATE, NOT BY THE TYPE ──────────────────────────────────
 * The tab catalogue lives web-side (`apps/web/src/features/dashboard/dashboardTabs.ts`, LM-T) because
 * nothing else needed it yet, so this package cannot import it without inverting that dependency.
 * `check-surfaces.mjs` asserts every `tab` here names a real tab there, in both directions — the same
 * bargain `navIcons.ts` already strikes for surface icons, and for the same reason: the split is
 * forced by the package graph, so the drift it invites is machine-checked instead.
 */
import type { ModuleKey } from "./entitlements.js";
import type { UserRole } from "./constants.js";
import type { SurfaceGate } from "./surfaces.js";
import { section } from "./surfaces.js";

export interface DashboardWidget {
  /**
   * Stable and STORABLE. LM10 writes a per-user layout as an array of these keys, so renaming one
   * orphans a stored layout rather than migrating it — exactly as a surface key does for a grant.
   */
  key: string;
  /** For the layout editor and the permissions preview. Not necessarily rendered by the widget. */
  label: string;
  /** Which tab it renders under — a key in the web app's `DASHBOARD_TABS`. */
  tab: string;
  gate: SurfaceGate;
  /** AND-ed with the gate, for a widget that needs a module the org may not have bought. */
  module?: ModuleKey;
  /**
   * How much of the row it takes. `half` pairs with its neighbour on a wide screen; `full` spans.
   *
   * ⚠ It is LAYOUT in a permissions catalogue, which is a compromise and is worth naming as one. The
   * alternative was a second web-side map keyed by widget — a third home for a fact about a widget,
   * after the gate here and the component there — and this repo's register is explicit that a copy
   * with a delay fuse is the worse trade. It also has to live wherever LM10's per-user layout can
   * read it, and that is here.
   *
   * The values below are transcribed from the grids the fleet tab renders TODAY: the two trend
   * charts pair, the donut pairs with severity, the two risk lists pair, and the three strips span.
   */
  span: "full" | "half";
  /**
   * Roles whose DEFAULT layout includes this widget (D-DW2), for LM10.
   *
   * ⚠ A role list, and the only one permitted in this file. It decides what a caller sees BEFORE
   * they have arranged anything — never what they MAY see, which is `gate` above and is always a
   * section. A wrong default shows somebody a widget they were already allowed; it cannot leak.
   * Absent means "in every default layout for anyone whose gate passes".
   */
  defaultFor?: readonly UserRole[];
}

/**
 * Array order IS render order within a tab.
 *
 * ⚠ **Every gate below is the gate the element ALREADY HAD on 2026-09-15, transcribed.** LM9 is a
 * refactor and its Done-when is that no role's dashboard changes; `dashboardEquivalence.test.ts` is
 * the proof, captured against the pre-catalogue tree. So:
 *
 *   · everything on the fleet tab inherits `fuel`, because that is the tab's own gate and nothing
 *     inside it was separately gated;
 *   · the two money charts carry `accounting`, which is what they were given when LM-F's leaks were
 *     closed — they are the only elements on this tab with a gate of their own;
 *   · nothing is TIGHTENED. `severity` and the two risk lists are arguably safety-shaped, and that is
 *     a product question for another day rather than a change to smuggle into a refactor.
 */
export const DASHBOARD_WIDGETS: readonly DashboardWidget[] = [
  // ── fleet overview ────────────────────────────────────────────────────────────────────────────
  { span: "full" as const, key: "fleet.feed-freshness", label: "Telematics freshness", tab: "fleet", gate: section("fuel") },
  { span: "full" as const, key: "fleet.kpi-hero", label: "Headline figures", tab: "fleet", gate: section("fuel") },
  { span: "full" as const, key: "fleet.operating-metrics", label: "Operating metrics", tab: "fleet", gate: section("fuel") },
  { span: "half" as const, key: "fleet.spend-trend", label: "Fuel spend trend", tab: "fleet", gate: section("accounting") },
  { span: "half" as const, key: "fleet.mpg-trend", label: "Fleet MPG trend", tab: "fleet", gate: section("fuel") },
  { span: "half" as const, key: "fleet.cost-composition", label: "Where fuel dollars go", tab: "fleet", gate: section("accounting") },
  { span: "half" as const, key: "fleet.severity", label: "Open cases by severity", tab: "fleet", gate: section("fuel") },
  { span: "half" as const, key: "fleet.top-vehicles", label: "Top vehicles by risk", tab: "fleet", gate: section("fuel") },
  { span: "half" as const, key: "fleet.top-drivers", label: "Top drivers by risk", tab: "fleet", gate: section("fuel") },

  // ── dispatch ──────────────────────────────────────────────────────────────────────────────────
  /**
   * D-DW5 — the live map is both a widget and a full page, and neither substitutes for the other: a
   * dispatcher works a map full-screen at `/live-map`, a fleet manager glances at one here.
   *
   * `module: "dispatch"` matches the endpoint behind it (`requireModule("dispatch")`), so a tenant
   * without the module gets no widget rather than a panel that 403s.
   */
  { span: "full" as const, key: "dispatch.live-map", label: "Live map", tab: "dispatch", gate: section("dispatch"), module: "dispatch", defaultFor: ["dispatcher"] },
];

/** Every widget on one tab that this caller's gates admit, in catalogue order. */
export function widgetsForTab(
  tab: string,
  allows: (w: DashboardWidget) => boolean,
): DashboardWidget[] {
  return DASHBOARD_WIDGETS.filter((w) => w.tab === tab && allows(w));
}
