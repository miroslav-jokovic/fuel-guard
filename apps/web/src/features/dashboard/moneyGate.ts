/**
 * Which Dashboard elements render money, and what a caller without `accounting` sees instead.
 *
 * LM-F in `docs/plans/livemap/LIVE-MAP-PLAN.md`, answering `Q-LM-F1` (ruled 2026-09-15). The
 * Dashboard is `gate: ALWAYS` in `surfaces.ts`, so EVERY role that can sign in lands on it — and it
 * renders fuel spend, idle cost in dollars, reefer spend, recovered dollars and a cost-composition
 * donut. A dispatcher does not need any of that, and until this module existed they saw all of it.
 *
 * ── Why the rule is per ELEMENT and not per section ──────────────────────────────────────────────
 * Neither candidate section expresses it. `fuel` fails outright: the dispatcher holds `fuel: view`
 * by design, so gating spend there changes nothing for exactly the role that prompted the question.
 * `accounting` is the right gate for the *money* but the wrong gate for the *page* — a dispatcher
 * legitimately reads gallons, miles, MPG and alerts, which live on the same tiles strip.
 *
 * And the matrix cannot be narrowed to fix it, because it does not model the distinction at all:
 * the `accountant` role was granted `fuel: "view"` with the recorded reasoning that "fuel spend IS
 * the largest expense line and the accounting surfaces cite it" — a grant that only makes sense if
 * spend is readable under `fuel`. So the split lives here, at the element, where it is greppable.
 *
 * ── `withoutMoney` is the interesting half ───────────────────────────────────────────────────────
 * Some money tiles have an operational twin that is MORE useful to the caller who loses the dollars.
 * "Idle waste" already carried `412 idle hrs` as its sub-label, so a dispatcher keeps the tile and
 * the hours and loses only the `$8.2k`. Dropping the tile outright would have been easier and worse:
 * idle hours are the number a dispatcher can actually act on. A tile with no twin is removed rather
 * than blanked — a dash where money used to be invites the reader to go looking for a bug.
 *
 * ⚠ **This is a product boundary, not a security boundary, and the distinction is load-bearing.**
 * `DashboardPage` reads PostgREST directly under RLS, and `ftxn_select` (0004_rls.sql:60, never
 * superseded) is `using (org_id = auth_org_id())` with no section check — so any org member can read
 * `total_cost` by calling the API directly. This module stops the product rendering money. Closing
 * the other half is LM-F2, and it is a migration-shaped change, not a line here.
 */

/** A tile that may carry money. Structurally compatible with what `StatCard` is bound to. */
export interface MoneyGateable {
  label: string;
  value: string;
  valueTitle?: string;
  sub?: string;
  /** Marks this tile as rendering a currency figure. Absent means operational — always shown. */
  money?: true;
  /**
   * What a caller without `accounting` sees in place of the money. Absent means the tile has no
   * honest non-money form and is removed entirely.
   */
  withoutMoney?: { value: string; valueTitle?: string; sub?: string };
}

/**
 * Apply the gate to one strip of tiles.
 *
 * `canSeeMoney` is `session.canView("accounting")` at the call site — never `session.role`, and
 * never a hand-written role list. Going through `canView` is what makes an org's sparse section
 * override (D-PERM4) work here for free: an org that grants its fleet manager `accounting: view`
 * gets the dollars back without a code change.
 */
export function applyMoneyGate<T extends MoneyGateable>(tiles: readonly T[], canSeeMoney: boolean): T[] {
  if (canSeeMoney) {
    // Strip the fallback so it can never reach a component as a stray prop.
    return tiles.map((t) => {
      const { withoutMoney: _unused, ...rest } = t;
      return rest as T;
    });
  }
  return tiles.flatMap((t) => {
    if (!t.money) return [t];
    if (!t.withoutMoney) return [];
    // `valueTitle` is dropped WITH the value, and must be destructured out rather than left to the
    // spread. The fallback only supplies `value`/`sub`, so `{...rest, ...withoutMoney}` would carry
    // the original hover through untouched — leaving the exact figure ("$8,210.55") in a `title`
    // attribute on a tile whose face reads "412 idle hrs". That is worse than showing the money,
    // because nobody reviewing the screen would ever see it. Caught by mutation, not by review:
    // pinned by "drops valueTitle with the value — the hover is money too" in `moneyGate.test.ts`.
    const { withoutMoney, money: _money, valueTitle: _valueTitle, ...rest } = t;
    return [{ ...rest, ...withoutMoney } as unknown as T];
  });
}

/**
 * Does this strip still contain a currency figure? Used by the page to decide whether a whole
 * chart card is worth rendering, and by the test that pins the rule.
 */
export const hasMoney = (tiles: readonly MoneyGateable[]): boolean => tiles.some((t) => t.money === true);
