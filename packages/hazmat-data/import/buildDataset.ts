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
import { defaultSourceA, diffAgainstTranscription, formatDiffReport } from "./diff.js";
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
  clean: boolean;
  diffReport: string;
}

/**
 * The full cut: parse Source A, load ERG, run the second-source gate, and assemble. `provisional` is
 * forced to `!diff.clean`. Writes `datasets/<version>.json` and returns the result + the diff report
 * (to be saved as `datasets/<version>/diff-report.md`).
 */
export function cutDataset(opts: {
  version: string;
  sourceEcfrDate?: string | null;
  effectiveDate?: string | null;
}): CutResult {
  const entries = defaultSourceA();
  const erg = loadErgEntries();
  // Placards/segregation from their own committed section fixtures; appendices from the full §172.101
  // file if present, else the frozen slices.
  const placards = parsePlacardTables(requireFixture("section-172-504.xml"));
  const segregation = parseSegregationGrid(requireFixture("section-177-848.xml"));
  const hazSubstances = parseHazSubstances(fixture("section-172-101.xml") ?? requireFixture("appendix-a-slice.xml"));
  const marinePollutants = parseMarinePollutants(fixture("section-172-101.xml") ?? requireFixture("appendix-b-slice.xml"));
  const diff = diffAgainstTranscription();
  const dataset = assembleDataset({
    version: opts.version,
    entries,
    erg,
    placards,
    segregation,
    hazSubstances,
    marinePollutants,
    provisional: !diff.clean,
    sourceEcfrDate: opts.sourceEcfrDate ?? null,
    sourceSecondaryRef:
      "GovInfo Title-49 legal PDF — independent human transcription (import/fixtures/handVerifiedRows.ts)",
    effectiveDate: opts.effectiveDate ?? null,
  });
  const path = datasetPath(`${opts.version}.json`);
  writeFileSync(path, JSON.stringify(dataset, null, 2) + "\n");
  return { dataset, path, clean: diff.clean, diffReport: formatDiffReport(diff) };
}

// `npx tsx import/buildDataset.ts <version> [sourceEcfrDate] [effectiveDate]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  if (!version) {
    process.stderr.write("usage: tsx import/buildDataset.ts <version> [sourceEcfrDate] [effectiveDate]\n");
    process.exit(2);
  }
  const res = cutDataset({
    version,
    sourceEcfrDate: process.argv[3] ?? null,
    effectiveDate: process.argv[4] ?? null,
  });
  const ds = res.dataset;
  process.stdout.write(
    [
      `Wrote ${res.path}`,
      `  version:      ${ds.version}`,
      `  provisional:  ${ds.provisional}  ${res.clean ? "(second-source gate CLEAN)" : "(gate NOT clean — see diff report)"}`,
      `  entries:      ${ds.entries.length}`,
      `  erg:          ${ds.erg.length}`,
      `  placards:     ${ds.placards.length}   segregation: ${ds.segregation.length}   hazSubstances: ${ds.hazSubstances.length}   marinePollutants: ${ds.marinePollutants.length}`,
      `  specialProvisions: ${ds.specialProvisions.length} (§172.102 parser still pending)`,
      `  checksum:     ${ds.checksum}`,
      "",
      `Next: save the diff report to datasets/${version}/diff-report.md, then register the version in`,
      `src/index.ts (RAW map + LATEST_DATASET_VERSION) and run the package tests.`,
      "",
    ].join("\n"),
  );
  process.exit(0);
}
