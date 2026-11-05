/**
 * OCR-JUDGE-PLAN.md step J0 — the offline spike. NOT product code: it never runs in the API, reads no database
 * and writes only to the output file given. It answers one question with numbers: on our own pages, does a
 * second OCR engine (MiniCPM-OCR 1.0) judged by MiniCPM-OCR Jev back more of the true row numbers than today's
 * row witness (PP-OCRv6, rowWitness.ts), WITHOUT ever backing a wrong one?
 *
 * It uses the production code for everything that is not the judge: the same OCR engine and prepared view
 * (ocr/pageOcr.ts), the same row rule (`rowOf`), and the same token rule (`rowShows`, the class-token exclusion
 * included). The judged lane therefore differs from the live witness ONLY in which transcript of the row it
 * reads — which is the whole of D-OJ2.
 *
 * Truth: a labels file of pages, each with its hazmat lines' true count / weight / quantity. A wrong value is
 * every one-digit substitution of the truth ("mutant") — the shape of every reader misread measured so far
 * (9 for 6 drums, 3,808 for 3,806 lb). A lane FALSE-BACKS a field when its transcript prints a mutant as a
 * whole token, because a reader who read that mutant would then be backed by the row.
 *
 * Usage (servers from the plan's §4 rig must be up):
 *   pnpm --filter @silvicom/api exec tsx src/scripts/judgeSpike.ts <labels.json> <out.json>
 *   env: OCR_URL (default http://127.0.0.1:18510), JEV_URL (default http://127.0.0.1:18500)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { PageRotation } from "@silvicom/shared";
import { ocrEngine } from "../modules/document-reading/ocr/pageOcr.js";
import { ocrPages } from "../modules/document-reading/ocr/pageOcr.js";
import { classTokens, rowOf, rowShows, type OcrItem, type OcrPage, type Row } from "../modules/document-reading/evidence/rowWitness.js";
import { pageBox } from "../modules/document-reading/evidence/pageGeometry.js";

type Field = "packageCount" | "grossWeightLb" | "quantity.value";
const FIELDS: Field[] = ["packageCount", "grossWeightLb", "quantity.value"];
interface Line { id: string; hazardClass: string; packageCount?: number; grossWeightLb?: number; "quantity.value"?: number; note?: string }
interface PageLabel { file: string; rotation: PageRotation; lines: Line[]; source?: string }
interface Labels { dir: string; pages: PageLabel[] }

const OCR_URL = process.env.OCR_URL ?? "http://127.0.0.1:18510";
const JEV_URL = process.env.JEV_URL ?? "http://127.0.0.1:18500";

/** The row's items as one transcript: lines by their vertical centre, left to right within a line. */
export function rowTranscript(items: readonly OcrItem[]): string {
  const sorted = [...items].sort((a, b) => a.box.y + a.box.height / 2 - (b.box.y + b.box.height / 2));
  const lines: OcrItem[][] = [];
  for (const it of sorted) {
    const mid = it.box.y + it.box.height / 2;
    const last = lines.at(-1);
    const lastMid = last ? last.reduce((s, i) => s + i.box.y + i.box.height / 2, 0) / last.length : -Infinity;
    if (last && Math.abs(mid - lastMid) < it.box.height * 0.5) last.push(it);
    else lines.push([it]);
  }
  return lines.map((l) => l.sort((a, b) => a.box.x - b.box.x).map((i) => i.text).join(" ")).join("\n");
}

/** Every one-digit substitution of the value as printed (thousands separators are not digits). */
export function mutants(v: number): number[] {
  const s = String(v);
  const out = new Set<number>();
  for (let i = 0; i < s.length; i++) {
    if (!/\d/.test(s[i]!)) continue;
    for (let d = 0; d <= 9; d++) {
      if (String(d) === s[i]) continue;
      const m = s.slice(0, i) + d + s.slice(i + 1);
      if (/^0\d/.test(m)) continue;
      out.add(Number(m));
    }
  }
  out.delete(v);
  return [...out];
}

/** A transcript as a one-item row, so `rowShows` judges it by exactly the live rule. */
const asRow = (text: string): Row => ({ page: 1, bbox: { x: 0, y: 0, w: 1, h: 1 }, items: [{ text, box: { x: 0, y: 0, width: 1, height: 1 } }] });

async function minicpm(png: Buffer): Promise<{ text: string | null; ms: number }> {
  const t0 = performance.now();
  const body = {
    model: "minicpm-ocr",
    temperature: 0,
    max_tokens: 1024,
    messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } },
      { type: "text", text: "Text Recognition:" },
    ] }],
  };
  try {
    const r = await fetch(`${OCR_URL}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    if (!r.ok) return { text: null, ms: performance.now() - t0 };
    const j = (await r.json()) as { choices: { message: { content: string } }[] };
    return { text: j.choices[0]?.message.content ?? null, ms: performance.now() - t0 };
  } catch {
    return { text: null, ms: performance.now() - t0 };
  }
}

interface Judged { scores: (number | null)[]; verdicts: string[]; ms: number }
async function jev(png: Buffer, candidates: string[]): Promise<Judged> {
  const t0 = performance.now();
  try {
    const r = await fetch(`${JEV_URL}/v1/rm/score_best`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input_form: "ternary", case_id: "row", image: png.toString("base64"), category: "text", candidates }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) return { scores: candidates.map(() => null), verdicts: candidates.map(() => `http_${r.status}`), ms: performance.now() - t0 };
    const j = (await r.json()) as { scores: number[]; verdicts: string[] };
    // D-OJ5: only "scored" is a score; 0.0 / -1.0 are the service's failure values.
    return { scores: j.scores.map((s, k) => (j.verdicts[k] === "scored" ? s : null)), verdicts: j.verdicts, ms: performance.now() - t0 };
  } catch (e) {
    return { scores: candidates.map(() => null), verdicts: candidates.map(() => `error:${(e as Error).message}`), ms: performance.now() - t0 };
  }
}

async function main(): Promise<void> {
  const [labelsPath, outPath] = process.argv.slice(2);
  if (!labelsPath || !outPath) throw new Error("usage: judgeSpike.ts <labels.json> <out.json>");
  const labels = JSON.parse(readFileSync(labelsPath, "utf8")) as Labels;
  const engine = ocrEngine({ cacheDir: process.env.DOC_OCR_CACHE_DIR ?? join(tmpdir(), "silvicom-ocr-models"), timeoutMs: 600_000 });
  await engine.warm();

  const rows: unknown[] = [];
  for (const page of labels.pages) {
    const original = readFileSync(join(labels.dir, page.file));
    const t0 = performance.now();
    const ocr = await ocrPages([{ originalPng: original, rotation: page.rotation }], engine);
    const ocrMs = performance.now() - t0;
    const upright = page.rotation === 0 ? original : await sharp(original).rotate(page.rotation).png().toBuffer();
    const meta = await sharp(upright).metadata();
    const W = meta.width!, H = meta.height!;
    const seen = new Map<string, number>();
    for (const line of page.lines) {
      const nth = seen.get(line.id) ?? 0;
      seen.set(line.id, nth + 1);
      const count = page.lines.filter((l) => l.id === line.id).length;
      const row = ocr ? rowOf(ocr, line.id, nth, count) : null;
      const base = { source: page.source ?? "office", file: page.file, id: line.id, nth, note: line.note ?? null, ocrMsPage: Math.round(ocrMs) };
      if (!row) {
        rows.push({ ...base, row: null });
        console.error(`${page.file} ${line.id}#${nth}: no row (abstain)`);
        continue;
      }
      const b = row.bbox;
      const crop = await sharp(upright)
        .extract({ left: Math.max(0, Math.floor(b.x * W)), top: Math.max(0, Math.floor(b.y * H)), width: Math.max(1, Math.min(W, Math.ceil(b.w * W))), height: Math.max(1, Math.min(H - Math.floor(b.y * H), Math.ceil(b.h * H))) })
        .png()
        .toBuffer();
      const paddle = rowTranscript(row.items);
      const mc = await minicpm(crop);
      const candidates = [paddle, ...(mc.text ? [mc.text] : [])];
      const judged = await jev(crop, candidates);
      const unprovable = classTokens(line.hazardClass);
      // The item lane (finding 1, 2026-11-02): one crop per printed text box of the row, read by both engines and
      // judged by Jev between them — Jev's intended input (one block, competing transcripts of it).
      const items = [];
      for (const it of row.items) {
        const ib = pageBox(ocr![row.page - 1] as OcrPage, it.box);
        const padX = 0.004, padY = 0.003;
        const left = Math.max(0, Math.floor((ib.x - padX) * W)), top = Math.max(0, Math.floor((ib.y - padY) * H));
        const width = Math.max(4, Math.min(W - left, Math.ceil((ib.w + 2 * padX) * W))), height = Math.max(4, Math.min(H - top, Math.ceil((ib.h + 2 * padY) * H)));
        const icrop = await sharp(upright).extract({ left, top, width, height }).png().toBuffer();
        const im = await minicpm(icrop);
        const cands = [it.text, ...(im.text ? [im.text.trim()] : [])];
        const ij = await jev(icrop, cands);
        items.push({ paddle: it.text, minicpm: im.text?.trim() ?? null, scores: ij.scores, verdicts: ij.verdicts, ms: Math.round(im.ms + ij.ms) });
      }
      const fields = FIELDS.filter((f) => line[f] !== undefined).map((f) => {
        const truth = line[f]!;
        const ms = mutants(truth);
        const judge = (text: string | null) =>
          text === null ? null : { truth: rowShows(asRow(text), truth, unprovable), mutants: ms.filter((m) => rowShows(asRow(text), m, unprovable)) };
        return { field: f, truth, unprovable: unprovable.includes(String(truth)), paddle: judge(paddle), minicpm: judge(mc.text) };
      });
      rows.push({ ...base, row: { bbox: b }, paddle, minicpm: mc.text, minicpmMs: Math.round(mc.ms), jev: judged, fields, items, unprovable, truth: Object.fromEntries(FIELDS.filter((f) => line[f] !== undefined).map((f) => [f, line[f]])) });
      console.error(`${page.file} ${line.id}#${nth}: jev ${judged.scores.map((s) => (s === null ? "—" : s.toFixed(3))).join(" / ")} (${Math.round(judged.ms)} ms), ocr ${Math.round(mc.ms)} ms`);
    }
  }
  writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), labels: labelsPath, rows }, null, 1));
  console.error(`wrote ${rows.length} rows → ${outPath}`);
  process.exit(0);
}

if (process.argv[1]?.endsWith("judgeSpike.ts")) void main();
