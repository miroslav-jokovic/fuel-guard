/**
 * Dataset assembler (Phase H1, deliverable 5 — the "cut" step of RELEASING.md).
 *
 * Composes a single versioned `Dataset` JSON from the verified sources and stamps it with a content
 * checksum + provenance. This is the ONE place a dataset is minted; `datasets/<version>.json` is never
 * hand-edited (the skeleton's own note says so). The `provisional` flag is NOT a free choice — it is
 * driven by the second-source gate: a dataset may only be stamped `provisional: false` when
 * `diffAgainstTranscription().clean` is true (every in-scope fuel row transcribed, audited, and in
 * agreement). Until then it ships `provisional: true` and the clear endpoint refuses to CLEAR any load
 * (H1.6/H4).
 *
 * What is populated today: `entries` (from `parseHmtSection` over the captured §172.101 XML) and `erg`
 * (from the frozen `datasets/erg2024.json`). `placards` (§172.504), `segregation` (§177.848),
 * `hazSubstances`/`marinePollutants` (§172.101 App. A/B) and `specialProvisions` (§172.102) have no
 * parser yet (later H1 deliverables) and assemble as empty arrays — the engine D4-fail-closes any
 * check that needs an absent table, so an empty table is safe, never a silent pass.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import {
  parseDataset,
  ergEntrySchema,
  type Dataset,
  type HmtEntry,
  type ErgEntry,
  type PlacardSpec,
  type SegregationCell,
  type HazSubstance,
  type MarinePollutant,
  type SpecialProvisionText,
} from "../src/schema.js";
import { z } from "zod";
import { defaultSourceA } from "./diff.js";
import { crossCheckAll, formatTriangulation, type TriangulationResult } from "./govinfoCrossCheck.js";
import { parsePlacardTables } from "./parsePlacards.js";
import { parseSegregationGrid } from "./parseSegregation.js";
import { parseHazSubstances, parseMarinePollutants } from "./parseAppendices.js";

export interface AssembleInput {
  version: string;
  entries: HmtEntry[];
  erg?: ErgEntry[];
  specialProvisions?: SpecialProvisionText[];
  placards?: PlacardSpec[];
  segregation?: SegregationCell[];
  hazSubstances?: HazSubstance[];
  marinePollutants?: MarinePollutant[];
  /** MUST be false only when the second-source diff is clean (see cutDataset / RELEASING.md). */
  provisional: boolean;
  sourceEcfrDate?: string | null;
  sourceSecondaryRef?: string | null;
  effectiveDate?: string | null;
}

/** Recursively key-sorted clone — makes the checksum independent of property order. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      o[k] = canonical((v as Record<string, unknown>)[k]);
    }
    return o;
  }
  return v;
}

/** Content checksum over everything EXCEPT the checksum field itself. */
export function datasetChecksum(content: Omit<Dataset, "checksum">): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(canonical(content))).digest("hex");
}

/** Build a validated, checksummed Dataset from its parts. Throws (via parseDataset) on any drift. */
export function assembleDataset(input: AssembleInput): Dataset {
  const content = {
    version: input.version,
    provisional: input.provisional,
    sourceEcfrDate: input.sourceEcfrDate ?? null,
    sourceSecondaryRef: input.sourceSecondaryRef ?? null,
    effectiveDate: input.effectiveDate ?? null,
    entries: input.entries,
    placards: input.placards ?? [],
    segregation: input.segregation ?? [],
    hazSubstances: input.hazSubstances ?? [],
    marinePollutants: input.marinePollutants ?? [],
    erg: input.erg ?? [],
    specialProvisions: input.specialProvisions ?? [],
  } satisfies Omit<Dataset, "checksum">;
  return parseDataset({ ...content, checksum: datasetChecksum(content) });
}

/** Recompute the checksum of an existing dataset and confirm it matches (integrity check). */
export function verifyChecksum(ds: Dataset): boolean {
  const { checksum, ...content } = ds;
  return checksum === datasetChecksum(content);
}

// ------------------------------------------------------------------ source loaders (script use)
function datasetPath(name: string): string {
  return fileURLToPath(new URL(`../datasets/${name}`, import.meta.url));
}

/** Load the frozen ERG UN→guide table (built once from the 2024 PDF). */
export function loadErgEntries(): ErgEntry[] {
  const raw = JSON.parse(readFileSync(datasetPath("erg2024.json"), "utf8")) as { entries?: unknown };
  return z.array(ergEntrySchema).parse(raw.entries ?? []);
}

function fixture(name: string): string | null {
  try {
    return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
  } catch {
    return null;
  }
}
function requireFixture(...names: string[]): string {
  for (const n of names) {
    const x = fixture(n);
    if (x) return x;
  }
  throw new Error(`buildDataset: none of the fixtures found: ${names.join(", ")} (run captureFixtures.ts).`);
}

export interface CutResult {
  dataset: Dataset;
  path: string;
  /** The automated D5 v7 mechanical gate: eCFR↔GovInfo triangulation clean across all three tables. */
  triangulationClean: boolean;
  /** Whether a named human attestation was supplied (required, with a clean gate, to ship non-provisional). */
  attested: boolean;
  triangulation: TriangulationResult;
  report: string;
}

/**
 * The full cut (D5 v7): parse Source A, load ERG, run the AUTOMATED eCFR↔GovInfo triangulation as the
 * mechanical second-source gate, and assemble. `provisional` is forced true unless BOTH (a) the
 * triangulation is clean across all three verified tables AND (b) a named human attestation of that
 * clean report is supplied (`attestedBy`). Fail-closed: a dirty gate can never ship non-provisional,
 * even with an attestation. Writes `datasets/<version>.json` and returns the triangulation report (to be
 * saved as `datasets/<version>/triangulation-report.md`).
 */
export function cutDataset(opts: {
  version: string;
  sourceEcfrDate?: string | null;
  effectiveDate?: string | null;
  /** Named human attestor of the clean triangulation report (+ PDF spot-check). Omit → provisional. */
  attestedBy?: string | null;
  attestedOn?: string | null;
}): CutResult {
  const entries = defaultSourceA();
  const erg = loadErgEntries();
  // Placards/segregation from their own committed section fixtures; appendices from the full §172.101
  // file if present, else the frozen slices.
  const placards = parsePlacardTables(requireFixture("section-172-504.xml"));
  const segregation = parseSegregationGrid(requireFixture("section-177-848.xml"));
  const hazSubstances = parseHazSubstances(fixture("section-172-101.xml") ?? requireFixture("appendix-a-slice.xml"));
  const marinePollutants = parseMarinePollutants(fixture("section-172-101.xml") ?? requireFixture("appendix-b-slice.xml"));

  const triangulation = crossCheckAll();
  const attested = !!(opts.attestedBy && opts.attestedBy.trim());
  const provisional = !(triangulation.allClean && attested);

  const t = triangulation;
  const attestClause = attested
    ? `; attested by ${opts.attestedBy} on ${opts.attestedOn ?? "(date not given)"}`
    : "; UNATTESTED (ships provisional)";
  const sourceSecondaryRef =
    `${t.hmt.sourceRef}; automated eCFR↔GovInfo triangulation (D5 v7) ` +
    `${t.allClean ? "ALL CLEAN" : "NOT CLEAN"} — HMT ${t.hmt.full.matched}/${t.hmt.totals.aKeys} keys, ` +
    `placards ${t.placards.matched}/${t.placards.aCount}, segregation ${t.segregation.matched}/${t.segregation.aCount}` +
    attestClause;

  const dataset = assembleDataset({
    version: opts.version,
    entries,
    erg,
    placards,
    segregation,
    hazSubstances,
    marinePollutants,
    provisional,
    sourceEcfrDate: opts.sourceEcfrDate ?? null,
    sourceSecondaryRef,
    effectiveDate: opts.effectiveDate ?? null,
  });
  const path = datasetPath(`${opts.version}.json`);
  writeFileSync(path, JSON.stringify(dataset, null, 2) + "\n");
  return { dataset, path, triangulationClean: triangulation.allClean, attested, triangulation, report: formatTriangulation(triangulation) };
}

// `npx tsx import/buildDataset.ts <version> [sourceEcfrDate] [effectiveDate] [--attested-by "Name"] [--attested-on YYYY-MM-DD]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1]!.startsWith("--")));
  const version = positional[0];
  if (!version) {
    process.stderr.write('usage: tsx import/buildDataset.ts <version> [sourceEcfrDate] [effectiveDate] [--attested-by "Name"] [--attested-on YYYY-MM-DD]\n');
    process.exit(2);
  }
  const res = cutDataset({
    version,
    sourceEcfrDate: positional[1] ?? null,
    effectiveDate: positional[2] ?? null,
    attestedBy: flag("--attested-by"),
    attestedOn: flag("--attested-on"),
  });
  const ds = res.dataset;
  const gate = res.triangulationClean
    ? res.attested
      ? "(triangulation CLEAN + attested → non-provisional)"
      : "(triangulation CLEAN but UNATTESTED → provisional; pass --attested-by to ship real)"
    : "(triangulation NOT CLEAN → provisional; reconcile before release)";
  process.stdout.write(
    [
      `Wrote ${res.path}`,
      `  version:      ${ds.version}`,
      `  provisional:  ${ds.provisional}  ${gate}`,
      `  entries:      ${ds.entries.length}`,
      `  erg:          ${ds.erg.length}`,
      `  placards:     ${ds.placards.length}   segregation: ${ds.segregation.length}   hazSubstances: ${ds.hazSubstances.length}   marinePollutants: ${ds.marinePollutants.length}`,
      `  specialProvisions: ${ds.specialProvisions.length} (§172.102 parser still pending)`,
      `  secondary:    ${ds.sourceSecondaryRef}`,
      `  checksum:     ${ds.checksum}`,
      "",
      `Next: save the triangulation report to datasets/${version}/triangulation-report.md, then register the`,
      `version in src/index.ts (RAW map + LATEST_DATASET_VERSION) and run the package tests.`,
      "",
    ].join("\n"),
  );
  process.exit(0);
}
