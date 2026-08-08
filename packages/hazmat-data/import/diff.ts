/**
 * Second-source diff (Phase H1, deliverable 3) — the D5 v5 release gate.
 *
 * Official-sources-only, no paid vendor. Compares the eCFR-XML parse (Source A — `parseHmtSection`
 * over the captured §172.101 XML) against the INDEPENDENT HUMAN TRANSCRIPTION of the in-scope fuel
 * rows (Source B — `fixtures/handVerifiedRows.ts`, typed by a person reading the official GovInfo
 * Title-49 legal PDF) and reports every field-level disagreement.
 *
 * Why a human transcription and not a second automated feed: eCFR and GovInfo XML both derive from
 * the same OFR codification, so a second machine feed only catches transport/parse errors — never a
 * source-data error. A human reading the official PDF is the only genuinely independent check, and it
 * is bounded to the in-scope rows (D4 fail-closes everything else).
 *
 * RELEASE RULE (checked by `report.clean`): every in-scope row transcribed (`status: "done"`) with
 * audit provenance, and ZERO unexplained field disagreements. Explained disagreements are recorded in
 * `datasets/vX/diff-report.md` (the output of `formatDiffReport`). Until then the dataset stays
 * `provisional: true` and can never CLEAR a load (H1.6/H4).
 *
 * This file is the diff ENGINE (pure, injectable) plus a small runnable entrypoint. The engine takes
 * Source A and Source B as arguments so `diff.test.ts` can exercise it with synthetic data; the
 * defaults wire it to the real parser + transcription so `npx tsx import/diff.ts` prints the live report.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { parseHmtSection } from "./parseHmt.js";
import type { HmtEntry, PgRow } from "../src/schema.js";
import { HAND_VERIFIED_ROWS } from "./fixtures/handVerifiedRows.js";

// ------------------------------------------------------------------ Source B shape
/**
 * A single hand-transcribed HMT row (Source B). Mirrors the SEMANTIC fields of `HmtEntry` — the
 * fields the engine actually consumes — minus the parser-internal synthetic `entryId`, plus audit
 * provenance. The transcriber records what is PRINTED in the official PDF; the split of 'or'-alternate
 * names and the separation of italic (c)(2) text is a judgement the human makes from the page, exactly
 * where an independent read is most valuable.
 */
export const transcribedPgRowSchema = z.object({
  pg: z.enum(["I", "II", "III"]).nullable(),
  labelCodes: z.array(z.string()).default([]),
  specialProvisions: z.array(z.string()).default([]),
  /** Columns 8A/8B (H-LQ). Optional so pre-2026.08 transcriptions stay valid; absent compares as null. */
  exceptionsRef: z.string().nullable().optional(),
  nonBulkPackagingRef: z.string().nullable().optional(),
  bulkPackagingRef: z.string().nullable().default(null),
  quantityLimits: z
    .object({
      passengerAircraftRail: z.string().nullable().default(null),
      cargoAircraft: z.string().nullable().default(null),
    })
    .default({ passengerAircraftRail: null, cargoAircraft: null }),
  vesselStowage: z
    .object({
      location: z.string().nullable().default(null),
      other: z.array(z.string()).default([]),
    })
    .default({ location: null, other: [] }),
});
export type TranscribedPgRow = z.infer<typeof transcribedPgRowSchema>;

export const transcribedRowSchema = z.object({
  /** "pending" until a human has transcribed and checked the row; "done" makes it count for release. */
  status: z.enum(["pending", "done"]).default("pending"),
  idPrefix: z.enum(["UN", "NA"]),
  idNumber: z.string(),
  psnPrinted: z.string(),
  symbols: z.array(z.string()).default([]),
  psnAlternates: z.array(z.string()).default([]),
  italicText: z.string().nullable().default(null),
  hazardClass: z.string().nullable().default(null),
  subsidiaryClasses: z.array(z.string()).default([]),
  pgRows: z.array(transcribedPgRowSchema).default([]),
  // Audit provenance (D9) — required on a "done" row (enforced by the clean check, not the schema).
  /** The exact official source read, e.g. "GovInfo CFR-2025-title49-vol2, §172.101, p. 214". */
  source: z.string().default(""),
  transcriber: z.string().default(""),
  transcribedOn: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});
export type TranscribedRow = z.infer<typeof transcribedRowSchema>;

// ------------------------------------------------------------------ scope + keys
/**
 * The in-scope launch set (13 fuel entries covering the 12 `ERG_FUEL_IDS`; a UN number is not unique,
 * so diesel/heating-oil appear under both UN1202 Class-3 and NA1993 combustible). The diff is BOUNDED
 * to these — everything else is D4 fail-closed and is not part of the second-source gate.
 */
export const IN_SCOPE_ENTRIES: ReadonlyArray<{ idPrefix: "UN" | "NA"; idNumber: string; psnPrinted: string }> = [
  { idPrefix: "UN", idNumber: "1203", psnPrinted: "Gasoline" },
  { idPrefix: "UN", idNumber: "1202", psnPrinted: "Diesel fuel" },
  { idPrefix: "NA", idNumber: "1993", psnPrinted: "Diesel fuel" },
  { idPrefix: "NA", idNumber: "1993", psnPrinted: "Fuel oil" },
  { idPrefix: "UN", idNumber: "3475", psnPrinted: "Ethanol and gasoline mixture" },
  { idPrefix: "UN", idNumber: "1170", psnPrinted: "Ethanol" },
  { idPrefix: "UN", idNumber: "1987", psnPrinted: "Alcohols, n.o.s." },
  { idPrefix: "UN", idNumber: "1863", psnPrinted: "Fuel, aviation, turbine engine" },
  { idPrefix: "UN", idNumber: "1268", psnPrinted: "Petroleum distillates, n.o.s." },
  { idPrefix: "UN", idNumber: "1223", psnPrinted: "Kerosene" },
  { idPrefix: "UN", idNumber: "1075", psnPrinted: "Petroleum gases, liquefied" },
  { idPrefix: "UN", idNumber: "1978", psnPrinted: "Propane" },
  { idPrefix: "UN", idNumber: "3257", psnPrinted: "Elevated temperature liquid, n.o.s." },
];

/** Match key for pairing Source A ↔ Source B: prefix+number+normalized printed name. */
export function rowKey(r: { idPrefix: string; idNumber: string; psnPrinted: string }): string {
  return `${r.idPrefix}${r.idNumber}|${r.psnPrinted.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

// ------------------------------------------------------------------ comparison
export interface FieldDiff {
  field: string;
  sourceA: unknown;
  sourceB: unknown;
}

export interface RowDiff {
  key: string;
  idPrefix: string;
  idNumber: string;
  psnPrinted: string;
  status: "match" | "disagree" | "pending" | "b-only";
  fieldDiffs: FieldDiff[];
  provenanceMissing: boolean;
}

export interface DiffReport {
  sourceADate: string | null;
  rows: RowDiff[];
  /** In-scope keys with no row at all in Source B (a forgotten transcription). */
  expectedMissingFromB: string[];
  summary: { expected: number; matched: number; disagreements: number; pending: number; bOnly: number };
  clean: boolean;
}

function norm(s: string | null): string | null {
  if (s == null) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length ? t : null;
}
function eqScalar(a: string | null, b: string | null): boolean {
  return norm(a) === norm(b);
}
function normArr(xs: string[]): string[] {
  return xs.map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length > 0);
}
function eqOrdered(a: string[], b: string[]): boolean {
  const x = normArr(a);
  const y = normArr(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
function eqSet(a: string[], b: string[]): boolean {
  const x = [...normArr(a)].sort();
  const y = [...normArr(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
function pgKey(pg: "I" | "II" | "III" | null): string {
  return pg ?? "—";
}

/** Field-level comparison of one parser entry (A) against one transcription (B). */
export function compareEntry(a: HmtEntry, b: TranscribedRow): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  if (!eqSet(a.symbols, b.symbols)) diffs.push({ field: "symbols", sourceA: a.symbols, sourceB: b.symbols });
  if (!eqOrdered(a.psnAlternates, b.psnAlternates))
    diffs.push({ field: "psnAlternates", sourceA: a.psnAlternates, sourceB: b.psnAlternates });
  if (!eqScalar(a.italicText, b.italicText))
    diffs.push({ field: "italicText", sourceA: a.italicText, sourceB: b.italicText });
  if (!eqScalar(a.hazardClass, b.hazardClass))
    diffs.push({ field: "hazardClass", sourceA: a.hazardClass, sourceB: b.hazardClass });
  if (!eqSet(a.subsidiaryClasses, b.subsidiaryClasses))
    diffs.push({ field: "subsidiaryClasses", sourceA: a.subsidiaryClasses, sourceB: b.subsidiaryClasses });

  const aByPg = new Map<string, PgRow>(a.pgRows.map((p) => [pgKey(p.pg), p]));
  const bByPg = new Map<string, TranscribedPgRow>(b.pgRows.map((p) => [pgKey(p.pg), p]));
  const pgKeys = [...new Set([...aByPg.keys(), ...bByPg.keys()])].sort();
  for (const k of pgKeys) {
    const pa = aByPg.get(k);
    const pb = bByPg.get(k);
    const label = `pgRows[${k}]`;
    if (!pa) {
      diffs.push({ field: `${label} present`, sourceA: "(absent)", sourceB: "(transcribed)" });
      continue;
    }
    if (!pb) {
      diffs.push({ field: `${label} present`, sourceA: "(parsed)", sourceB: "(absent)" });
      continue;
    }
    if (!eqOrdered(pa.labelCodes, pb.labelCodes))
      diffs.push({ field: `${label}.labelCodes`, sourceA: pa.labelCodes, sourceB: pb.labelCodes });
    if (!eqOrdered(pa.specialProvisions, pb.specialProvisions))
      diffs.push({ field: `${label}.specialProvisions`, sourceA: pa.specialProvisions, sourceB: pb.specialProvisions });
    if (!eqScalar(pa.exceptionsRef ?? null, pb.exceptionsRef ?? null))
      diffs.push({ field: `${label}.exceptionsRef`, sourceA: pa.exceptionsRef ?? null, sourceB: pb.exceptionsRef ?? null });
    if (!eqScalar(pa.nonBulkPackagingRef ?? null, pb.nonBulkPackagingRef ?? null))
      diffs.push({ field: `${label}.nonBulkPackagingRef`, sourceA: pa.nonBulkPackagingRef ?? null, sourceB: pb.nonBulkPackagingRef ?? null });
    if (!eqScalar(pa.bulkPackagingRef, pb.bulkPackagingRef))
      diffs.push({ field: `${label}.bulkPackagingRef`, sourceA: pa.bulkPackagingRef, sourceB: pb.bulkPackagingRef });
    const aq = pa.quantityLimits ?? { passengerAircraftRail: null, cargoAircraft: null };
    if (!eqScalar(aq.passengerAircraftRail, pb.quantityLimits.passengerAircraftRail))
      diffs.push({
        field: `${label}.quantityLimits.passengerAircraftRail`,
        sourceA: aq.passengerAircraftRail,
        sourceB: pb.quantityLimits.passengerAircraftRail,
      });
    if (!eqScalar(aq.cargoAircraft, pb.quantityLimits.cargoAircraft))
      diffs.push({
        field: `${label}.quantityLimits.cargoAircraft`,
        sourceA: aq.cargoAircraft,
        sourceB: pb.quantityLimits.cargoAircraft,
      });
    const av = pa.vesselStowage ?? { location: null, other: [] };
    if (!eqScalar(av.location, pb.vesselStowage.location))
      diffs.push({ field: `${label}.vesselStowage.location`, sourceA: av.location, sourceB: pb.vesselStowage.location });
    if (!eqOrdered(av.other, pb.vesselStowage.other))
      diffs.push({ field: `${label}.vesselStowage.other`, sourceA: av.other, sourceB: pb.vesselStowage.other });
  }
  return diffs;
}

// ------------------------------------------------------------------ engine
export interface DiffOptions {
  sourceA?: HmtEntry[];
  sourceB?: TranscribedRow[];
  expectedKeys?: string[];
  sourceADate?: string | null;
}

export function diffAgainstTranscription(opts: DiffOptions = {}): DiffReport {
  const sourceA = opts.sourceA ?? defaultSourceA();
  const sourceB = (opts.sourceB ?? HAND_VERIFIED_ROWS).map((r) => transcribedRowSchema.parse(r));
  const expectedKeys = opts.expectedKeys ?? IN_SCOPE_ENTRIES.map(rowKey);

  const aByKey = new Map<string, HmtEntry>(sourceA.map((e) => [rowKey(e), e]));
  const bKeys = new Set(sourceB.map(rowKey));

  const rows: RowDiff[] = [];
  for (const b of sourceB) {
    const key = rowKey(b);
    const base = { key, idPrefix: b.idPrefix, idNumber: b.idNumber, psnPrinted: b.psnPrinted };
    if (b.status === "pending") {
      rows.push({ ...base, status: "pending", fieldDiffs: [], provenanceMissing: false });
      continue;
    }
    const provenanceMissing = norm(b.source) == null || norm(b.transcriber) == null;
    const a = aByKey.get(key);
    if (!a) {
      rows.push({ ...base, status: "b-only", fieldDiffs: [], provenanceMissing });
      continue;
    }
    const fieldDiffs = compareEntry(a, b);
    rows.push({ ...base, status: fieldDiffs.length ? "disagree" : "match", fieldDiffs, provenanceMissing });
  }

  const expectedMissingFromB = expectedKeys.filter((k) => !bKeys.has(k));
  const summary = {
    expected: expectedKeys.length,
    matched: rows.filter((r) => r.status === "match").length,
    disagreements: rows.filter((r) => r.status === "disagree").length,
    pending: rows.filter((r) => r.status === "pending").length,
    bOnly: rows.filter((r) => r.status === "b-only").length,
  };
  const anyProvenanceGap = rows.some((r) => r.status !== "pending" && r.provenanceMissing);
  const clean =
    expectedMissingFromB.length === 0 &&
    summary.disagreements === 0 &&
    summary.pending === 0 &&
    summary.bOnly === 0 &&
    !anyProvenanceGap &&
    summary.matched === expectedKeys.length;

  return { sourceADate: opts.sourceADate ?? null, rows, expectedMissingFromB, summary, clean };
}

// ------------------------------------------------------------------ report
function fmt(v: unknown): string {
  if (v == null) return "∅";
  if (Array.isArray(v)) return v.length ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]` : "[]";
  return JSON.stringify(v);
}

export function formatDiffReport(report: DiffReport): string {
  const L: string[] = [];
  L.push("# HazmatGuard §172.101 second-source diff (D5 v5)");
  L.push("");
  L.push(`- Source A: eCFR XML → \`parseHmtSection\`${report.sourceADate ? ` (as of ${report.sourceADate})` : ""}`);
  L.push("- Source B: independent human transcription of the official GovInfo Title-49 legal PDF");
  L.push(
    `- **Verdict: ${report.clean ? "CLEAN — release gate satisfied" : "NOT CLEAN — do not flip provisional→real"}**`,
  );
  L.push("");
  const s = report.summary;
  L.push(
    `Expected in-scope: ${s.expected} · matched: ${s.matched} · disagreements: ${s.disagreements} · ` +
      `pending: ${s.pending} · transcription-only: ${s.bOnly}`,
  );
  if (report.expectedMissingFromB.length) {
    L.push("");
    L.push(`⚠️ In-scope rows with NO transcription: ${report.expectedMissingFromB.join(", ")}`);
  }
  L.push("");
  for (const r of report.rows) {
    const tag =
      r.status === "match" ? "✓ match" :
      r.status === "pending" ? "… pending" :
      r.status === "b-only" ? "✗ transcription has no matching parsed row" :
      "✗ DISAGREE";
    L.push(`## ${r.idPrefix}${r.idNumber} — ${r.psnPrinted}  [${tag}]`);
    if (r.status !== "pending" && r.provenanceMissing) L.push("- ⚠️ missing audit provenance (source/transcriber)");
    for (const d of r.fieldDiffs) {
      L.push(`- \`${d.field}\`: A=${fmt(d.sourceA)}  B=${fmt(d.sourceB)}`);
    }
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

/**
 * Source A default: parse the FULL captured §172.101 XML if present (the real dataset input, kept
 * locally / gitignored), else the committed fuel slice. The in-scope entries are byte-identical in
 * both, so the diff result is the same — the slice just lets the gate run in CI without the 2.9 MB file.
 */
export function defaultSourceA(): HmtEntry[] {
  const xml = readFixture("section-172-101.xml") ?? readFixture("hmt-fuel-slice.xml");
  if (!xml) {
    throw new Error(
      "diff: no §172.101 fixture found. Run `npx tsx import/captureFixtures.ts`, or ensure " +
        "import/fixtures/hmt-fuel-slice.xml is present.",
    );
  }
  return parseHmtSection(xml);
}

// `npx tsx import/diff.ts` → print the live report, exit non-zero until the gate is clean.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = diffAgainstTranscription();
  process.stdout.write(formatDiffReport(report) + "\n");
  process.exit(report.clean ? 0 : 1);
}
