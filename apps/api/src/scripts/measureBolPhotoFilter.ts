/**
 * OCR-JUDGE-PLAN §8 — measure the BOL photo filter (lib/bolPhotoFilter.ts `judgePhoto`) against photos labelled by
 * eye. Runs in N parallel shards (one engine thread each), caches each verdict, then prints the score.
 *
 * Usage: pnpm --filter @silvicom/api exec tsx src/scripts/measureBolPhotoFilter.ts <truth.json> <photo dir> <cache dir> [--shards 4]
 *   truth.json: [{ file, label: "bol" | "not", note? }]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ocrEngine } from "../modules/document-reading/ocr/pageOcr.js";
import { judgePhoto, type PhotoVerdict } from "./lib/bolPhotoFilter.js";

type Truth = { file: string; label: "bol" | "not"; note?: string }[];
type Cached = (PhotoVerdict & { rotation: number; ms: number }) | { verdict: "unreadable"; ms: number };

async function shard(truth: Truth, dir: string, cacheDir: string, k: number, n: number): Promise<void> {
  const engine = ocrEngine({ cacheDir: join(tmpdir(), "silvicom-ocr-models"), timeoutMs: 600_000 });
  const file = join(cacheDir, `shard-${k}.json`);
  const cache: Record<string, Cached> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  for (const [i, t] of truth.entries()) {
    if (i % n !== k || cache[t.file]) continue;
    const t0 = performance.now();
    const v = await judgePhoto(readFileSync(join(dir, t.file)), engine, sharp);
    cache[t.file] = v ? { ...v, ms: Math.round(performance.now() - t0) } : { verdict: "unreadable", ms: Math.round(performance.now() - t0) };
    writeFileSync(file, JSON.stringify(cache));
  }
  process.exit(0);
}

async function main(): Promise<void> {
  const [truthPath, dir, cacheDir] = process.argv.slice(2);
  const truth = JSON.parse(readFileSync(truthPath!, "utf8")) as Truth;
  const si = process.argv.indexOf("--shard");
  if (si >= 0) {
    const [k, n] = process.argv[si + 1]!.split("/").map(Number);
    return shard(truth, dir!, cacheDir!, k!, n!);
  }
  mkdirSync(cacheDir!, { recursive: true });
  const n = Number(process.argv[process.argv.indexOf("--shards") + 1] || 4) || 4;
  const t0 = performance.now();
  const self = fileURLToPath(import.meta.url);
  await Promise.all(Array.from({ length: n }, (_, k) => new Promise<void>((res) => {
    spawn(process.execPath, [...process.execArgv, self, truthPath!, dir!, cacheDir!, "--shard", `${k}/${n}`], { stdio: "inherit" }).on("exit", () => res());
  })));
  const cache: Record<string, Cached> = Object.assign({}, ...readdirSync(cacheDir!).filter((f) => f.startsWith("shard-")).map((f) => JSON.parse(readFileSync(join(cacheDir!, f), "utf8"))));
  const ms = Object.values(cache).map((c) => c.ms).sort((a, b) => a - b);
  let tp = 0, fp = 0, fn = 0, tn = 0, hz = 0;
  const wrong: string[] = [];
  for (const t of truth) {
    const v = cache[t.file]!;
    const said = v.verdict === "bol";
    if (said && "ids" in v && v.ids.length) hz++;
    if (said && t.label === "bol") tp++;
    else if (said) { fp++; wrong.push(`LET IN  ${t.file} ${t.note ?? ""}`); }
    else if (t.label === "bol") { fn++; wrong.push(`MISSED  ${t.file} ${v.verdict} ${"boxes" in v ? `boxes=${v.boxes} words=${v.bolWords} rot=${v.rotation}` : ""}`); }
    else tn++;
  }
  console.log(`${truth.length} photos in ${Math.round((performance.now() - t0) / 1000)} s with ${n} workers; per photo median ${ms[Math.floor(ms.length / 2)]} ms, p90 ${ms[Math.floor(ms.length * 0.9)]} ms`);
  console.log(`BOL found ${tp}/${tp + fn}; non-BOL let in ${fp}/${fp + tn}; kept BOL pages printing a UN/NA id: ${hz}`);
  for (const w of wrong) console.log("  ", w);
  process.exit(0);
}

void main();
