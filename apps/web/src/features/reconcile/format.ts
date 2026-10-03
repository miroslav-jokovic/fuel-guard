/** Money / volume formatting shared by the spend tabs, so a figure reads the same on every one. */
// The Fuel Costs four live in shared so the PDF prints the same strings (Q-FSV14); the rest are web-only.
export { usd, wholeUsd, usd3, gal } from "@silvicom/shared";

export const usd2 = (n: number | null | undefined): string =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const pct1 = (n: number | null | undefined): string => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

export const ymd = (s: string | null | undefined): string => s ?? "—";
