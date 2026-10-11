/** Money / volume formatting shared by the spend tabs, so a figure reads the same on every one. */
// The Fuel Costs four live in shared so the PDF prints the same strings (Q-FSV14); the rest are web-only.
// `usd2` joined them in 11b so the Fuel Log's Amount column prints a fill the way this tab does.
export { usd, wholeUsd, usd2, usd3, gal } from "@silvicom/shared";

export const pct1 = (n: number | null | undefined): string => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

export const ymd = (s: string | null | undefined): string => s ?? "—";
