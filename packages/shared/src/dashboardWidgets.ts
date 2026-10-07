/**
 * The Dashboard's widgets, and which of them a caller may see
 * (`docs/plans/livemap/LIVE-MAP-PLAN.md` LM9, D-DW1; Fleet overview v3 per
 * `docs/plans/design-system/FLEET-OVERVIEW-REDESIGN-PROPOSAL.md`, D-FO1..D-FO10).
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
 * ── A WIDGET IS A CARD, AND A CARD ANSWERS ONE QUESTION (D-FO2) ──────────────────────────────────
 * LM9's text says "every tile and chart becomes a widget"; the 2026-09-15 ruling made the CARD the
 * grain, because a card is what a user can actually move. Fleet overview v3 (2026-10-06) went one
 * step further: the nine cards that tab had were transcribed from the comps and drew fuel spend
 * four times, MPG three times and open cases three times (the proposal's §1.1 counts them), so the
 * six below each own one question — what did fuel cost, how efficiently, what needs me, what
 * happened in the range, where open cases concentrate, what is worth recovering — and every figure
 * on the tab appears exactly once (D-FO1). The finer per-tile question of who may see money is
 * still answered inside the card by `applyMoneyGate`, never by a second gate here.
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

/** The grid is twelve columns wide; a card takes this many of them (Q-FO3, ruled (b) 2026-10-06). */
export type WidgetSpan = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | "workspace";

export interface DashboardWidget {
  /**
   * Stable and STORABLE. LM10 writes a per-user layout as an array of these keys, so renaming one
   * orphans a stored layout rather than migrating it — exactly as a surface key does for a grant.
   * The v3 keys below orphaned every fleet-tab arrangement saved before 2026-10-06, on purpose
   * (Q-FO4, ruled (b)): `resolveDashboardLayout` shows the role default when a row names nothing
   * that still exists, and `TabWidgets` says so once, rather than guessing a one-to-many mapping.
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
   * Columns of twelve, or the whole tab.
   *
   * ⚠ It is LAYOUT in a permissions catalogue, which is a compromise and is worth naming as one. The
   * alternative was a second web-side map keyed by widget — a third home for a fact about a widget,
   * after the gate here and the component there — and this repo's register is explicit that a copy
   * with a delay fuse is the worse trade. It also has to live wherever LM10's per-user layout can
   * read it, and that is here.
   *
   * It was `"full" | "half"` until v3; the hero band is 5 / 4 / 3 and a two-value enum could not
   * say so. A count is the honest shape, and `resolveDashboardLayout` only reorders keys, so the
   * editor needs nothing from it. How a count collapses on a narrower screen is the renderer's
   * decision (D-DT5: breakpoints collapse spans, never restyle widgets) — `TabWidgets` holds it.
   *
   * ── `workspace` IS NOT A WIDTH, IT IS THE ABSENCE OF A GRID (D-DR24) ────────────────────────────
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
  span: WidgetSpan;
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
 * ── THE FLEET TAB'S GATES, AND WHY THEY ARE ALL `fuel` ──────────────────────────────────────────
 * The tab itself is gated `fuel` and not `accounting`, because `fleet_manager` holds
 * `accounting: none` and gating on money would take their own main screen away (Q-LM-F1). Every
 * card inherits that, and the money INSIDE a card is gated per figure by `applyMoneyGate`: the Fuel
 * card leads with gallons for a reader without `accounting` and shows its composition as shares
 * alone, the attention rail drops the idle dollars and keeps the hours, and the savings card is
 * dollars by nature and so carries `accounting` — the one card that is its own gate, exactly as the
 * two money charts were before it. `dashboardEquivalence.test.ts`'s "shows a caller without
 * accounting no currency figure anywhere on the tab" is what holds the line.
 */
export const DASHBOARD_WIDGETS: readonly DashboardWidget[] = [
  // ── fleet overview (v3, D-FO10: six cards, no per-card period switchers) ──────────────────────
  { span: 5 as const, key: "fleet.fuel", label: "Fuel spend", tab: "fleet", gate: section("fuel") },
  { span: 4 as const, key: "fleet.efficiency", label: "Fleet MPG", tab: "fleet", gate: section("fuel") },
  { span: 3 as const, key: "fleet.attention", label: "Needs attention", tab: "fleet", gate: section("fuel") },
  { span: 12 as const, key: "fleet.activity", label: "Activity in range", tab: "fleet", gate: section("fuel") },
  { span: 6 as const, key: "fleet.concentration", label: "Where open cases concentrate", tab: "fleet", gate: section("fuel") },
  { span: 6 as const, key: "fleet.savings", label: "Biggest savings on the table", tab: "fleet", gate: section("accounting") },

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
   * So this is `workspace` and not a width. The card-in-a-grid reading (`LiveMapPanel.vue`) is gone
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
