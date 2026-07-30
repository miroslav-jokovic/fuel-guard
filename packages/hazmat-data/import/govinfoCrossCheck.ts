/**
 * Automated eCFR ↔ GovInfo cross-check (Phase H1, D5 v7 — the automated second source).
 *
 * Source A = the eCFR "processed" XML parsed by `parseHmtSection` (current, daily). Source B = the
 * OFFICIAL GovInfo annual-edition XML parsed by `parseHmtGovInfoSection`. Both emit `HmtEntry[]` in the
 * same schema, so we pair them by `rowKey` (prefix+number+normalized PSN) and run the SAME field-level
 * `compareEntry` used by the human-transcription gate — GovInfo simply plays the Source-B role, mapped
 * into the transcription shape with `transcriber: "govinfo-automated"`.
 *
 * What it catches: every markup/transport/extraction difference across ALL rows (the two formats are
 * genuinely different markups), plus real amendment DRIFT — the eCFR is current while the GovInfo edition
 * is the Oct-1 legal snapshot, so a row PHMSA amended in between shows up as a disagreement to reconcile
 * against the Federal Register. What it does NOT catch (honest scope): an error in the shared OFR
 * codification both sources derive from, or a bug in the shared assembly (`hmtAssemble.ts`) — those are
 * covered by the frozen human-verified `parseHmt.test.ts` and the human attestation of this report.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseHmtSection } from "./parseHmt.js";
import { parseHmtGovInfoSection } from "./parseHmtGovInfo.js";
import { parsePlacardTables } from "./parsePlacards.js";
import { parsePlacardTablesGovInfo } from "./parsePlacardsGovInfo.js";
import { parseSegregationGrid } from "./parseSegregation.js";
import { parseSegregationGridGovInfo } from "./parseSegregationGovInfo.js";
import { compareEntry, rowKey, IN_SCOPE_ENTRIES, transcribedRowSchema, type FieldDiff, type TranscribedRow } from "./diff.js";
import type { HmtEntry, PlacardSpec, SegregationCell } from "../src/schema.js";

/** Map a parsed GovInfo `HmtEntry` into the Source-B transcription shape so `compareEntry` can consume it. */
export function govInfoEntryToSourceB(e: HmtEntry, sourceRef: string): TranscribedRow {
  return transcribedRowSchema.parse({
    status: "done",
    idPrefix: e.idPrefix,
    idNumber: e.idNumber,
    psnPrinted: e.psnPrinted,
    symbols: e.symbols,
    psnAlternates: e.psnAlternates,
    italicText: e.italicText,
    hazardClass: e.hazardClass,
    subsidiaryClasses: e.subsidiaryClasses,
    pgRows: e.pgRows,
    source: sourceRef,
    transcriber: "govinfo-automated",
  });
}

export interface CrossCheckRow {
  key: string;
  idPrefix: string;
  idNumber: string;
  psnPrinted: string;
  status: "match" | "disagree" | "a-only" | "b-only";
  fieldDiffs: FieldDiff[];
}

export interface CrossCheckReport {
  sourceRef: string;
  totals: { aEntries: number; bEntries: number; aKeys: number; bKeys: number };
  full: { matched: number; disagree: number; aOnly: number; bOnly: number; keyCollisions: number };
  disagreements: CrossCheckRow[];
  aOnly: CrossCheckRow[];
  bOnly: CrossCheckRow[];
  inScope: { rows: CrossCheckRow[]; clean: boolean; missing: string[] };
}

function groupByKey(entries: HmtEntry[]): Map<string, HmtEntry[]> {
  const map = new Map<string, HmtEntry[]>();
  for (const e of entries) {
    const k = rowKey(e);
    const arr = map.get(k);
    if (arr) arr.push(e);
    else map.set(k, [e]);
  }
  return map;
}

export function crossCheckHmt(ecfrXml: string, govinfoXml: string, sourceRef: string): CrossCheckReport {
  const aEntries = parseHmtSection(ecfrXml);
  const bEntries = parseHmtGovInfoSection(govinfoXml);
  const aByKey = groupByKey(aEntries);
  const bByKey = groupByKey(bEntries);
  const collisions = [...aByKey.values()].filter((v) => v.length > 1).length + [...bByKey.values()].filter((v) => v.length > 1).length;

  const allKeys = new Set<string>([...aByKey.keys(), ...bByKey.keys()]);
  let matched = 0;
  const disagreements: CrossCheckRow[] = [];
  const aOnly: CrossCheckRow[] = [];
  const bOnly: CrossCheckRow[] = [];

  for (const key of allKeys) {
    const as = aByKey.get(key) ?? [];
    const bs = bByKey.get(key) ?? [];
    if (as.length && bs.length) {
      // Compare EVERY entry under this key positionally (both parsers emit in document order). A count
      // mismatch is itself a disagreement so a dropped/added variant can never hide behind a shared key.
      const first = as[0] as HmtEntry;
      if (as.length !== bs.length) {
        disagreements.push({
          key, idPrefix: first.idPrefix, idNumber: first.idNumber, psnPrinted: first.psnPrinted, status: "disagree",
          fieldDiffs: [{ field: "entry-count under key", sourceA: as.length, sourceB: bs.length }],
        });
        continue;
      }
      const fieldDiffs: FieldDiff[] = [];
      for (let i = 0; i < as.length; i++) {
        const ea = as[i] as HmtEntry;
        const eb = bs[i] as HmtEntry;
        const ds = compareEntry(ea, govInfoEntryToSourceB(eb, sourceRef));
        for (const d of ds) fieldDiffs.push(as.length > 1 ? { ...d, field: `[${i}] ${d.field}` } : d);
      }
      if (fieldDiffs.length === 0) matched++;
      else disagreements.push({ key, idPrefix: first.idPrefix, idNumber: first.idNumber, psnPrinted: first.psnPrinted, status: "disagree", fieldDiffs });
    } else if (as.length) {
      const ea = as[0] as HmtEntry;
      aOnly.push({ key, idPrefix: ea.idPrefix, idNumber: ea.idNumber, psnPrinted: ea.psnPrinted, status: "a-only", fieldDiffs: [] });
    } else if (bs.length) {
      const eb = bs[0] as HmtEntry;
      bOnly.push({ key, idPrefix: eb.idPrefix, idNumber: eb.idNumber, psnPrinted: eb.psnPrinted, status: "b-only", fieldDiffs: [] });
    }
  }

  // In-scope release-gate view: the launch-critical fuel rows must all pair and match (none collide).
  const inScopeRows: CrossCheckRow[] = [];
  const missing: string[] = [];
  for (const spec of IN_SCOPE_ENTRIES) {
    const key = rowKey(spec);
    const ea = (aByKey.get(key) ?? [])[0];
    const eb = (bByKey.get(key) ?? [])[0];
    if (!ea || !eb) {
      missing.push(key);
      inScopeRows.push({ key, idPrefix: spec.idPrefix, idNumber: spec.idNumber, psnPrinted: spec.psnPrinted, status: ea ? "a-only" : "b-only", fieldDiffs: [] });
      continue;
    }
    const fieldDiffs = compareEntry(ea, govInfoEntryToSourceB(eb, sourceRef));
    inScopeRows.push({ key, idPrefix: spec.idPrefix, idNumber: spec.idNumber, psnPrinted: spec.psnPrinted, status: fieldDiffs.length ? "disagree" : "match", fieldDiffs });
  }
  const inScopeClean = missing.length === 0 && inScopeRows.every((r) => r.status === "match");

  return {
    sourceRef,
    totals: { aEntries: aEntries.length, bEntries: bEntries.length, aKeys: aByKey.size, bKeys: bByKey.size },
    full: { matched, disagree: disagreements.length, aOnly: aOnly.length, bOnly: bOnly.length, keyCollisions: collisions },
    disagreements,
    aOnly,
    bOnly,
    inScope: { rows: inScopeRows, clean: inScopeClean, missing },
  };
}

// ------------------------------------------------------------------ placard + segregation cross-checks
/** A generic set-diff over keyed rows: matched count + keys present in only one source + value mismatches. */
export interface SetDiff {
  aCount: number;
  bCount: number;
  matched: number;
  onlyA: string[];
  onlyB: string[];
  valueDiffs: Array<{ key: string; field: string; sourceA: unknown; sourceB: unknown }>;
  clean: boolean;
}

function setDiff<T>(
  aRows: T[],
  bRows: T[],
  keyOf: (r: T) => string,
  compare: (a: T, b: T) => Array<{ field: string; sourceA: unknown; sourceB: unknown }>,
): SetDiff {
  const aByKey = new Map(aRows.map((r) => [keyOf(r), r]));
  const bByKey = new Map(bRows.map((r) => [keyOf(r), r]));
  const valueDiffs: SetDiff["valueDiffs"] = [];
  let matched = 0;
  for (const [k, a] of aByKey) {
    const b = bByKey.get(k);
    if (!b) continue;
    const ds = compare(a, b);
    if (ds.length === 0) matched++;
    else for (const d of ds) valueDiffs.push({ key: k, ...d });
  }
  const onlyA = [...aByKey.keys()].filter((k) => !bByKey.has(k));
  const onlyB = [...bByKey.keys()].filter((k) => !aByKey.has(k));
  return {
    aCount: aRows.length, bCount: bRows.length, matched, onlyA, onlyB, valueDiffs,
    clean: onlyA.length === 0 && onlyB.length === 0 && valueDiffs.length === 0 && matched === aByKey.size,
  };
}

const normText = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

export function crossCheckPlacards(ecfrXml: string, govinfoXml: string): SetDiff {
  const a = parsePlacardTables(ecfrXml);
  const b = parsePlacardTablesGovInfo(govinfoXml);
  return setDiff<PlacardSpec>(
    a, b,
    (s) => `${s.table}|${normText(s.classOrDivision)}`,
    (x, y) => {
      const d: Array<{ field: string; sourceA: unknown; sourceB: unknown }> = [];
      if (normText(x.placardName) !== normText(y.placardName)) d.push({ field: "placardName", sourceA: x.placardName, sourceB: y.placardName });
      if ((x.designRef ?? "") !== (y.designRef ?? "")) d.push({ field: "designRef", sourceA: x.designRef, sourceB: y.designRef });
      if (JSON.stringify(x.wordingOptions) !== JSON.stringify(y.wordingOptions)) d.push({ field: "wordingOptions", sourceA: x.wordingOptions, sourceB: y.wordingOptions });
      return d;
    },
  );
}

export function crossCheckSegregation(ecfrXml: string, govinfoXml: string): SetDiff {
  const a = parseSegregationGrid(ecfrXml);
  const b = parseSegregationGridGovInfo(govinfoXml);
  return setDiff<SegregationCell>(
    a, b,
    (c) => `${normText(c.rowClass)}||${normText(c.colClass)}`,
    (x, y) => (x.value !== y.value ? [{ field: "value", sourceA: x.value, sourceB: y.value }] : []),
  );
}

export interface TriangulationResult {
  hmt: CrossCheckReport;
  placards: SetDiff;
  segregation: SetDiff;
  allClean: boolean;
}

// ------------------------------------------------------------------ report
function fmt(v: unknown): string {
  if (v == null) return "∅";
  if (Array.isArray(v)) return v.length ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]` : "[]";
  return JSON.stringify(v);
}

export function formatCrossCheckReport(r: CrossCheckReport): string {
  const L: string[] = [];
  L.push("# HazmatGuard §172.101 automated eCFR↔GovInfo cross-check (D5 v7)");
  L.push("");
  L.push(`- Source A: eCFR processed XML → parseHmtSection (${r.totals.aEntries} entries)`);
  L.push(`- Source B: ${r.sourceRef} → parseHmtGovInfoSection (${r.totals.bEntries} entries)`);
  L.push("");
  L.push("## Full-table triangulation (all rows)");
  L.push(
    `matched: ${r.full.matched} · disagreements: ${r.full.disagree} · ` +
      `A-only (in eCFR, not GovInfo edition): ${r.full.aOnly} · B-only (in GovInfo edition, not eCFR): ${r.full.bOnly}` +
      (r.full.keyCollisions ? ` · key-collisions: ${r.full.keyCollisions}` : ""),
  );
  L.push("");
  L.push(`## In-scope fuel release gate: ${r.inScope.clean ? "CLEAN ✓" : "NOT CLEAN ✗"}`);
  for (const row of r.inScope.rows) {
    const tag = row.status === "match" ? "✓ match" : row.status === "disagree" ? "✗ DISAGREE" : `✗ ${row.status}`;
    L.push(`### ${row.idPrefix}${row.idNumber} — ${row.psnPrinted}  [${tag}]`);
    for (const d of row.fieldDiffs) L.push(`- \`${d.field}\`: eCFR=${fmt(d.sourceA)}  GovInfo=${fmt(d.sourceB)}`);
  }
  L.push("");
  if (r.disagreements.length) {
    L.push(`## All disagreements (${r.disagreements.length}) — reconcile each vs Federal Register / eCFR corrections`);
    for (const row of r.disagreements.slice(0, 60)) {
      L.push(`### ${row.idPrefix}${row.idNumber} — ${row.psnPrinted}`);
      for (const d of row.fieldDiffs) L.push(`- \`${d.field}\`: eCFR=${fmt(d.sourceA)}  GovInfo=${fmt(d.sourceB)}`);
    }
    if (r.disagreements.length > 60) L.push(`… and ${r.disagreements.length - 60} more.`);
    L.push("");
  }
  if (r.aOnly.length) {
    L.push(`## A-only keys (present in current eCFR, absent from the ${r.sourceRef} edition) — likely added since Oct 1`);
    for (const row of r.aOnly.slice(0, 40)) L.push(`- ${row.idPrefix}${row.idNumber} — ${row.psnPrinted}`);
    if (r.aOnly.length > 40) L.push(`… and ${r.aOnly.length - 40} more.`);
    L.push("");
  }
  if (r.bOnly.length) {
    L.push(`## B-only keys (present in the ${r.sourceRef} edition, absent from current eCFR) — likely removed/renamed since Oct 1`);
    for (const row of r.bOnly.slice(0, 40)) L.push(`- ${row.idPrefix}${row.idNumber} — ${row.psnPrinted}`);
    if (r.bOnly.length > 40) L.push(`… and ${r.bOnly.length - 40} more.`);
    L.push("");
  }
  return L.join("\n");
}

// ------------------------------------------------------------------ defaults + entrypoint
function readFixture(name: string): string | null {
  try {
    return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
  } catch {
    return null;
  }
}

function readProvenanceRef(): string {
  try {
    const raw = readFileSync(fileURLToPath(new URL("./fixtures/govinfo/provenance.json", import.meta.url)), "utf8");
    const p = JSON.parse(raw) as { hmt?: { packageId?: string; section?: string; dateIssued?: string } };
    const h = p.hmt ?? {};
    return `GovInfo ${h.packageId ?? "CFR edition"}, §${h.section ?? "172.101"} (${h.dateIssued ?? "annual edition"})`;
  } catch {
    return "GovInfo annual CFR edition";
  }
}

export function crossCheckDefault(): CrossCheckReport {
  const ecfr = readFixture("section-172-101.xml") ?? readFixture("hmt-fuel-slice.xml");
  const gov = readFixture("govinfo/hmt-172-101.xml");
  if (!ecfr) throw new Error("crossCheck: no eCFR §172.101 fixture (run captureFixtures.ts).");
  if (!gov) throw new Error("crossCheck: no GovInfo §172.101 fixture (run captureGovInfo.ts).");
  return crossCheckHmt(ecfr, gov, readProvenanceRef());
}

/** Run the triangulation over all three verified tables (HMT, §172.504 placards, §177.848 segregation). */
export function crossCheckAll(): TriangulationResult {
  const hmt = crossCheckDefault();
  const pA = readFixture("section-172-504.xml"), pB = readFixture("govinfo/placardTables-172-504.xml");
  const sA = readFixture("section-177-848.xml"), sB = readFixture("govinfo/segregation-177-848.xml");
  if (!pA || !pB) throw new Error("crossCheck: missing §172.504 placard fixture(s).");
  if (!sA || !sB) throw new Error("crossCheck: missing §177.848 segregation fixture(s).");
  const placards = crossCheckPlacards(pA, pB);
  const segregation = crossCheckSegregation(sA, sB);
  return { hmt, placards, segregation, allClean: hmt.inScope.clean && hmt.full.disagree === 0 && placards.clean && segregation.clean };
}

export function formatTriangulation(t: TriangulationResult): string {
  const L: string[] = [formatCrossCheckReport(t.hmt)];
  const setLine = (name: string, d: SetDiff): string =>
    `## ${name}: ${d.clean ? "CLEAN ✓" : "NOT CLEAN ✗"} — matched ${d.matched}/${d.aCount} · ` +
    `value-diffs ${d.valueDiffs.length} · eCFR-only ${d.onlyA.length} · GovInfo-only ${d.onlyB.length}`;
  L.push(setLine("§172.504 placard tables", t.placards));
  for (const d of t.placards.valueDiffs.slice(0, 20)) L.push(`- ${d.key} \`${d.field}\`: eCFR=${fmt(d.sourceA)} GovInfo=${fmt(d.sourceB)}`);
  L.push(...t.placards.onlyA.map((k) => `- eCFR-only: ${k}`), ...t.placards.onlyB.map((k) => `- GovInfo-only: ${k}`));
  L.push("");
  L.push(setLine("§177.848(d) segregation grid", t.segregation));
  for (const d of t.segregation.valueDiffs.slice(0, 20)) L.push(`- ${d.key} \`${d.field}\`: eCFR=${fmt(d.sourceA)} GovInfo=${fmt(d.sourceB)}`);
  L.push("");
  L.push(`# TRIANGULATION VERDICT: ${t.allClean ? "ALL CLEAN ✓ — eCFR and the official GovInfo edition agree" : "NOT CLEAN ✗ — reconcile before release"}`);
  return L.join("\n");
}

// `npx tsx import/govinfoCrossCheck.ts` → print the live report; exit non-zero if any table is dirty.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const t = crossCheckAll();
  process.stdout.write(formatTriangulation(t) + "\n");
  process.exit(t.allClean ? 0 : 1);
}
