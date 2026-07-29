import type { HmtEntry, HmtMatchRecord } from "./schema.js";

/**
 * Normalize a proper shipping name for matching. H1 does the mechanical basics (case, punctuation,
 * whitespace); H6 adds the reg-authorized transforms (only those §172.101 permits). Deliberately small
 * so it can be reasoned about — over-normalizing is how near-miss pairs (1206/1208, 1267/1268) collide.
 */
export function normalizePsn(psn: string): string {
  return psn
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Expand entries into the derived match space: one record per (name × pg-row), where `name` is the
 * printed PSN plus each 'or'-alternate. So "Gas oil" / "Diesel fuel" / "Heating oil, light" each
 * become their own record pointing at the same UN1202 entryId (plan H1 deliverable 1).
 */
export function buildMatchRecords(entries: readonly HmtEntry[]): HmtMatchRecord[] {
  const out: HmtMatchRecord[] = [];
  for (const e of entries) {
    const names = [e.psnPrinted, ...e.psnAlternates];
    for (const name of names) {
      const normalizedPsn = normalizePsn(name);
      for (const row of e.pgRows) {
        out.push({ normalizedPsn, idPrefix: e.idPrefix, idNumber: e.idNumber, pg: row.pg, entryId: e.entryId });
      }
    }
  }
  return out;
}
