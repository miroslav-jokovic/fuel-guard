/**
 * What changes for the engine when `hazSubstances` moves from §172.101 Appendix A to 40 CFR 302.4
 * (91 FR 49305, effective 2026-12-02): rows only in one list, and rows in both whose RQ differs.
 *
 * Rows pair on a deliberately forgiving key — lowercased, every space removed, Appendix A's printed
 * footnote markers ¢ @ # removed (its parser keeps them in the name; 302.4's drops its own) — so that a
 * difference left over is a real one: a different spelling, a name one list has and the other lacks, or
 * a different RQ. Appendix A's "DDE (72-55-9) #" also pairs with 302.4's "DDE" whose CAS is 72-55-9,
 * because Appendix A spells the CAS into the name where 302.4 gives it a column.
 *
 * Read-only: it prints a report and writes nothing. `npx tsx import/hazSubstancesDiff.ts`
 */

import { pathToFileURL } from "node:url";
import type { HazSubstance } from "../src/schema.js";
import { parseHazSubstances } from "./parseAppendices.js";
import { parseCerclaTable } from "./parseCercla.js";
import { readImportFixture } from "./hazSubstancesSource.js";

export interface HazSourceDiff {
  appendixACount: number;
  cerclaCount: number;
  /** Appendix A names that found a 302.4 row with the same lb+kg RQ(s). */
  matched: number;
  rqDiffs: Array<{ name: string; appendixA: string[]; cercla: string[] }>;
  onlyAppendixA: HazSubstance[];
  onlyCercla: HazSubstance[];
}

export const pairKey = (name: string): string => name.toLowerCase().replace(/[¢@#]/g, "").replace(/\s+/g, "");
const rq = (s: HazSubstance): string => `${s.rqPounds} (${s.rqKg})`;

function index(rows: HazSubstance[], keyOf: (s: HazSubstance) => string[]): Map<string, HazSubstance[]> {
  const m = new Map<string, HazSubstance[]>();
  for (const s of rows) for (const k of keyOf(s)) m.set(k, [...(m.get(k) ?? []), s]);
  return m;
}

export function diffHazSubstanceSources(appendixA: HazSubstance[], cercla: HazSubstance[]): HazSourceDiff {
  // A 302.4 row answers to its name AND to "name (CAS)", Appendix A's way of telling two DDEs apart.
  const byKey = index(cercla, (s) => [pairKey(s.name), ...(s.casNumber ? [pairKey(`${s.name} (${s.casNumber})`)] : [])]);
  const aByKey = index(appendixA, (s) => [pairKey(s.name)]);
  const used = new Set<HazSubstance>();
  const rqDiffs: HazSourceDiff["rqDiffs"] = [];
  const onlyAppendixA: HazSubstance[] = [];
  let matched = 0;
  for (const [key, aRows] of aByKey) {
    const bRows = byKey.get(key);
    if (!bRows) {
      onlyAppendixA.push(...aRows);
      continue;
    }
    bRows.forEach((b) => used.add(b));
    const aRq = [...new Set(aRows.map(rq))].sort();
    const bRq = [...new Set(bRows.map(rq))].sort();
    if (aRq.join() === bRq.join()) matched += aRows.length;
    else rqDiffs.push({ name: aRows[0]!.name, appendixA: aRq, cercla: bRq });
  }
  return {
    appendixACount: appendixA.length,
    cerclaCount: cercla.length,
    matched,
    rqDiffs,
    onlyAppendixA,
    onlyCercla: cercla.filter((s) => !used.has(s)),
  };
}

export function formatHazSourceDiff(d: HazSourceDiff): string {
  const L = [
    "# hazSubstances: §172.101 Appendix A vs 40 CFR 302.4 Table 302.4",
    "",
    `Appendix A rows ${d.appendixACount} · Table 302.4 rows (lb+kg RQ) ${d.cerclaCount} · paired with the same RQ ${d.matched} · ` +
      `RQ differs ${d.rqDiffs.length} · only in Appendix A ${d.onlyAppendixA.length} · only in 302.4 ${d.onlyCercla.length}`,
    "",
    "## RQ differs",
    ...d.rqDiffs.map((r) => `- ${r.name}: Appendix A ${r.appendixA.join(", ")} → 302.4 ${r.cercla.join(", ")}`),
    "",
    "## Only in Appendix A",
    ...d.onlyAppendixA.map((s) => `- ${s.name} — ${rq(s)}`),
    "",
    "## Only in Table 302.4",
    ...d.onlyCercla.map((s) => `- ${s.name} [CAS ${s.casNumber ?? "—"}] — ${rq(s)}`),
  ];
  return L.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = readImportFixture("section-172-101.xml");
  const b = readImportFixture("section-40-302-4.xml");
  if (!a || !b) throw new Error("hazSubstancesDiff: needs fixtures/section-172-101.xml and fixtures/section-40-302-4.xml.");
  process.stdout.write(formatHazSourceDiff(diffHazSubstanceSources(parseHazSubstances(a), parseCerclaTable(b).substances)) + "\n");
}
