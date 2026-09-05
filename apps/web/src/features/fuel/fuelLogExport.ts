/**
 * The address, the filename and the scope sentence for a Fuel Log tab's export (FUEL-P2, D-FUI15).
 *
 * ── WHY THE URL IS ASSEMBLED FROM THE PAGE'S OWN PARAMETERS ─────────────────────────────────────
 * The export takes the query string the page is already holding — the window, the truck list and that
 * tab's own facets, spelled exactly as they are spelled in the address bar. Nothing is renamed or
 * re-encoded on the way, so the link a reader forwards and the file they attach are produced from one
 * set of words, and the server resolves it with the same shared functions the browser did.
 *
 * The alternative was sending the RESOLVED filters — vehicle UUIDs the browser had already looked up.
 * That is a URL a hand-edit can point at another org's trucks, and it would have put the resolution in
 * two places. The ids are resolved server-side against the caller's own roster instead.
 *
 * ⚠ Pure, and separate from the tabs, because the property worth testing is that a filter ON SCREEN
 * reaches the file: three tabs each building a query string inline is three chances for one facet to
 * be quietly left out, and a missing filter makes an export WIDER than the screen — the failure that
 * looks like a working file.
 */

/** The three lists, their endpoints and what each file is called. */
export const FUEL_LOG_EXPORTS = {
  fills: { path: "fills.csv", stem: "fuel-log-fills", title: "fills" },
  declines: { path: "declines.csv", stem: "fuel-log-declines", title: "declines" },
  source: { path: "source-records.csv", stem: "fuel-log-source-records", title: "source records" },
} as const;

export type FuelLogExportDataset = keyof typeof FUEL_LOG_EXPORTS;

export interface FuelLogExportInput {
  dataset: FuelLogExportDataset;
  /** The shared window and truck list, as the URL holds them. */
  from?: string;
  to?: string;
  units: string[];
  /** That tab's own facets, by their URL names. Empty strings are dropped, not sent as blanks. */
  facets?: Record<string, string | undefined>;
}

export interface FuelLogExportTarget {
  href: string;
  filename: string;
  /** What the button says it will produce — the same sentence the server prints on the file. */
  scope: string;
}

export function fuelLogExportTarget(input: FuelLogExportInput): FuelLogExportTarget {
  const spec = FUEL_LOG_EXPORTS[input.dataset];
  const params = new URLSearchParams();
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  if (input.units.length) params.set("unit", input.units.join(","));
  for (const [key, value] of Object.entries(input.facets ?? {})) {
    if (value) params.set(key, value);
  }
  const q = params.toString();

  const window = input.from && input.to
    ? `${input.from} → ${input.to}`
    : input.from
      ? `from ${input.from}`
      : input.to
        ? `to ${input.to}`
        : "all dates";
  const trucks = input.units.length === 0
    ? "all trucks"
    : `${input.units.length} truck${input.units.length === 1 ? "" : "s"}`;

  return {
    href: `/api/fueling/exports/${spec.path}${q ? `?${q}` : ""}`,
    // The window is in the NAME as well as on the first line, because the first thing anybody does
    // with a downloaded file is put it in a folder with six others.
    filename: `${spec.stem}-${input.from ?? "all"}-to-${input.to ?? "all"}.csv`,
    scope: `${window} · ${trucks}`,
  };
}
