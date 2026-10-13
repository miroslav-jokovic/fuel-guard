/**
 * The Dashboard's tabs, and which of them a caller may see.
 *
 * LM-T in `docs/plans/livemap/LIVE-MAP-PLAN.md` (D-DW6). One `DashboardPage.vue` renders whichever
 * tabs the caller's section grants allow: an admin passes both and sees a tab strip, a dispatcher
 * passes one and sees no chrome at all. That is the whole of "every role gets its own dashboard" —
 * there is no second page, and there is no `session.role` test anywhere in the rendering path.
 *
 * ── Why a gate and not a role, given the feature was ASKED for as "a page per role" ──────────────
 * A `role === 'dispatcher'` branch would be `session.canManage` all over again: one hard-coded answer
 * beside a section × role matrix the API, the database and the sidebar already model correctly. It
 * fails two concrete cases that gates get right for free — an org that grants `dispatch` to its
 * safety manager gets the tab with no code change, and the permissions preview page keeps telling
 * the truth about what a role sees. The root `CLAUDE.md` carries the worked example of what happens
 * when that rule is broken; this file is the same rule applied to tabs.
 *
 * ── `defaultFor` IS a role list, and that is deliberate (D-DW2) ──────────────────────────────────
 * It decides which tab a caller LANDS on, never which tabs exist for them. A default cannot leak
 * data — the worst a wrong one does is open the wrong tab of a set the gates already approved — so
 * it is the one place a role may legitimately be named. Every gate above it is still a section.
 */
import { manage, section, type Gated, type SurfaceGate, type UserRole } from "@silvicom/shared";

export interface DashboardTab extends Gated {
  key: string;
  label: string;
  /**
   * A `SurfaceGate`, built with `section()`/`manage()` — never a role.
   *
   * It was an `AppSection` read at `view` until FM1 (FLEET-MANAGER-HOME-PLAN D-FM2), and that was the
   * one gate in the Dashboard that could not say "manage": the Operations tab is for whoever RUNS the
   * fleet's record, and every section at `view` also hands it to a dispatcher, a safety manager or
   * the accountant. Widening the type to the one widgets and sidebar entries already use was the fix;
   * a role list here would have been the `canManage` boolean again.
   */
  gate: SurfaceGate;
  /** Roles that land on this tab first. A DEFAULT, not a gate (D-DW2). */
  defaultFor?: readonly UserRole[];
}

/**
 * Array order IS tab order.
 *
 * ⚠ `fleet` is gated on `fuel` and NOT on `accounting`, which looks wrong until you check the
 * matrix: `fleet_manager` holds `accounting: none`, so gating the tab on money would take their own
 * main screen away from them. The money INSIDE this tab is gated separately, per element, by
 * `moneyGate.ts` — that split is `Q-LM-F1`'s ruling and the reason both files exist. A dispatcher
 * therefore may open Fleet overview and will not find a dollar figure on it.
 */
export const DASHBOARD_TABS: readonly DashboardTab[] = [
  /**
   * ── OPERATIONS FIRST (FLEET-MANAGER-HOME-PLAN, Q-FM2 ruled (b) 2026-10-12) ──────────────────────
   * The fleet's readiness today — trucks, road, driver files, seats, paperwork — and no money (D-FM6).
   * First because it is the summary the other two tabs drill into, which also makes it where an
   * admin lands: they are in no `defaultFor`, so they open on the first tab they pass.
   *
   * `manage("equipment")` (D-FM2) is held by admin and fleet_manager and by anybody an org grants it.
   * Every card on the tab carries its own section gate as well (D-FM4), so the tab gate decides who
   * gets the page and never what is on it.
   *
   * `fleet_manager` moved here from Dispatch's list, which was the morning's "for now" (2026-10-12) — the ruling's own
   * undo. Dispatch and Fleet overview stay one tab away.
   */
  { key: "ops", label: "Operations", gate: manage("equipment"), defaultFor: ["fleet_manager"] },
  { key: "fleet", label: "Fleet overview", gate: section("fuel") },
  { key: "dispatch", label: "Dispatch", gate: section("dispatch"), defaultFor: ["dispatcher"] },
];

/**
 * The tabs this caller may see, in catalogue order. `allows` is the surface gate's own evaluator
 * (`surfaceGateAllows` with the caller's role and section claim) — the same question a sidebar entry
 * asks, so an org's sparse override reaches a tab exactly as it reaches a screen.
 */
export function visibleTabs(allows: (tab: Gated) => boolean): DashboardTab[] {
  return DASHBOARD_TABS.filter((t) => allows(t));
}

/**
 * Which tab opens first: the caller's requested tab when they may see it, else the one that names
 * their role, else the first they may see. `null` when they may see none — see `Q-LM-T1`.
 */
export function initialTab(tabs: readonly DashboardTab[], role: UserRole | null, requested?: string): DashboardTab | null {
  if (tabs.length === 0) return null;
  const asked = requested ? tabs.find((t) => t.key === requested) : undefined;
  if (asked) return asked;
  const byRole = role ? tabs.find((t) => t.defaultFor?.includes(role)) : undefined;
  return byRole ?? tabs[0]!;
}

/**
 * A tab strip is chrome, and chrome for a single choice is noise — a dispatcher who may see one tab
 * should see the dashboard, not a lone tab above it. Pinned rather than left to a `v-if` in the
 * template so the rule is testable.
 */
export const showsTabStrip = (tabs: readonly DashboardTab[]): boolean => tabs.length > 1;
