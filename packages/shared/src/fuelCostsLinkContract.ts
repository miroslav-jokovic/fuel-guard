/**
 * The Fuel Costs page's URL (`/fuel-spend`), as ONE definition read by the page and by Ask AI's
 * `fuel_report` link (F21 R4b, D-AI6).
 *
 * ── WHY A CONTRACT FOR A QUERY STRING ────────────────────────────────────────────────────────────
 * R4a's "Open in Fuel costs" opened the page's default 90 days, not the nine trucks and the quarter
 * the answer was about, so the reader had to rebuild the filter by hand to check a figure. A link
 * that carries the answer's filters must spell the page's keys exactly as the page reads them; a
 * second spelling of `trucks` in the API is a second source of truth that drifts the first time the
 * page renames a key (CLAUDE.md "No workarounds"). So the page's composables (`useSpendFilters`,
 * `useFuelCostFilters`) read these keys, and the tool builds its link with `fuelCostsToQuery`.
 *
 * ── WHAT EACH KEY HOLDS ──────────────────────────────────────────────────────────────────────────
 * `from`/`to` are calendar days, BOTH inclusive — the page's window and `readFuelReport`'s arguments
 * alike. `trucks` is vehicle IDS, comma-joined, never unit numbers: the page filters by id, and the
 * tool resolves the units the person named to ids before it reads (`assistantFuelReport`). The ids go
 * only into the link, never into the model's text (D-AI8). `states`, `sites` and `networks` select
 * FILLS rather than trucks; the tool sets none of them today, but the page reads them through here too.
 */
export const FUEL_COSTS_QUERY_KEYS = {
  from: "from",
  to: "to",
  trucks: "trucks",
  states: "states",
  sites: "sites",
  networks: "networks",
} as const;

export interface FuelCostsLinkFilters {
  from: string;
  to: string;
  vehicleIds?: readonly string[];
  states?: readonly string[];
  siteIds?: readonly string[];
  networks?: readonly string[];
}

/** The page's query for these filters. An empty list is left out: on this page it means "all", not "none". */
export function fuelCostsToQuery(f: FuelCostsLinkFilters): Record<string, string> {
  const K = FUEL_COSTS_QUERY_KEYS;
  const q: Record<string, string> = { [K.from]: f.from, [K.to]: f.to };
  const put = (key: string, v: readonly string[] | undefined) => {
    if (v && v.length) q[key] = v.join(",");
  };
  put(K.trucks, f.vehicleIds);
  put(K.states, f.states);
  put(K.sites, f.siteIds);
  put(K.networks, f.networks);
  return q;
}
