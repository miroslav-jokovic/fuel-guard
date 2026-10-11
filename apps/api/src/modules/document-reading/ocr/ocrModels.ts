import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The OCR engine's model files (DOCUMENT-READER-PLAN §7B A5, Q-DR22): PP-OCRv6 medium, the preset the spike
 * measured (45 of 49 true values on the office BOLs, ~3.8 s a page on CPU, where PP-OCRv5 server held 35).
 *
 * They are ~139 MB, so they are neither in the repository nor in the build: the first read that needs them
 * downloads them to `cacheDir` and every later read in that container finds them there (a deploy starts a
 * fresh container, so once per deploy). The library's own loader would fetch the same files from a moving
 * branch with no integrity check; this one pins the repository REVISION in the URL and the sha256 of every
 * file, so a changed or substituted file is refused, never run. The hashes are Hugging Face's own
 * `X-Linked-Etag` for these objects at this revision, checked against the spike's downloads.
 *
 * Licence: the models are Apache-2.0 (PaddleOCR; the mirror repository declares apache-2.0).
 */

const REVISION = "bf1d5edb0335d3262be7caf13f766ba274b4cadd";
const BASE = `https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/${REVISION}`;

export interface ModelFile { name: string; url: string; sha256: string; bytes: number }

export const OCR_MODEL_FILES = {
  detection: {
    name: "PP-OCRv6_medium_det.ort",
    url: `${BASE}/detection/ort/PP-OCRv6_medium_det.ort`,
    sha256: "b3fad30d6dde47fd015d92a10f6cddf5969d910c6460d2f9b82de59e97931738",
    bytes: 62_160_320,
  },
  recognition: {
    name: "PP-OCRv6_medium_rec.ort",
    url: `${BASE}/recognition/ort/PP-OCRv6_medium_rec.ort`,
    sha256: "14bf37252c87d2359764466c751d17787a28c9c5cbd5d64059a6f49b9dbd4ab4",
    bytes: 76_691_568,
  },
  charactersDictionary: {
    name: "ppocrv6_dict.txt",
    url: `${BASE}/recognition/ppocrv6_dict.txt`,
    sha256: "41557512862dfe31970cf22407742b629725461dd84c0d8771bde9c87c2202c8",
    bytes: 74_948,
  },
} as const satisfies Record<string, ModelFile>;

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/**
 * One model file's bytes: from `cacheDir` when a file there has the pinned hash, else downloaded, verified
 * and then cached. Written to a temporary name and renamed, so a crash mid-write leaves no file that a later
 * read would trust; a cached file whose hash is wrong is downloaded again.
 */
export async function modelFile(file: ModelFile, cacheDir: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const path = join(cacheDir, file.sha256.slice(0, 16), file.name);
  const cached = await readFile(path).catch(() => null);
  if (cached && sha256(cached) === file.sha256) return cached;
  const res = await fetchImpl(file.url);
  if (!res.ok) throw new Error(`OCR model ${file.name}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (sha256(bytes) !== file.sha256) throw new Error(`OCR model ${file.name}: sha256 does not match the pinned file`);
  await mkdir(join(cacheDir, file.sha256.slice(0, 16)), { recursive: true });
  const tmp = `${path}.${process.pid}.part`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
  return bytes;
}
