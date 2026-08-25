/**
 * Number formatting for the report. Shared by the assembly and the sections so a figure reads the same
 * wherever it lands, and so neither file has to import the other to borrow a helper.
 */
import type { Kpi } from "./fuelSpendReportDraw.js";

export const usd = (n: number | null | undefined) =>
  n == null ? "-" : `$${Math.round(n).toLocaleString("en-US")}`;
export const usd2 = (n: number | null | undefined) => (n == null ? "-" : `$${n.toFixed(2)}`);
export const usd3 = (n: number | null | undefined) => (n == null ? "-" : `$${n.toFixed(3)}`);
export const num = (n: number | null | undefined, dp = 0) =>
  n == null ? "-" : n.toLocaleString("en-US", { maximumFractionDigits: dp });

/** A formatted delta plus the verdict on it — `upIsBad` says which direction is the bad one. */
export function change(
  a: number | null | undefined,
  b: number | null | undefined,
  upIsBad: boolean,
): Pick<Kpi, "delta" | "deltaIsBad"> {
  if (a == null || b == null || a === 0 || a === b) return {};
  const p = ((b - a) / Math.abs(a)) * 100;
  return {
    delta: `${p >= 0 ? "+" : "-"}${Math.abs(p).toFixed(1)}% vs prior`,
    // The sign and the preference resolved together. Spend up is bad; MPG up is the one good headline
    // this report ever gets, and a tile that painted it red would bury it.
    deltaIsBad: p > 0 === upIsBad,
  };
}
