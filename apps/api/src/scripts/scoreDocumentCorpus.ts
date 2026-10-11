/**
 * `pnpm --filter @silvicom/api doc:score -- --run <name>` — score a reader against the labelled corpus
 * (DOCUMENT-READER-PLAN Step 0.4; the four numbers of §8). The arithmetic is `scoreCorpus` in
 * `@silvicom/shared` (`documentScoring.ts`); this file only finds the files and prints.
 *
 * ── WHAT IT READS ────────────────────────────────────────────────────────────────────────────────
 * Every `<dir>/<id>/labels.json` the corpus tool (`doc:corpus`, Step 0.2) wrote and the labellers filled
 * (Step 0.3), and, for the reader, a RECORDED output per document at `<dir>/<id>/runs/<name>.json`
 * (`readerOutputSchema`: the document, its evidence, its cost — or `readerFailureSchema`, `{ failure: {
 * code } }`, for a read that failed; a reader failure scores every field as not read, an operational one
 * is listed apart and left out of the numbers). A recorded run therefore re-scores for
 * free — a label correction, a scoring fix or a new band split costs no model call. Documents with no
 * `labelledBy` are skipped and counted; an invalid labels or run file is reported by id, never fatal.
 *
 * ── THE READER IS INJECTED ───────────────────────────────────────────────────────────────────────
 * `DocumentReader` is the seam a live reader (Step 0.5's shim over today's extractor, Step 3.1's model
 * pairs) plugs into; the only implementation here is `recordedRun`. A live reader should record what it
 * read to `runs/<name>.json` so its run is re-scorable like any other.
 *
 * Usage: pnpm --filter @silvicom/api doc:score -- --run baseline [--dir <corpus dir>] [--json]
 * stdout: the field and band tables, then ONE line of JSON summary (with `--json`, only that line).
 * stderr: progress and refusals. Writes nothing.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  scoreCorpus, type BandScore, type CorpusEntry, type CorpusScore, type FailedRead, type FieldScore,
} from "@silvicom/shared";
import { CORPUS_DIR } from "./pullDocumentCorpus.js";

export interface CorpusDocument {
  id: string;
  dir: string;
  /** The parsed `labels.json`, or `undefined` when it is missing or not JSON (then reported as invalid). */
  labels: unknown;
}

/** What produces a reader output for one corpus document. `undefined` = no output for this document. */
export interface DocumentReader {
  name: string;
  read(doc: CorpusDocument): Promise<unknown>;
}

/** A recorded run name is a file name, never a path — `--run ../../x` must not read outside the corpus. */
export const RUN_NAME_RX = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Unparseable JSON comes back as a value the schema refuses, so it is reported, not thrown. */
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { unreadable: file };
  }
}

export function loadCorpus(dir: string): CorpusDocument[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((id) => {
      const labelsFile = path.join(dir, id, "labels.json");
      return { id, dir: path.join(dir, id), labels: existsSync(labelsFile) ? readJson(labelsFile) : undefined };
    });
}

export function recordedRun(name: string): DocumentReader {
  if (!RUN_NAME_RX.test(name)) throw new Error(`--run must be a plain name, got "${name}"`);
  return {
    name,
    async read(doc) {
      const file = path.join(doc.dir, "runs", `${name}.json`);
      return existsSync(file) ? readJson(file) : undefined;
    },
  };
}

export async function scoreWith(reader: DocumentReader, docs: readonly CorpusDocument[]): Promise<CorpusScore> {
  const entries: CorpusEntry[] = [];
  for (const doc of docs) entries.push({ id: doc.id, labels: doc.labels, output: await reader.read(doc) });
  return scoreCorpus(entries);
}

// ── printing ───────────────────────────────────────────────────────────────────────────────────────
/** A rate with its own numerator and denominator beside it — no number is printed without its count. */
function rate(n: number, d: number): string {
  return d ? `${((100 * n) / d).toFixed(1)}% (${n}/${d})` : `— (0/0)`;
}

function bar(f: FieldScore): string {
  const g = f.graduation;
  if (f.falseAccepts > 0) return `no: ${f.falseAccepts} false accept(s)`;
  if (g.upperBound95 == null) return `no: N=0 of ${g.required}`;
  const ub = `≤${(100 * g.upperBound95).toFixed(2)}%`;
  return `${g.graduates ? "yes" : "no"}: N=${g.correctReads}/${g.required} ${ub} vs ${(100 * g.ceiling).toFixed(1)}%`;
}

function table(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const fmt = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  return [fmt(header), fmt(widths.map((w) => "-".repeat(w))), ...rows.map(fmt)].join("\n");
}

type Tallied = FieldScore | BandScore;
/** Accuracy, then the two columns that split it (owner's ruling, 2026-10-09): accuracy over printed
 * values only, and how often a blank label got a value — with the `read` subset of those beside it. */
const accuracyCells = (t: Tallied) => [
  rate(t.correct, t.fields), rate(t.printedCorrect, t.labelPresent),
  `${rate(t.invented, t.labelBlank)}, ${t.inventedRead} read`,
];
const ACCURACY_HEADS = ["accuracy", "printed acc", "invented"];

function bandRow(b: BandScore): string[] {
  return [
    b.band, String(b.documents), String(b.pages), ...accuracyCells(b), rate(b.falseAccepts, b.read),
    rate(b.read, b.fields), b.costPerPage == null ? "—" : `$${b.costPerPage.toFixed(4)} ($${b.usd.toFixed(2)}/${b.pages})`,
  ];
}

const failedList = (fs: readonly FailedRead[]) => (fs.length ? `: ${fs.map((f) => `${f.id} (${f.code})`).join(", ")}` : "");

export function formatScoreTables(s: CorpusScore): string {
  const fields = table(
    ["field", "crit", "docs", ...ACCURACY_HEADS, "false-accept", "yield", "D-DR5 bar"],
    s.fields.map((f) => [
      f.field, f.criticality, String(f.documents), ...accuracyCells(f), rate(f.falseAccepts, f.read),
      rate(f.read, f.fields), bar(f),
    ]),
  );
  const bands = table(["band", "docs", "pages", ...ACCURACY_HEADS, "false-accept", "yield", "cost/page"], s.bands.map(bandRow));
  const l = s.lines;
  const lines = `hazmat lines: ${l.labelled} labelled, ${l.matched} matched by key, ${l.missed} missed, ${l.extra} extra`;
  const d = s.documents;
  const failures = [
    `failed reads scored as not read: ${d.readerFailures.length}${failedList(d.readerFailures)}`,
    `operational failures, not scored: ${d.operationalFailures.length}${failedList(d.operationalFailures)}`,
  ].join("\n");
  return `${fields}\n\n${bands}\n\n${lines}\n${failures}\n`;
}

export function scoreSummary(run: string, dir: string, s: CorpusScore) {
  const all = s.bands.find((b) => b.band === "all");
  const engine = s.fields.filter((f) => f.criticality === "engine");
  return {
    run,
    dir,
    documents: s.documents,
    lines: s.lines,
    overall: all
      ? {
        fields: all.fields, accuracy: all.accuracy, falseAccepts: all.falseAccepts, read: all.read, falseAcceptRate: all.falseAcceptRate, yield: all.yield,
        labelPresent: all.labelPresent, printedCorrect: all.printedCorrect, printedAccuracy: all.printedAccuracy,
        labelBlank: all.labelBlank, invented: all.invented, inventedRead: all.inventedRead, inventedRate: all.inventedRate,
        pages: all.pages, usd: all.usd, costPerPage: all.costPerPage,
      }
      : null,
    engineFalseAccepts: engine.reduce((n, f) => n + f.falseAccepts, 0),
    graduating: s.fields.filter((f) => f.graduation.graduates).map((f) => f.field),
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const run = arg("run");
  if (!run) throw new Error("usage: doc:score -- --run <name> [--dir <corpus dir>] [--json]");
  const dir = path.resolve(arg("dir") ?? CORPUS_DIR);
  const reader = recordedRun(run);
  const docs = loadCorpus(dir);
  process.stderr.write(`doc:score: ${docs.length} corpus documents in ${dir}, run "${run}"\n`);
  const score = await scoreWith(reader, docs);
  const d = score.documents;
  const failed = (fs: readonly FailedRead[]) => fs.map((f) => `${f.id} (${f.code})`);
  for (const [what, ids] of [
    ["invalid labels.json", d.invalidLabels], ["no runs/" + run + ".json", d.missingOutputs], ["invalid run file", d.invalidOutputs],
    ["operational failure, not scored", failed(d.operationalFailures)],
  ] as const) {
    if (ids.length) process.stderr.write(`doc:score: ${what}: ${ids.join(", ")}\n`);
  }
  if (!process.argv.includes("--json")) process.stdout.write(formatScoreTables(score) + "\n");
  process.stdout.write(JSON.stringify(scoreSummary(run, dir, score)) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    process.stderr.write(`doc:score failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
