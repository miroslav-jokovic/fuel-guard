import type { Dataset, IdPrefix, PackingGroup } from "./schema.js";
import { buildMatchRecords, normalizePsn } from "./matchRecords.js";

export interface ResolveQuery {
  psn?: string | null;
  idPrefix?: IdPrefix | null;
  idNumber?: string | null;
  pg?: PackingGroup | null;
}

export type ResolveResult =
  | { status: "unique"; entryId: string; pg: PackingGroup | null }
  | { status: "not_found" }
  | { status: "ambiguous"; candidates: Array<{ entryId: string; pg: PackingGroup | null }> };

/**
 * Resolve a BOL line to a single HMT entry + pg-row. "Resolves uniquely" (used throughout the plan)
 * means exactly ONE entryId + one pg-row — not one flat record, because 'or'-alternates and UN/NA-vs-D/I
 * duplicates legitimately share names ("Diesel fuel" is BOTH NA1993(D) and UN1202(I), both valid
 * domestically). FAIL-CLOSED: anything other than a unique match returns not_found or ambiguous — the
 * caller (H6) must then disambiguate with the ID; the engine never guesses a pick.
 */
export function resolveEntry(dataset: Dataset, q: ResolveQuery): ResolveResult {
  const records = buildMatchRecords(dataset.entries);
  const wantPsn = q.psn != null ? normalizePsn(q.psn) : null;

  const matches = records.filter((r) => {
    if (wantPsn != null && r.normalizedPsn !== wantPsn) return false;
    if (q.idPrefix != null && r.idPrefix !== q.idPrefix) return false;
    if (q.idNumber != null && r.idNumber !== q.idNumber) return false;
    if (q.pg != null && r.pg !== q.pg) return false;
    return true;
  });

  const distinct = new Map<string, { entryId: string; pg: PackingGroup | null }>();
  for (const m of matches) distinct.set(`${m.entryId}::${m.pg ?? ""}`, { entryId: m.entryId, pg: m.pg });
  const list = [...distinct.values()];

  if (list.length === 0) return { status: "not_found" };
  if (list.length === 1) return { status: "unique", entryId: list[0]!.entryId, pg: list[0]!.pg };
  return { status: "ambiguous", candidates: list };
}
