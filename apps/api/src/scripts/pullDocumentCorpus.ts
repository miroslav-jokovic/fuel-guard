/**
 * `pnpm --filter @silvicom/api doc:corpus` — copy real driver documents from Samsara into the PRIVATE
 * corpus folder for labelling (DOCUMENT-READER-PLAN Step 0.2; labels are Step 0.3).
 *
 * ── WHAT IT DOES, AND WHAT IT NEVER DOES ─────────────────────────────────────────────────────────
 * Reads `GET /fleet/documents` (read-only) for a date range and the document types asked for, and for
 * each document writes `packages/capture-engine/fixtures/real/private/documents/<samsara id>/` holding
 * the photos exactly as Samsara serves them (`pages/1.jpg`, …), a `meta.json` (who, when, which truck,
 * each page's SHA-256) and a `labels.json` skeleton for the two labellers. It writes NOTHING to any
 * database and nothing outside that folder. `private/` is gitignored before any file exists in it — a
 * real BOL carries shipper and consignee names, seal numbers and signatures, and this repository is
 * public (`fixtures/real/README.md`, the PII rule).
 *
 * The photo urls come from the same list response, so they are fresh; they are used once and never
 * stored (plan D-DR9). A document folder that already exists is skipped, so a second run with a wider
 * range only adds — a labeller's work in `labels.json` is never overwritten.
 *
 * Usage (the token is the production read-only one; nothing here can write to Samsara):
 *   SAMSARA_API_TOKEN=… pnpm --filter @silvicom/api doc:corpus -- --since 2026-09-01 --until 2026-10-08 \
 *     [--types "BOL, SECURMENT, PLACARDS|Proof of Delivery"] [--max 80]
 * Progress goes to stderr; the one-line JSON summary is the only thing on stdout.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSamsaraDocument, type SamsaraDocumentRow } from "@silvicom/shared";
import { loadEnv } from "../env.js";
import { makeSamsaraDocumentsFetcher } from "../modules/samsara/lib/samsaraDocuments.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CORPUS_DIR = path.resolve(here, "../../../../packages/capture-engine/fixtures/real/private/documents");
export const DEFAULT_TYPES = ["BOL, SECURMENT, PLACARDS", "Proof of Delivery"];
const DAY_MS = 86_400_000;

/**
 * The skeleton a labeller fills in, one per document. The sections are the plan's §2
 * `shippingDocument` contract; Step 1.1 writes that contract in Zod and validates these files with it.
 * Every value starts null — a label is what a person TYPED from the paper, and a pre-filled guess
 * would be agreed with rather than read. Each page's class and quality band are also the labeller's
 * (D-DR11: a BOL-type submission is mixed BOL, placard and securement photos).
 */
export function labelsSkeleton(pageFiles: string[]) {
  return {
    labelledBy: [] as string[],
    pages: pageFiles.map((file) => ({ file, class: null, band: null, assignedBy: null })),
    identity: { bolNumber: null, date: null, pageOf: null },
    parties: { shipper: null, consignee: null, billTo: null },
    references: { po: [], customer: [], consignee: [] },
    freight: { pieces: null, pallets: null, weight: null, weightUnit: null, seal: null, trailer: null },
    hazmat: { lines: [], emergencyPhone: null, shipperCertification: null, offeror: null },
    execution: { receiverSignaturePresent: null, receiverName: null, deliveredAt: null, osdNotations: [] },
    notes: "",
  };
}

/** Photo urls by id, from the RAW item (the parsed row deliberately carries ids only). Pure. */
export function photoUrls(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const fields = (raw as { fields?: unknown[] } | null)?.fields;
  for (const f of Array.isArray(fields) ? fields : []) {
    const photos = (f as { value?: { photoValue?: unknown[] } })?.value?.photoValue;
    for (const p of Array.isArray(photos) ? photos : []) {
      const { id, url } = (p ?? {}) as { id?: unknown; url?: unknown };
      if (typeof id === "string" && typeof url === "string") out.set(id, url);
    }
  }
  return out;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function extFor(contentType: string | null): string {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("heic") || contentType?.includes("heif")) return "heic";
  if (contentType?.includes("webp")) return "webp";
  return "jpg";
}

async function saveDocument(doc: SamsaraDocumentRow, urls: Map<string, string>): Promise<number> {
  const dir = path.join(CORPUS_DIR, doc.samsara_document_id);
  mkdirSync(path.join(dir, "pages"), { recursive: true });
  const pages: Array<{ file: string; photoId: string; sha256: string; bytes: number; contentType: string | null }> = [];
  for (const [i, photoId] of doc.photo_ids.entries()) {
    const url = urls.get(photoId);
    if (!url) continue;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`photo ${photoId}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const file = `pages/${i + 1}.${extFor(res.headers.get("content-type"))}`;
    writeFileSync(path.join(dir, file), bytes);
    pages.push({ file, photoId, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, contentType: res.headers.get("content-type") });
  }
  const { fields: _fields, ...meta } = doc;
  writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ ...meta, pages }, null, 2) + "\n");
  writeFileSync(path.join(dir, "labels.json"), JSON.stringify(labelsSkeleton(pages.map((p) => p.file)), null, 2) + "\n");
  return pages.length;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const token = env.SAMSARA_API_TOKEN;
  if (!token) throw new Error("SAMSARA_API_TOKEN is required (the read-only production token)");
  const since = Date.parse(arg("since") ?? "");
  const until = arg("until") ? Date.parse(arg("until")!) : Date.now();
  if (Number.isNaN(since) || Number.isNaN(until) || since >= until) throw new Error("--since YYYY-MM-DD [--until YYYY-MM-DD]");
  const types = new Set((arg("types") ?? DEFAULT_TYPES.join("|")).split("|"));
  const max = Number(arg("max") ?? 80);

  const fetcher = makeSamsaraDocumentsFetcher(env, token);
  const summary = { scanned: 0, saved: 0, skippedExisting: 0, skippedNoPhotos: 0, pages: 0, dir: CORPUS_DIR };
  for (let start = since; start < until && summary.saved < max; start += DAY_MS) {
    const window = { startIso: new Date(start).toISOString(), endIso: new Date(Math.min(start + DAY_MS, until)).toISOString() };
    for (const raw of await fetcher(window)) {
      if (summary.saved >= max) break;
      const doc = parseSamsaraDocument(raw);
      if (!doc || !types.has(doc.document_type_name)) continue;
      summary.scanned += 1;
      if (doc.photo_count === 0) { summary.skippedNoPhotos += 1; continue; }
      if (existsSync(path.join(CORPUS_DIR, doc.samsara_document_id))) { summary.skippedExisting += 1; continue; }
      summary.pages += await saveDocument(doc, photoUrls(raw));
      summary.saved += 1;
      process.stderr.write(`saved ${doc.samsara_document_id} (${doc.document_type_name}, ${doc.photo_count} photos)\n`);
    }
  }
  process.stdout.write(JSON.stringify(summary) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    process.stderr.write(`doc:corpus failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
