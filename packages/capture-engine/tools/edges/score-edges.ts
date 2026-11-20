import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findDocument } from "../../src/enhance/findDocument";
import type { Quad } from "../../src/enhance/homography";
import type { RgbImage } from "../../src/enhance/raster";
import { parseLabels, type LabelEntry } from "../../src/edges/labels";
import { DOCALIGNER_MODEL, loadDocAligner } from "./docaligner";
import { PRECISION_BAR, scoreCase, summarise, summariseBy, type CaseResult, type Summary } from "../../src/edges/report";

/**
 * Score candidate edge detectors on a labelled photo set (LIVE-EDGE-DETECTION-PLAN.md step L1, §4.4).
 *
 *   pnpm --filter @silvicom/capture-engine edges:score -- --labels <labels.json> [--by <tag>] [--out report.json]
 *
 * Detectors scored, each on the same photographs:
 *   segmentation  Apple VNDetectDocumentSegmentationRequest — what the L0 camera runs (§4.5 candidate b)
 *   rectangles    Apple VNDetectRectanglesRequest with WeScan's settings — the classical baseline
 *   findDocument  our colour-region finder from the applicant photo cleanup (§4.5 candidate c's blob half)
 *   docaligner    DocAligner lcnet100 heatmap corner model (§4.5 candidate a), when its .onnx is present
 *                 at ~/.cache/silvicom-datasets/models/ or given with --model (see docaligner.ts)
 *
 * ⚠ macOS only: Apple's detectors run through `vision-detect.swift`, which also decodes every photo for
 * `findDocument`, so there is no JPEG decoder to add to this package. Not a CI step — the photographs it
 * reads are PII (`fixtures/real/private/`) or a 1 GB public download, and neither belongs in a runner.
 * The ARITHMETIC it relies on is in `src/edges/` and is tested in CI (`tests/edges.test.ts`).
 */

const HERE = dirname(fileURLToPath(import.meta.url));

interface Args {
  labels: string;
  by?: string;
  out?: string;
  limit?: number;
  model?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? fail(`${a} needs a value`);
    if (a === "--labels") args.labels = next();
    else if (a === "--by") args.by = next();
    else if (a === "--out") args.out = next();
    else if (a === "--limit") args.limit = Number(next());
    else if (a === "--model") args.model = next();
    else if (a === "--") continue;
    else fail(`unknown argument ${a}`);
  }
  if (!args.labels) fail("--labels <file> is required");
  return args as Args;
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(2);
}

interface VisionRecord {
  file: string;
  width?: number;
  height?: number;
  error?: string;
  ppm?: string;
  segmentation?: { corners: Quad; ms: number } | null;
  rectangles?: { corners: Quad; ms: number } | null;
}

function readPpm(path: string): RgbImage {
  const buf = readFileSync(path);
  const header = buf.subarray(0, 64).toString("latin1");
  const m = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(header);
  if (!m) throw new Error(`not a binary PPM: ${path}`);
  const width = Number(m[1]);
  const height = Number(m[2]);
  return { data: new Uint8Array(buf.subarray(m[0].length, m[0].length + width * height * 3)), width, height };
}

/** The PPM is the photo downscaled to ≤1,568 px; carry corners found on it back to the photo's own pixels. */
function toPhoto(quad: Quad | null, img: RgbImage, entry: LabelEntry): Quad | null {
  if (!quad) return null;
  const s = entry.width / img.width;
  return quad.map((p) => ({ x: p.x * s, y: p.y * s })) as unknown as Quad;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : Number.NaN;
}

function row(name: string, s: Summary, ms?: number): string {
  const f = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "—");
  const ok = (b: boolean) => (b ? "✓" : "✗");
  return [
    name.padEnd(22),
    String(s.photos).padStart(6),
    f(s.jaccardMean).padStart(8),
    f(s.jaccardMedian).padStart(8),
    f(s.jaccardP5).padStart(8),
    `${f(s.worstCornerMedianPx, 1)} ${ok(s.bar.median)}`.padStart(9),
    `${f(s.worstCornerP95Px, 1)} ${ok(s.bar.p95)}`.padStart(9),
    `${(s.missRate * 100).toFixed(1)}% ${ok(s.bar.miss)}`.padStart(9),
    `${s.falseOutlines} ${ok(s.bar.falseOutlines)}`.padStart(7),
    ms === undefined ? "" : `${ms.toFixed(1)} ms`.padStart(9),
  ].join(" ");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const labelsPath = resolve(args.labels);
  const base = dirname(labelsPath);
  const labels = parseLabels(JSON.parse(readFileSync(labelsPath, "utf8")));
  const entries = args.limit ? labels.entries.slice(0, args.limit) : labels.entries;

  // A label whose photo changed is a label for a different photograph: refuse it rather than score it.
  for (const e of entries) {
    const digest = createHash("sha256").update(readFileSync(join(base, e.file))).digest("hex");
    if (digest !== e.id) fail(`${e.file}: its bytes no longer match the label's id — relabel it`);
  }

  const work = mkdtempSync(join(tmpdir(), "edges-"));
  try {
    const bin = join(work, "vision-detect");
    execFileSync("swiftc", ["-O", "-o", bin, join(HERE, "vision-detect.swift")], { stdio: "inherit" });
    mkdirSync(join(work, "ppm"));
    const run = spawnSync(bin, ["--ppm-dir", join(work, "ppm")], {
      input: entries.map((e) => join(base, e.file)).join("\n") + "\n",
      maxBuffer: 1 << 30,
      encoding: "utf8",
    });
    if (run.status !== 0) fail(`vision-detect exited ${run.status}: ${run.stderr}`);
    const records = run.stdout.trim().split("\n").map((l) => JSON.parse(l) as VisionRecord);
    if (records.length !== entries.length) fail(`vision-detect answered ${records.length} of ${entries.length} photos`);

    const modelPath = args.model ?? join(homedir(), ".cache/silvicom-datasets/models", DOCALIGNER_MODEL);
    const docAligner = existsSync(modelPath) ? await loadDocAligner(modelPath) : null;
    if (!docAligner) console.log(`(docaligner skipped: no model at ${modelPath})`);

    const detectors: Record<string, { results: CaseResult[]; ms: number[] }> = {
      segmentation: { results: [], ms: [] },
      rectangles: { results: [], ms: [] },
      findDocument: { results: [], ms: [] },
      ...(docAligner ? { docaligner: { results: [], ms: [] } } : {}),
    };
    for (const [i, entry] of entries.entries()) {
      const rec = records[i]!;
      if (rec.error) fail(`${entry.file}: ${rec.error}`);
      if (rec.width !== entry.width || rec.height !== entry.height) {
        fail(`${entry.file}: upright size ${rec.width}x${rec.height} differs from the label's ${entry.width}x${entry.height}`);
      }
      for (const name of ["segmentation", "rectangles"] as const) {
        const hit = rec[name] ?? null;
        detectors[name]!.results.push(scoreCase(entry, hit?.corners ?? null));
        if (hit) detectors[name]!.ms.push(hit.ms);
      }
      if (!rec.ppm) fail(`${entry.file}: vision-detect wrote no pixels for it`);
      const img = readPpm(rec.ppm);
      let t = performance.now();
      const fd = toPhoto(findDocument(img)?.quad ?? null, img, entry);
      detectors.findDocument!.ms.push(performance.now() - t);
      detectors.findDocument!.results.push(scoreCase(entry, fd));
      if (docAligner) {
        t = performance.now();
        const da = toPhoto(await docAligner(img), img, entry);
        detectors.docaligner!.ms.push(performance.now() - t);
        detectors.docaligner!.results.push(scoreCase(entry, da));
      }
    }

    const head = `${"detector".padEnd(22)} ${"photos".padStart(6)} ${"JI mean".padStart(8)} ${"JI med".padStart(8)} ${"JI p5".padStart(8)} ${"corner".padStart(9)} ${"p95".padStart(9)} ${"missed".padStart(9)} ${"false".padStart(7)} ${"median".padStart(9)}`;
    console.log(`\n${labelsPath}\nbar (Q-LED3, proposed): median ≤ ${PRECISION_BAR.medianWorstCornerPx} px, p95 ≤ ${PRECISION_BAR.p95WorstCornerPx} px, missed ≤ ${PRECISION_BAR.maxMissRate * 100}%, false outlines ≤ ${PRECISION_BAR.maxFalseOutlines}; corner px at 1,568 long edge; ms = Mac, not phone\n`);
    console.log(head);
    const report: Record<string, unknown> = { labels: labelsPath, photos: entries.length, detectors: {} };
    for (const [name, d] of Object.entries(detectors)) {
      const s = summarise(d.results);
      console.log(row(name, s, median(d.ms.slice(1))));
      const by = args.by ? Object.fromEntries(summariseBy(d.results, args.by)) : undefined;
      (report.detectors as Record<string, unknown>)[name] = { summary: s, by, medianMs: median(d.ms.slice(1)) };
    }
    if (args.by) {
      for (const [name, d] of Object.entries(detectors)) {
        console.log(`\n${name} by ${args.by}`);
        console.log(head);
        for (const [k, s] of summariseBy(d.results, args.by)) console.log(row(`  ${k}`, s));
      }
    }
    if (args.out) {
      writeFileSync(args.out, JSON.stringify(report, null, 2) + "\n");
      console.log(`\nreport → ${args.out}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
