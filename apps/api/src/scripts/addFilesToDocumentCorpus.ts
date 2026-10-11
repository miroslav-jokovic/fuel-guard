/**
 * `pnpm --filter @silvicom/api doc:corpus:files -- <dir>` — add documents that arrived as FILES (an
 * office's scanned PDFs, a photo someone emailed) to the PRIVATE labelling corpus, beside the Samsara
 * documents `doc:corpus` pulls (DOCUMENT-READER-PLAN Step 0.2: "office PDFs added by hand").
 *
 * Each file goes through `normaliseSource` — the reader's own pages stage — and the corpus entry holds
 * its canonical pages, not the file: a labeller types from exactly the raster the model will read, so
 * a page the stage renders wrong (blank, sideways) is seen while labelling, not discovered as a low
 * score. The first ten office BOLs were all blank under normaliser 1.0.0; this is how that showed.
 *
 * Writes `packages/capture-engine/fixtures/real/private/documents/file-<sha256 prefix>/`: `source.<ext>`
 * (the bytes as received), `pages/<n>.png` (each page's lossless original), `meta.json` and a
 * `labels.json` skeleton. The folder is named by content hash, the key `document_sources` dedupes on, so
 * the same PDF under two names is one entry; an existing folder is skipped, and a labeller's work is
 * never overwritten. A file the stage refuses is reported with its refusal code and not added. Writes
 * nothing to any database and nothing outside the gitignored `private/` folder (a real BOL carries
 * names, seals and signatures; this repository is public).
 *
 * Progress goes to stderr; the one-line JSON summary is the only thing on stdout.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseSource, NORMALISER_VERSION, type NormaliseOutcome } from "../modules/document-reading/index.js";
import { CORPUS_DIR, labelsSkeleton } from "./pullDocumentCorpus.js";

/** The mime each extension claims; the stage sniffs the bytes and only records whether this matched. */
const DECLARED_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

export interface CorpusFileEntry {
  /** The folder name: `file-` and the first 16 hex of the source's sha256. */
  id: string;
  files: { name: string; bytes: Buffer }[];
}

/** One file → its corpus entry, or the stage's refusal. Pure apart from the stage itself. */
export async function corpusEntryFor(
  fileName: string,
  bytes: Buffer,
  normalise: (bytes: Buffer, mime: string) => Promise<NormaliseOutcome> = normaliseSource,
): Promise<{ ok: true; entry: CorpusFileEntry } | { ok: false; code: string }> {
  const ext = path.extname(fileName).toLowerCase();
  const out = await normalise(bytes, DECLARED_MIME[ext] ?? "application/octet-stream");
  if (!out.ok) return { ok: false, code: out.code };
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const pages = out.pages.map((p) => ({
    file: `pages/${p.page}.png`,
    sha256: p.original.sha256,
    width: p.original.width,
    height: p.original.height,
    dpi: p.dpi,
    textLayerWords: p.textLayer?.words.length ?? null,
  }));
  const meta = {
    source: { fileName, sha256, bytes: bytes.length, format: out.format, declaredMimeMatches: out.declaredMimeMatches },
    normaliserVersion: NORMALISER_VERSION,
    pages,
  };
  return {
    ok: true,
    entry: {
      id: `file-${sha256.slice(0, 16)}`,
      files: [
        { name: `source${ext || ".bin"}`, bytes },
        ...out.pages.map((p) => ({ name: `pages/${p.page}.png`, bytes: p.original.png })),
        { name: "meta.json", bytes: Buffer.from(JSON.stringify(meta, null, 2) + "\n") },
        { name: "labels.json", bytes: Buffer.from(JSON.stringify(labelsSkeleton(pages.map((p) => p.file)), null, 2) + "\n") },
      ],
    },
  };
}

async function main(): Promise<void> {
  const dir = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!dir || !statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error("usage: doc:corpus:files -- <dir>");
  const summary = { files: 0, saved: 0, skippedExisting: 0, refused: [] as string[], pages: 0, dir: CORPUS_DIR };
  for (const name of readdirSync(dir).sort()) {
    if (!(path.extname(name).toLowerCase() in DECLARED_MIME)) continue;
    summary.files += 1;
    const result = await corpusEntryFor(name, readFileSync(path.join(dir, name)));
    if (!result.ok) {
      summary.refused.push(`${name}: ${result.code}`);
      continue;
    }
    const target = path.join(CORPUS_DIR, result.entry.id);
    if (existsSync(target)) { summary.skippedExisting += 1; continue; }
    mkdirSync(path.join(target, "pages"), { recursive: true });
    for (const f of result.entry.files) writeFileSync(path.join(target, f.name), f.bytes);
    summary.saved += 1;
    summary.pages += result.entry.files.filter((f) => f.name.startsWith("pages/")).length;
    process.stderr.write(`saved ${name} → ${result.entry.id}\n`);
  }
  process.stdout.write(JSON.stringify(summary) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    process.stderr.write(`doc:corpus:files failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
