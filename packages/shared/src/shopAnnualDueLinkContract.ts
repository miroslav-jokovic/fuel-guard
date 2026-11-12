/**
 * The Shop page's Annual due tab (`/shop?tab=annual`), ONE definition read by the page, its panel and
 * Ask AI's `annual_inspections_due` link (F21 R4b, D-AI6). See `fuelCostsLinkContract.ts` for why a
 * query string gets a contract.
 *
 * Two facts make the link: the tab (`tab=annual`; with no tab the page opens on the first list with
 * rows, often Roadside repairs or Defects, a different list from the answer's) and the kind. The page
 * says `tractor` where the tool's input says `truck` — the assistant's word is the reader's, the page's
 * is the roster's `subject_type` — so a link written with the tool's word would be dropped by the
 * panel's allow-list and show trucks AND trailers beside an answer about trucks. The mapping lives
 * here, once.
 *
 * Both lists come from one reader (`readAnnualDue`, `GET /api/maintenance/annual-due`), so the tab
 * opened on the answer's kind shows the answer's units.
 */
export const SHOP_QUERY_KEYS = { tab: "tab" } as const;
/** The Shop page's Annual due tab, as its `tab` param names it. */
export const SHOP_ANNUAL_DUE_TAB = "annual" as const;

export const ANNUAL_DUE_QUERY_KEYS = { kind: "kind" } as const;
/** The panel's kinds, as the roster's `subject_type` names them. */
export const ANNUAL_DUE_PAGE_KINDS = ["tractor", "trailer"] as const;
export type AnnualDuePageKind = (typeof ANNUAL_DUE_PAGE_KINDS)[number];

/** The page's kind for the assistant's word (`truck` → `tractor`); null for anything else, i.e. both kinds. */
export const annualDuePageKind = (toolKind: unknown): AnnualDuePageKind | null =>
  toolKind === "truck" ? "tractor" : toolKind === "trailer" ? "trailer" : null;

/** The Shop page opened on Annual due, narrowed to the answer's kind when it named one (the tool's word). */
export function shopAnnualDueToQuery(p: { kind?: unknown }): Record<string, string> {
  const kind = annualDuePageKind(p.kind);
  return { [SHOP_QUERY_KEYS.tab]: SHOP_ANNUAL_DUE_TAB, ...(kind ? { [ANNUAL_DUE_QUERY_KEYS.kind]: kind } : {}) };
}
