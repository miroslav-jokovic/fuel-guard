import type { AdsSpendPlatform, AdsSpendReconcile } from "@silvicom/shared";

/**
 * "Spend control live" (E1c) in words. Pure, so what each figure is called — and which state is a warning —
 * is tested without a browser. The figures themselves are the API's (`AdsSpendView`); nothing here adds,
 * forecasts or compares beyond reading the two numbers it is given side by side.
 */

/** Dollars from cents: whole dollars when there are no cents, as the settings form shows them. */
export const usd = (cents: number): string =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

export const count = (n: number): string => n.toLocaleString("en-US");

export type Tone = "ok" | "warn" | "stop";

export function platformLine(p: AdsSpendPlatform, daysLeft: number): { spent: string; forecast: string; tone: Tone } {
  const spent = p.cap_cents === null ? `${usd(p.month_to_date_cents)} spent this month` : `${usd(p.month_to_date_cents)} of ${usd(p.cap_cents)} spent this month`;
  if (p.cap_cents === null) return { spent, forecast: "No monthly cap is saved, so nothing can launch here.", tone: "stop" };
  const days = daysLeft === 1 ? "today" : `the ${daysLeft} days left`;
  const course = `On course for ${usd(p.forecast_cents)} if today's daily budgets run for ${days}`;
  return p.forecast_cents > p.cap_cents
    ? { spent, forecast: `${course} — over the cap, so a launch or raise that adds budget is refused.`, tone: "warn" }
    : { spent, forecast: `${course}.`, tone: "ok" };
}

/** Used of budget, for the AI tokens and picture credits. A budget never saved stops the agents (`aiRail.ts`). */
export function budgetLine(used: number, budget: number | null, unit: string): { text: string; tone: Tone } {
  if (budget === null) return { text: `${count(used)} ${unit} used. No monthly budget is saved, so the agents cannot use any.`, tone: "stop" };
  return { text: `${count(used)} of ${count(budget)} ${unit} used this month.`, tone: used >= budget ? "warn" : "ok" };
}

export function reconcileLine(r: AdsSpendReconcile, when: (iso: string) => string): { text: string; tone: Tone } {
  if (r.last_run_at === null) return { text: "Never checked against Meta yet.", tone: "warn" };
  const changes = r.changes_since === 0 ? "nothing differed" : r.changes_since === 1 ? "1 difference recorded" : `${r.changes_since} differences recorded`;
  return r.late
    ? { text: `Last checked against Meta ${when(r.last_run_at)} — the daily check has stopped running.`, tone: "warn" }
    : { text: `Checked against Meta ${when(r.last_run_at)}; ${changes} since.`, tone: r.changes_since > 0 ? "warn" : "ok" };
}
