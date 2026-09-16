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
   *
   * ── `workspace` IS NOT A THIRD WIDTH, IT IS THE ABSENCE OF A GRID (D-DR24) ──────────────────────
   * A `workspace` widget IS its tab: no card around it, no gutters, no neighbours, and the height of
   * the viewport under the tab strip. The live map is the one, and it earned it by being the only
   * widget on its tab that a person stares at for an hour rather than glances at.
   *
   * ⚠ It is declared HERE rather than at the render site because the layout of a tab must be
   * answerable without mounting it: the route reads this to decide whether the shell drops its
   * gutters (`isFullBleed`), and `TabWidgets` reads it to decide whether to draw a grid at all. A
   * boolean in the web app would have been the copy with the delay fuse this comment already warns
   * about one paragraph up.
   *
   * ⚠ A workspace widget is NOT arrangeable and offers no Customize control: there is nothing to
   * pair it with and hiding it would leave a tab that cannot be restored.
   */
  span: "full" | "half" | "workspace";
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
   * ── D-DR24 OVERRULES D-DW5: THERE IS ONE LIVE MAP AND THIS IS IT ────────────────────────────────
   * D-DW5 said the map was "both a widget and a full page, and neither substitutes for the other" —
   * a dispatcher worked one full-screen at `/live-map`, a fleet manager glanced at one here. Owner's
   * ruling, 2026-09-16: `/live-map` goes and the Dispatch tab is the survivor. Two surfaces onto one
   * board meant two shapes to keep honest, two places to fix a defect, and a sidebar entry competing
   * with a tab for the same job — and the glance was the weaker half, because nobody glances at a
   * map: they look for a truck, which is work.
   *
   * So this is `workspace` and not `full`. The card-in-a-grid reading (`LiveMapPanel.vue`) is gone
   * rather than kept beside it; the workspace shape is what a dispatcher had at `/live-map` and it
   * now fills the tab.
   *
   * ⚠ `defaultFor: ["dispatcher"]` WENT WITH THE CARD, and dropping it is part of the ruling rather
   * than tidying. It meant "the dispatcher sees the live map first, an admin adds it if they want
   * it" — a sensible thing to say about one card among nine, and an absurd one to say about a tab
   * whose only content is that surface: an admin opening Dispatch got an empty state offering a
   * Customize button whose entire menu was the thing they had come for. A workspace is not
   * arrangeable (see `span`), so a default layout has nothing left to decide here.
   *
   * `module: "dispatch"` matches the endpoint behind it (`requireModule("dispatch")`), so a tenant
   * without the module gets no widget rather than a panel that 403s.
   */
  { span: "workspace" as const, key: "dispatch.live-map", label: "Live map", tab: "dispatch", gate: section("dispatch"), module: "dispatch" },
];

/**
 * Is this tab a WORKSPACE rather than a grid of cards (D-DR24)?
 *
 * ⚠ Deliberately asked of the CATALOGUE and not of a mounted component, because the two readers are
 * in different processes' worth of the app: the router asks it to decide whether the shell drops its
 * gutters before the page exists, and `TabWidgets` asks it to decide whether to draw a grid. A
 * second answer anywhere would be a tab that is full-bleed in the shell and a card on the page.
 *
 * ⚠ It ignores gates on purpose. A caller who fails the map's gate still gets the workspace SHAPE
 * for the Dispatch tab and then the "nothing to show here" panel inside it — which is right: the
 * shape of a tab is a property of the product, and what is on it is a property of the person.
 */
export function tabIsWorkspace(tab: string): boolean {
  return DASHBOARD_WIDGETS.some((w) => w.tab === tab && w.span === "workspace");
}

/** Every widget on one tab that this caller's gates admit, in catalogue order. */
export function widgetsForTab(
  tab: string,
  allows: (w: DashboardWidget) => boolean,
): DashboardWidget[] {
  return DASHBOARD_WIDGETS.filter((w) => w.tab === tab && allows(w));
}
