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
import type { AppSection, UserRole } from "@silvicom/shared";

export interface DashboardTab {
  key: string;
  label: string;
  /** The section the caller must be able to VIEW. Always a section — never a role. */
  gate: AppSection;
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
  { key: "fleet", label: "Fleet overview", gate: "fuel" },
  { key: "dispatch", label: "Dispatch", gate: "dispatch", defaultFor: ["dispatcher"] },
];

/** The tabs this caller may see, in catalogue order. `canView` is `session.canView`. */
export function visibleTabs(canView: (section: AppSection) => boolean): DashboardTab[] {
  return DASHBOARD_TABS.filter((t) => canView(t.gate));
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
