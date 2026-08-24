/** Money / volume formatting shared by the spend tabs, so a figure reads the same on every one. */
export const usd = (n: number | null | undefined): string =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const usd2 = (n: number | null | undefined): string =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Per-gallon prices carry three decimals — a tenth of a cent is $200/year on this fleet's volume. */
export const usd3 = (n: number | null | undefined): string => (n == null ? "—" : `$${n.toFixed(3)}`);

export const gal = (n: number | null | undefined): string =>
  n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export const pct1 = (n: number | null | undefined): string => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

export const ymd = (s: string | null | undefined): string => s ?? "—";
