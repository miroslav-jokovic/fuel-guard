import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { imageIncomplete } from "./imageComplete.js";
import { AD_ASSET_MAX_BYTES, FORMAT_LABELS, FORMAT_MIMES, sniffFormat, type AdAssetFormat, type AdAssetRef } from "@silvicom/shared";

/**
 * The brand kit's files (workflow C1; D-AD10). The browser PUTs to a signed URL under
 * `<org>/incoming/<upload id>`; this file reads those bytes back ONCE, decides what they are from the
 * bytes themselves, and stores what the kit may refer to at `<org>/<sha256>.<ext>` (migration 0562).
 *
 * ── THE BYTES DECIDE, NOT THE NAME ─────────────────────────────────────────────────────────────────
 * `sniffFormat` (`@silvicom/shared` `documentFormats.ts`, the document reader's own sniff, imported from
 * the shared package so ads reaches no other feature's internals) answers for the raster formats and
 * PDF. The kit takes PNG, JPEG and WebP; a PDF called `logo.png` is refused as a PDF. SVG has no magic
 * number — it is text — so it is recognised by its root element, below.
 *
 * ── AN SVG IS RASTERISED, AND MAY NOT REACH OUTSIDE ITSELF ─────────────────────────────────────────
 * An SVG is a document, not a picture: it can name another file (`href`, `url(...)`, `@import`), declare
 * XML entities, or carry script. librsvg (inside sharp) resolves a relative or `file:` href against the
 * server's own disk, so an "image" could draw a server file into a logo. So an SVG is accepted only when
 * every reference is to its own `#fragment` or an embedded raster `data:` image, it declares no entity
 * and holds no script or foreignObject; it is then rasterised to a PNG (long edge 2048 px) and only the
 * PNG is stored. The renderer and the image model never see SVG.
 */

export const AD_ASSETS_BUCKET = "ad-assets";
const RASTER_LONG_EDGE = 2048;
const ACCEPTED: Record<string, AdAssetFormat> = { png: "png", jpeg: "jpeg", webp: "webp" };
const EXT: Record<AdAssetFormat, string> = { png: "png", jpeg: "jpg", webp: "webp" };

const incomingKey = (orgId: string, uploadId: string) => `${orgId}/incoming/${uploadId}`;
export const assetKey = (orgId: string, a: Pick<AdAssetRef, "sha256" | "format">) => `${orgId}/${a.sha256}.${EXT[a.format]}`;

export type AssetRefusal = { kind: "refused"; code: "unsupported_format" | "unsafe_svg" | "unreadable" | "too_large"; reason: string };
export type PreparedAsset = { kind: "ready"; bytes: Buffer; ref: AdAssetRef } | AssetRefusal;

const refuse = (code: AssetRefusal["code"], reason: string): AssetRefusal => ({ kind: "refused", code, reason });
const TAKES = "The brand kit takes PNG, JPEG, WebP or SVG.";

/** The text of a file that is an SVG document, or null. Leading BOM, XML declaration, comments and a plain doctype may precede the root. */
export function svgText(bytes: Uint8Array): string | null {
  if (bytes.subarray(0, 8192).includes(0)) return null;
  const text = Buffer.from(bytes).toString("utf8");
  const head = text.replace(/^\uFEFF/, "").replace(/^(\s|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*>)*/i, "");
  return /^<svg[\s>]/.test(head) ? text : null;
}

/** Why this SVG may not be rasterised, or null when it refers only to itself. */
export function svgHazard(text: string): string | null {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text)) return "it declares XML entities";
  if (/<script[\s>]/i.test(text)) return "it contains script";
  if (/<foreignObject[\s>]/i.test(text)) return "it embeds HTML (foreignObject)";
  if (/@import/i.test(text)) return "its style imports another file";
  const local = (v: string) => v.startsWith("#") || /^data:image\/(png|jpeg|webp);base64,/i.test(v);
  for (const m of text.matchAll(/\bhref\s*=\s*(["'])([\s\S]*?)\1/gi)) if (!local(m[2]!.trim())) return "it links to another file";
  for (const m of text.matchAll(/url\(\s*(["']?)([^)"']*)\1\s*\)/gi)) if (!local(m[2]!.trim())) return "it links to another file";
  return null;
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** From the uploaded bytes to what is stored, or the reason it is refused. Pure apart from decoding. */
export async function prepareAsset(bytes: Buffer): Promise<PreparedAsset> {
  if (bytes.length === 0) return refuse("unreadable", "The file is empty.");
  if (bytes.length > AD_ASSET_MAX_BYTES) return refuse("too_large", `The file is larger than ${AD_ASSET_MAX_BYTES / 1024 / 1024} MB.`);
  const sniffed = sniffFormat(bytes);
  const format = sniffed ? ACCEPTED[sniffed] : undefined;
  if (format) {
    // Completeness first, from the file's own structure: libvips's refusal of a cut-short file is not reliable
    // while other decodes fail in the same process (`imageComplete.ts` has the measurements).
    const broken = imageIncomplete(format, bytes);
    if (broken) return refuse("unreadable", `The file starts like a ${FORMAT_LABELS[sniffed!]} but cannot be read as one: ${broken}.`);
    try {
      // `stats()` decodes every pixel, so a truncated or corrupt file is refused here, not in the renderer.
      const img = sharp(bytes, { failOn: "error" });
      const [meta] = await Promise.all([img.metadata(), img.stats()]);
      if (!meta.width || !meta.height) return refuse("unreadable", "The image has no size.");
      return { kind: "ready", bytes, ref: { sha256: sha256(bytes), format, source_format: format, width: meta.width, height: meta.height, byte_size: bytes.length } };
    } catch {
      return refuse("unreadable", `The file starts like a ${FORMAT_LABELS[sniffed!]} but cannot be read as one.`);
    }
  }
  if (sniffed) return refuse("unsupported_format", `This file is a ${FORMAT_LABELS[sniffed]}, whatever its name says. ${TAKES}`);
  const svg = svgText(bytes);
  if (svg === null) return refuse("unsupported_format", `This file is not an image we can read. ${TAKES}`);
  const hazard = svgHazard(svg);
  if (hazard) return refuse("unsafe_svg", `This SVG cannot be used because ${hazard}. Export it again as plain shapes, or upload a PNG.`);
  try {
    const meta = await sharp(bytes).metadata();
    const long = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (!long) return refuse("unreadable", "The SVG has no size.");
    const density = Math.min(2400, Math.max(1, (72 * RASTER_LONG_EDGE) / long));
    const { data, info } = await sharp(bytes, { density, failOn: "error" }).png().toBuffer({ resolveWithObject: true });
    return { kind: "ready", bytes: data, ref: { sha256: sha256(data), format: "png", source_format: "svg", width: info.width, height: info.height, byte_size: data.length } };
  } catch {
    return refuse("unreadable", "The SVG cannot be drawn.");
  }
}

/** A signed URL the browser PUTs one file to. The id is the API's, so the key exists before any bytes do. */
export async function assetUploadUrl(admin: SupabaseClient, orgId: string, newId: () => string = randomUUID): Promise<{ upload_id: string; signed_url: string }> {
  const uploadId = newId();
  const { data, error } = await admin.storage.from(AD_ASSETS_BUCKET).createSignedUploadUrl(incomingKey(orgId, uploadId));
  if (error || !data) throw new Error(`ad-assets upload URL: ${error?.message ?? "no URL"}`);
  return { upload_id: uploadId, signed_url: data.signedUrl };
}

export type AcceptOutcome = { kind: "stored"; asset: AdAssetRef } | { kind: "not_found" } | AssetRefusal;

/**
 * Read what the browser uploaded, decide, store the accepted bytes by their hash, and remove the
 * incoming object either way — a refused file is not kept. Storing the same file twice finds the
 * object already there (content-addressed: same key, same bytes) and answers the same ref.
 */
export async function acceptAsset(admin: SupabaseClient, orgId: string, uploadId: string): Promise<AcceptOutcome> {
  const bucket = admin.storage.from(AD_ASSETS_BUCKET);
  const { data: blob, error } = await bucket.download(incomingKey(orgId, uploadId));
  if (error || !blob) return { kind: "not_found" };
  const prepared = await prepareAsset(Buffer.from(await blob.arrayBuffer()));
  if (prepared.kind === "ready") {
    const { error: upErr } = await bucket.upload(assetKey(orgId, prepared.ref), prepared.bytes, { contentType: FORMAT_MIMES[prepared.ref.format][0], upsert: false });
    if (upErr && !isAlreadyThere(upErr)) throw new Error(`ad-assets store: ${upErr.message}`);
  }
  await bucket.remove([incomingKey(orgId, uploadId)]);
  return prepared.kind === "ready" ? { kind: "stored", asset: prepared.ref } : prepared;
}

function isAlreadyThere(e: { message?: string; statusCode?: string | number }): boolean {
  return String(e.statusCode) === "409" || /already exists/i.test(e.message ?? "");
}

/**
 * The hashes among `refs` this org has not stored AS DESCRIBED — a version naming one is refused. The
 * ref arrives from the browser, so its size, dimensions and format are read again from the stored bytes
 * rather than trusted: a version's record of an asset is the asset's, not the page's. (`source_format`
 * cannot be re-read from a rasterised PNG; it is the upload's answer, carried as provenance.)
 */
export async function mismatchedAssets(admin: SupabaseClient, orgId: string, refs: readonly AdAssetRef[]): Promise<string[]> {
  const bucket = admin.storage.from(AD_ASSETS_BUCKET);
  const unique = [...new Map(refs.map((r) => [JSON.stringify(r), r])).values()];
  const bad = await Promise.all(unique.map(async (r) => {
    const { data: blob, error } = await bucket.download(assetKey(orgId, r));
    if (error || !blob) return r.sha256;
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (sha256(bytes) !== r.sha256 || bytes.length !== r.byte_size || sniffFormat(bytes) !== r.format) return r.sha256;
    const meta = await sharp(bytes).metadata().catch(() => null);
    return meta?.width === r.width && meta?.height === r.height ? null : r.sha256;
  }));
  return [...new Set(bad.filter((s): s is string => s !== null))];
}

/** An asset's bytes from `ad-assets`, refused (thrown) when the stored file is not the one the ref names. */
export async function readAdAsset(admin: SupabaseClient, orgId: string, ref: Pick<AdAssetRef, "sha256" | "format">): Promise<Buffer> {
  const { data: blob, error } = await admin.storage.from(AD_ASSETS_BUCKET).download(assetKey(orgId, ref));
  if (error || !blob) throw new Error(`ad-assets: ${ref.sha256} could not be read (${error?.message ?? "missing"})`);
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (sha256(bytes) !== ref.sha256) throw new Error(`ad-assets: ${ref.sha256} holds other bytes`);
  return bytes;
}

/**
 * Bytes we made (an overlay render, C5b) stored by their hash. The same bytes twice is the same file, so
 * "already exists" is success — a compose re-run after a crash stores nothing new.
 */
export async function storeAdAsset(admin: SupabaseClient, orgId: string, bytes: Buffer): Promise<AdAssetRef> {
  const prepared = await prepareAsset(bytes);
  if (prepared.kind !== "ready") throw new Error(`ad-assets: our own image was refused (${prepared.code})`);
  const { error } = await admin.storage.from(AD_ASSETS_BUCKET).upload(assetKey(orgId, prepared.ref), prepared.bytes, { contentType: `image/${prepared.ref.format}`, upsert: false });
  if (error && !/already exists|409/.test(`${error.message} ${(error as { statusCode?: unknown }).statusCode ?? ""}`)) throw new Error(`ad-assets: ${error.message}`);
  return prepared.ref;
}

