/**
 * OCR-JUDGE-PLAN.md J0 — the direct test of the one decision Jev would make for us: shown the printed box of a
 * row number and two transcripts that differ by one digit, does it score the TRUE one higher?
 *
 * For every labelled value, every box on the line's printed row (rowOf, as live) whose PaddleOCR text prints that
 * value as a token is cropped from the upright page, and Jev scores: the text as printed (truth) and the same text
 * with the value replaced by up to MAX_MUTANTS one-digit substitutions (the misreads measured so far: 9 for 6,
 * 3,808 for 3,806). Same crop, same boundaries (the model card's condition for comparing candidates).
 *
 * Usage: pnpm --filter @silvicom/api exec tsx src/scripts/judgeMutantProbe.ts <labels.json> <out.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { ocrEngine, ocrPages } from "../modules/document-reading/ocr/pageOcr.js";
import { pageBox } from "../modules/document-reading/evidence/pageGeometry.js";
import { rowOf, rowShows, type OcrPage, type Row } from "../modules/document-reading/evidence/rowWitness.js";
import { mutants } from "./judgeSpike.js";

const JEV_URL = process.env.JEV_URL ?? "http://127.0.0.1:18500";
const MAX_MUTANTS = 4;
/** Crop margin around the printed box, as a fraction of the page (PAD_X, PAD_Y) — J0 tuning of the crop Jev sees. */
const PAD_X = Number(process.env.PAD_X ?? 0.004), PAD_Y = Number(process.env.PAD_Y ?? 0.003);
const CATEGORY = process.env.CATEGORY ?? "text";
const SEED_RNG = (() => { let x = 42; return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); })();
const FIELDS = ["packageCount", "grossWeightLb", "quantity.value"] as const;
const asRow = (text: string): Row => ({ page: 1, bbox: { x: 0, y: 0, w: 1, h: 1 }, items: [{ text, box: { x: 0, y: 0, width: 1, height: 1 } }] });

/** Replace the printed form of `v` in `text` with `m`, keeping a thousands separator if the paper used one. */
function substitute(text: string, v: number, m: number): string | null {
  const plain = String(v);
  const withSep = v.toLocaleString("en-US", { maximumFractionDigits: 10 });
  const mSep = m.toLocaleString("en-US", { maximumFractionDigits: 10 });
  const re = (s: string) => new RegExp(`(?<![\\d.,])${s.replace(/[.,]/g, (c) => `\\${c}`)}(?![\\d])`);
  if (re(withSep).test(text)) return text.replace(re(withSep), mSep);
  if (re(plain).test(text)) return text.replace(re(plain), String(m));
  return null;
}

async function main(): Promise<void> {
  const [labelsPath, outPath] = process.argv.slice(2);
  const labels = JSON.parse(readFileSync(labelsPath!, "utf8")) as { dir: string; pages: { file: string; rotation: 0 | 90 | 180 | 270; source?: string; lines: Record<string, unknown>[] }[] };
  const engine = ocrEngine({ cacheDir: join(tmpdir(), "silvicom-ocr-models"), timeoutMs: 600_000 });
  await engine.warm();
  const out: unknown[] = [];
  for (const page of labels.pages) {
    const original = readFileSync(join(labels.dir, page.file));
    const ocr = await ocrPages([{ originalPng: original, rotation: page.rotation }], engine);
    if (!ocr) continue;
    const upright = page.rotation === 0 ? original : await sharp(original).rotate(page.rotation).png().toBuffer();
    const { width: W, height: H } = await sharp(upright).metadata();
    const seen = new Map<string, number>();
    for (const line of page.lines) {
      const id = line.id as string;
      const nth = seen.get(id) ?? 0;
      seen.set(id, nth + 1);
      const row = rowOf(ocr, id, nth, page.lines.filter((l) => l.id === id).length);
      if (!row) continue;
      for (const f of FIELDS) {
        const v = line[f] as number | undefined;
        if (v === undefined) continue;
        for (const it of row.items) {
          if (!rowShows(asRow(it.text), v)) continue;
          const cands = [it.text, ...mutants(v).slice(0, 40).map((m) => substitute(it.text, v, m)).filter((t): t is string => !!t && t !== it.text)];
          const pick = [cands[0]!, ...cands.slice(1).sort(() => 0.5 - SEED_RNG()).slice(0, MAX_MUTANTS)];
          if (pick.length < 2) continue;
          const b = pageBox(ocr[row.page - 1] as OcrPage, it.box);
          const left = Math.max(0, Math.floor((b.x - PAD_X) * W!)), top = Math.max(0, Math.floor((b.y - PAD_Y) * H!));
          const crop = await sharp(upright).extract({ left, top, width: Math.max(4, Math.min(W! - left, Math.ceil((b.w + 2 * PAD_X) * W!))), height: Math.max(4, Math.min(H! - top, Math.ceil((b.h + 2 * PAD_Y) * H!))) }).png().toBuffer();
          const r = await fetch(`${JEV_URL}/v1/rm/score_best`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input_form: "ternary", case_id: "m", image: crop.toString("base64"), category: CATEGORY, candidates: pick }), signal: AbortSignal.timeout(180_000) }).catch(() => null);
          const j = r?.ok ? ((await r.json()) as { scores: number[]; verdicts: string[] }) : null;
          const scores = j ? j.scores.map((s, k) => (j.verdicts[k] === "scored" ? s : null)) : pick.map(() => null);
          out.push({ source: page.source ?? "office", file: page.file, id, nth, field: f, truth: v, candidates: pick, scores });
          console.error(`${page.file} ${id} ${f}=${v}: ${scores.map((s) => (s === null ? "—" : s.toFixed(3))).join(" ")}  [${pick.join(" | ").slice(0, 90)}]`);
        }
      }
    }
  }
  writeFileSync(outPath!, JSON.stringify(out, null, 1));
  // Summary: truth ranked first; pairwise AUROC truth vs mutants; truth-above-threshold rates.
  const rows = out as { scores: (number | null)[] }[];
  const valid = rows.filter((r) => r.scores.every((s) => s !== null)) as { scores: number[] }[];
  const first = valid.filter((r) => r.scores[0]! > Math.max(...r.scores.slice(1))).length;
  let wins = 0, pairs = 0;
  for (const r of valid) for (const m of r.scores.slice(1)) { pairs++; wins += r.scores[0]! > m ? 1 : r.scores[0] === m ? 0.5 : 0; }
  const tv = valid.map((r) => r.scores[0]!).sort((a, b) => a - b);
  console.error(`\ntruth score median ${tv[Math.floor(tv.length / 2)]?.toFixed(3)}`);
  console.error(`probes ${rows.length}, fully scored ${valid.length}; truth ranked first ${first}/${valid.length}; pairwise AUROC ${(wins / Math.max(1, pairs)).toFixed(3)}`);
  for (const t of [0.5, 0.8, 0.9, 0.95]) {
    const truthPass = valid.filter((r) => r.scores[0]! >= t).length;
    const mutPass = valid.reduce((a, r) => a + r.scores.slice(1).filter((m) => m >= t).length, 0);
    console.error(`  @${t}: truth passes ${truthPass}/${valid.length}; mutants passing ${mutPass}/${pairs}`);
  }
  process.exit(0);
}

void main();
