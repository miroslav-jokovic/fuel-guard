/**
 * The IFTA ledger page's URL (`/ifta`, and a jurisdiction's `/ifta/:code`), as ONE definition read by
 * the pages and by Ask AI's `ifta_report` link (F21 R4b, D-AI6). See `fuelCostsLinkContract.ts` for
 * why a query string gets a contract.
 *
 * The page holds one fact in its URL: the quarter, as `q=YYYY-Qn` (`"2026-Q3"`). A link built by hand
 * would get it wrong the easy way — `q=3`, `q=Q3 2026` (the page's own LABEL), or a year and quarter as
 * two keys — and the page would fall back to its newest quarter without a word, showing a different
 * quarter's tax beside an answer about Q3. So the key, the writer and the reader all live here; the
 * web's `quarterKey` / `parseQuarterKey` are these functions under their old names.
 */
export const IFTA_QUERY_KEYS = { quarter: "q" } as const;

export interface IftaQuarterRef {
  year: number;
  quarter: number;
}

/** `"2026-Q3"` — the URL form, so a quarter can be sent to somebody. */
export const iftaQuarterKey = (q: IftaQuarterRef): string => `${q.year}-Q${q.quarter}`;

/** The quarter a `q=` names, or null when it names none (the page then opens on its newest). */
export function parseIftaQuarterKey(key: string | null | undefined): IftaQuarterRef | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(key ?? "").trim());
  return m ? { year: Number(m[1]), quarter: Number(m[2]) } : null;
}

/** The ledger's query for this quarter. */
export const iftaToQuery = (q: IftaQuarterRef): Record<string, string> => ({ [IFTA_QUERY_KEYS.quarter]: iftaQuarterKey(q) });
