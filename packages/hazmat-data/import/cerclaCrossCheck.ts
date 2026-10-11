/**
 * Two-source check for 40 CFR 302.4 (RELEASING.md: "an independent official second source"), the same
 * shape as `govinfoCrossCheck.ts` does for §172.101/§172.504/§177.848: Source A = the eCFR versioner XML,
 * Source B = the GovInfo CFR annual edition (Title 40 is revised as of JULY 1, not October 1 like Title
 * 49 — CFR-2025-title40-vol30, dateIssued 2025-07-01, holds parts 300–399). Both parsed by `parseCercla.ts`
 * and compared row for row on every field of the parsed `HazSubstance` (name, CAS, lb, kg) as a multiset —
 * Table 302.4 lists some rows twice on purpose (the F001/F002 constituents "(a) Tetrachloroethylene"
 * under each stream) — plus the rows each side kept out for having no lb+kg RQ.
 *
 * No GOVINFO_API_KEY is needed: `captureCercla.ts` reads the edition from the public
 * `www.govinfo.gov/content/pkg/…` path. Like the Title 49 check it cannot catch an error the two share
 * through the OFR codification; it catches every parse and transport difference and every amendment the
 * edition predates (302.4's last amendment is 2024-07-08, so the 2025 edition and today's eCFR should
 * agree exactly, and do).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCerclaTable, parseCerclaTableGovInfo, type CerclaTable } from "./parseCercla.js";

export interface CerclaCrossCheck {
  sourceRef: string;
  aCount: number;
  bCount: number;
  matched: number;
  /** Rows (as `name | CAS | lb (kg)`) present in the eCFR parse and not the GovInfo parse — and back. */
  onlyA: string[];
  onlyB: string[];
  /** Rows without an lb+kg RQ that one side has and the other does not (`reason | name | cell`). */
  withoutRqOnlyA: string[];
  withoutRqOnlyB: string[];
  clean: boolean;
}

function multiset(keys: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

/** Keys in `a` beyond their count in `b` (a multiset difference, one entry per surplus copy). */
function surplus(a: Map<string, number>, b: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [k, n] of a) for (let i = b.get(k) ?? 0; i < n; i++) out.push(k);
  return out;
}

const rowKey = (s: CerclaTable["substances"][number]): string => `${s.name} | ${s.casNumber ?? "—"} | ${s.rqPounds} (${s.rqKg})`;
const noRqKey = (r: CerclaTable["withoutRq"][number]): string => `${r.reason} | ${r.name} | ${r.rqCell}`;

export function compareCerclaTables(a: CerclaTable, b: CerclaTable, sourceRef: string): CerclaCrossCheck {
  const ma = multiset(a.substances.map(rowKey));
  const mb = multiset(b.substances.map(rowKey));
  const onlyA = surplus(ma, mb);
  const onlyB = surplus(mb, ma);
  const wa = multiset(a.withoutRq.map(noRqKey));
  const wb = multiset(b.withoutRq.map(noRqKey));
  const withoutRqOnlyA = surplus(wa, wb);
  const withoutRqOnlyB = surplus(wb, wa);
  return {
    sourceRef,
    aCount: a.substances.length,
    bCount: b.substances.length,
    matched: a.substances.length - onlyA.length,
    onlyA,
    onlyB,
    withoutRqOnlyA,
    withoutRqOnlyB,
    clean: a.substances.length > 0 && onlyA.length + onlyB.length + withoutRqOnlyA.length + withoutRqOnlyB.length === 0,
  };
}

export function crossCheckCercla(ecfrXml: string, govinfoXml: string, sourceRef: string): CerclaCrossCheck {
  return compareCerclaTables(parseCerclaTable(ecfrXml), parseCerclaTableGovInfo(govinfoXml), sourceRef);
}

function fixture(name: string): string | null {
  try {
    return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
  } catch {
    return null;
  }
}

export function cerclaProvenanceRef(): string {
  const raw = fixture("govinfo/provenance-40-302-4.json");
  if (!raw) return "GovInfo CFR annual edition, 40 CFR 302.4";
  const p = JSON.parse(raw) as { govinfo?: { packageId?: string; dateIssued?: string } };
  return `GovInfo ${p.govinfo?.packageId ?? "CFR edition"}, §302.4 (${p.govinfo?.dateIssued ?? "annual edition"})`;
}

/** The committed captures (`captureCercla.ts`). Throws naming the script when one is missing. */
export function crossCheckCerclaDefault(): CerclaCrossCheck {
  const a = fixture("section-40-302-4.xml");
  const b = fixture("govinfo/cercla-302-4.xml");
  if (!a || !b) throw new Error("crossCheckCercla: missing 40 CFR 302.4 capture(s) — run `npx tsx import/captureCercla.ts`.");
  return crossCheckCercla(a, b, cerclaProvenanceRef());
}

export function formatCerclaCrossCheck(r: CerclaCrossCheck): string {
  const L = [
    `## 40 CFR 302.4 Table 302.4: ${r.clean ? "CLEAN ✓" : "NOT CLEAN ✗"} — matched ${r.matched}/${r.aCount} · ` +
      `eCFR-only ${r.onlyA.length} · GovInfo-only ${r.onlyB.length} · no-RQ rows differing ${r.withoutRqOnlyA.length + r.withoutRqOnlyB.length} (Source B: ${r.sourceRef})`,
  ];
  for (const k of r.onlyA.slice(0, 20)) L.push(`- eCFR-only: ${k}`);
  for (const k of r.onlyB.slice(0, 20)) L.push(`- GovInfo-only: ${k}`);
  for (const k of r.withoutRqOnlyA) L.push(`- eCFR-only (no RQ): ${k}`);
  for (const k of r.withoutRqOnlyB) L.push(`- GovInfo-only (no RQ): ${k}`);
  return L.join("\n");
}

// `npx tsx import/cerclaCrossCheck.ts` → print the report; exit non-zero unless clean.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = crossCheckCerclaDefault();
  process.stdout.write(formatCerclaCrossCheck(r) + "\n");
  process.exit(r.clean ? 0 : 1);
}
