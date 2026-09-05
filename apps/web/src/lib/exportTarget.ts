/**
 * Turning a filtered page into the address of its file (FUEL-P2, D-FUI15).
 *
 * ── WHY THIS IS A LIBRARY AND NOT A LINE IN EACH PAGE ───────────────────────────────────────────
 * A filter that is ON SCREEN and NOT in the export URL makes the file WIDER than the list above it,
 * and there is no symptom: the download works, the rows look right, and somebody quoting it is
 * quoting a set nobody chose. Four surfaces build one of these, so the assembly is one function with
 * one test rather than four chances to leave a facet out.
 *
 * ── AND WHY THE PARAMETERS PASS THROUGH UNRENAMED ───────────────────────────────────────────────
 * The names are the page's own — `?unit=`, `?risk=`, `?health=` — so the URL that produced the screen
 * is the URL that produces the file, and the server resolves it with the same shared functions the
 * browser did. Nothing is re-encoded on the way, and nothing is resolved on the way: sending
 * pre-resolved UUIDs would put the resolution in two places and put a hand-editable id list on a URL.
 */

/** An empty value is a filter nobody set, and it is left OUT rather than sent as a blank. */
export function exportHref(path: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) q.set(key, value);
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * What the button says the file will cover — the same sentence the server prints on the file itself.
 *
 * A file outlives its download: a CSV in an email six weeks later has no filter bar above it, and "is
 * this all of August or only the two trucks we were arguing about" is the question that makes somebody
 * re-run it. Saying it beside the button also turns the coupling between the filter bar and the export
 * into something visible, which is what `ReportExportButton` learnt on the spend page.
 */
export function windowScope(from: string | undefined, to: string | undefined, trucks: number): string {
  const window = from && to ? `${from} → ${to}` : from ? `from ${from}` : to ? `to ${to}` : "all dates";
  const t = trucks === 0 ? "all trucks" : `${trucks} truck${trucks === 1 ? "" : "s"}`;
  return `${window} · ${t}`;
}
