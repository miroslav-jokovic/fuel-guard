/**
 * `pnpm --filter @silvicom/api doc:bol-corpus -- --since 2026-10-03 [--until …] [--max-pages 300] [--out <dir>]`
 *
 * Builds the OCR training and test set from driver submissions (OCR-JUDGE-PLAN §8, owner 2026-11-02): from the
 * Samsara "BOL, SECURMENT, PLACARDS" document type, keep ONLY the photos that are shipping papers. That type
 * mixes BOL pages with photos of trailers, placards, seals and loaded cargo (measured: 109 of 196 photos in the
 * first corpus were not papers), and those have no place in an OCR set.
 *
 * ── HOW A PHOTO IS KEPT OR REFUSED ──────────────────────────────────────────────────────────────
 * Samsara serves no thumbnail, so each photo's bytes must be fetched to be judged. They are judged IN MEMORY by
 * the production OCR engine and `classifyPhotoText` (lib/bolPhotoFilter.ts) — no model call, no spend — and only a
 * photo judged `bol` is written to disk. A refused photo is never written; only its id, verdict and counts go in
 * `refused.jsonl`, so the filter's mistakes can be found and measured later without keeping the image.
 *
 * ── WHAT IT NEVER DOES ───────────────────────────────────────────────────────────────────────────
 * Writes to no database and nothing in Samsara (read-only token, read-only endpoint). Output stays under
 * `--out`, default the gitignored private corpus folder beside `doc:corpus`'s (a BOL carries names, seals and
 * signatures; this repository is public). Photo urls are used once and never stored (D-DR9). A document already
 * pulled is skipped, so a wider second run only adds.
 *
 * Output: <out>/<samsara document id>/pages/<n>.<ext> (BOL photos only), meta.json (who, when, truck, each kept
 * page's SHA-256, verdict counts and the UN/NA ids the OCR saw), and <out>/refused.jsonl. stdout: one JSON summary.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { parseSamsaraDocument } from "@silvicom/shared";
import { loadEnv } from "../env.js";
import { makeSamsaraDocumentsFetcher } from "../modules/samsara/lib/samsaraDocuments.js";
import { ocrEngine } from "../modules/document-reading/ocr/pageOcr.js";
import { judgePhoto } from "./lib/bolPhotoFilter.js";
import { photoUrls } from "./pullDocumentCorpus.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BOL_CORPUS_DIR = path.resolve(here, "../../../../packages/capture-engine/fixtures/real/private/bol-corpus");
const BOL_TYPE = "BOL, SECURMENT, PLACARDS";
const DAY_MS = 86_400_000;

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const extFor = (ct: string | null): string => (ct?.includes("png") ? "png" : ct?.includes("hei") ? "heic" : ct?.includes("webp") ? "webp" : "jpg");

async function main(): Promise<void> {
  const env = loadEnv();
  const token = env.SAMSARA_API_TOKEN;
  if (!token) throw new Error("SAMSARA_API_TOKEN is required (the read-only production token)");
  const since = Date.parse(arg("since") ?? "");
  const until = arg("until") ? Date.parse(arg("until")!) : Date.now();
  if (Number.isNaN(since) || Number.isNaN(until) || since >= until) throw new Error("--since YYYY-MM-DD [--until YYYY-MM-DD]");
  const maxPages = Number(arg("max-pages") ?? 300);
  const out = path.resolve(arg("out") ?? BOL_CORPUS_DIR);
  mkdirSync(out, { recursive: true });

  const fetcher = makeSamsaraDocumentsFetcher(env, token);
  const engine = ocrEngine({ cacheDir: env.DOC_OCR_CACHE_DIR ?? path.join(tmpdir(), "silvicom-ocr-models"), timeoutMs: 600_000 });
  const s = { documents: 0, skippedExisting: 0, photos: 0, kept: 0, keptHazmat: 0, refusedNotPaper: 0, refusedOtherPaper: 0, unreadable: 0, out };

  // Newest first: the most recent papers are the ones that look like what drivers send today.
  for (let end = until; end > since && s.kept < maxPages; end -= DAY_MS) {
    const window = { startIso: new Date(Math.max(since, end - DAY_MS)).toISOString(), endIso: new Date(end).toISOString() };
    for (const raw of await fetcher(window)) {
      if (s.kept >= maxPages) break;
      const doc = parseSamsaraDocument(raw);
      if (!doc || doc.document_type_name !== BOL_TYPE || doc.photo_count === 0) continue;
      const dir = path.join(out, doc.samsara_document_id);
      if (existsSync(dir)) { s.skippedExisting++; continue; }
      s.documents++;
      const urls = photoUrls(raw);
      const pages: unknown[] = [];
      for (const [i, photoId] of doc.photo_ids.entries()) {
        const url = urls.get(photoId);
        if (!url) continue;
        s.photos++;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`photo ${photoId}: HTTP ${res.status}`);
        const bytes = Buffer.from(await res.arrayBuffer());
        // Judged on a small upright copy, turned if it reads sideways (judgePhoto); the ORIGINAL bytes are what is kept.
        const v = await judgePhoto(bytes, engine, sharp);
        if (!v) { s.unreadable++; appendFileSync(path.join(out, "refused.jsonl"), JSON.stringify({ doc: doc.samsara_document_id, photoId, verdict: "unreadable" }) + "\n"); continue; }
        if (v.verdict !== "bol") {
          if (v.verdict === "not_paper") s.refusedNotPaper++; else s.refusedOtherPaper++;
          appendFileSync(path.join(out, "refused.jsonl"), JSON.stringify({ doc: doc.samsara_document_id, photoId, ...v }) + "\n");
          continue;
        }
        mkdirSync(path.join(dir, "pages"), { recursive: true });
        const file = `pages/${i + 1}.${extFor(res.headers.get("content-type"))}`;
        writeFileSync(path.join(dir, file), bytes);
        pages.push({ file, photoId, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, boxes: v.boxes, bolWords: v.bolWords, ids: v.ids, rotation: v.rotation });
        s.kept++;
        if (v.ids.length) s.keptHazmat++;
        if (s.kept >= maxPages) break;
      }
      if (pages.length) {
        const { fields: _fields, ...meta } = doc;
        writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ ...meta, pages }, null, 2) + "\n");
      }
      process.stderr.write(`${doc.samsara_document_id}: kept ${pages.length} of ${doc.photo_count} (total ${s.kept})\n`);
    }
  }
  process.stdout.write(JSON.stringify(s) + "\n");
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    process.stderr.write(`doc:bol-corpus failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
