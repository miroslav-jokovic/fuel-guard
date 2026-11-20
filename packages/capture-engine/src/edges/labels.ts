import type { Quad } from "../enhance/homography";
import { polygonArea, selfIntersects } from "./score";

/**
 * The labelled photo set (LIVE-EDGE-DETECTION-PLAN.md step L1): for each photograph, where a person
 * says the document's corners are — or that there is no document in it.
 *
 * ── WHAT IS COMMITTED AND WHAT IS NOT ─────────────────────────────────────────────────────────
 * The PHOTOGRAPHS are PII (a bill of lading names a shipper, a consignee and a driver) and live under
 * `fixtures/real/private/`, which is gitignored for exactly this reason — see
 * `fixtures/real/README.md`. A label is four coordinates and a few words of description, so a label
 * file MAY be committed, and should be: it is hours of careful clicking, and a lost label file is a
 * lost benchmark. That is why an entry is keyed by the SHA-256 of the photo's bytes and the file name
 * is only a hint — a file name can carry a load number, and a hash carries nothing.
 *
 * ⚠ Do not put PII in `file` or in a tag: name the files by their hash or a counter when you copy them
 * in. The labeller (`tools/edges/label.html`) does this for you.
 *
 * ── PHOTOS WITH NO DOCUMENT ───────────────────────────────────────────────────────────────────
 * `document: null` is a deliberate entry, not a gap: a dashboard, an empty seat, a hand. The plan's bar
 * allows ZERO outlines on these (§4.4), because an outline drawn on an empty table invites a shutter
 * press that crops a photograph of nothing.
 */

export const LABELS_VERSION = 1;

export const DOCUMENT_KINDS = ["bol", "pod", "receipt", "cdl", "card", "letter", "form", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface LabelledDocument {
  /** In the photo's own pixels, upright (EXIF orientation applied), top-left / top-right / bottom-right / bottom-left. */
  corners: Quad;
  kind: DocumentKind;
}

export interface LabelEntry {
  /** SHA-256 (hex) of the photograph's bytes. */
  id: string;
  /** Path relative to the label file. A hint for finding the photo; `id` is what identifies it. */
  file: string;
  /** Upright size in pixels. */
  width: number;
  height: number;
  document: LabelledDocument | null;
  /** Free-form conditions to break results down by: `surface: "dashboard"`, `light: "night"`, `set: "smartdoc15/background03"`. */
  tags: Record<string, string>;
}

export interface LabelFile {
  version: typeof LABELS_VERSION;
  entries: LabelEntry[];
}

/** Parse and check a label file. Every refusal names the entry, so a bad click is found, not guessed at. */
export function parseLabels(json: unknown): LabelFile {
  const fail = (msg: string): never => {
    throw new Error(`labels: ${msg}`);
  };
  if (typeof json !== "object" || json === null) fail("not an object");
  const root = json as { version?: unknown; entries?: unknown };
  if (root.version !== LABELS_VERSION) fail(`version must be ${LABELS_VERSION}, got ${String(root.version)}`);
  if (!Array.isArray(root.entries)) fail("entries must be an array");
  const seen = new Set<string>();
  const entries = (root.entries as unknown[]).map((raw, i): LabelEntry => {
    const e = raw as Partial<LabelEntry> & { document?: unknown };
    const where = `entry ${i} (${typeof e.file === "string" ? e.file : "?"})`;
    if (typeof e.id !== "string" || !/^[0-9a-f]{64}$/.test(e.id)) fail(`${where}: id must be a sha256 hex digest`);
    if (seen.has(e.id!)) fail(`${where}: the same photograph is labelled twice`);
    seen.add(e.id!);
    if (typeof e.file !== "string" || e.file.length === 0) fail(`${where}: file is missing`);
    if (!(Number.isInteger(e.width) && e.width! > 0 && Number.isInteger(e.height) && e.height! > 0)) {
      fail(`${where}: width and height must be positive integers`);
    }
    const tags = e.tags ?? {};
    if (typeof tags !== "object" || Object.values(tags).some((v) => typeof v !== "string")) fail(`${where}: tags must be strings`);
    let document: LabelledDocument | null = null;
    if (e.document !== null) {
      const d = e.document as { corners?: unknown; kind?: unknown } | undefined;
      if (!d) fail(`${where}: document must be an object, or null for a photo with no document`);
      if (!DOCUMENT_KINDS.includes(d!.kind as DocumentKind)) fail(`${where}: kind must be one of ${DOCUMENT_KINDS.join(", ")}`);
      const c = d!.corners;
      if (!Array.isArray(c) || c.length !== 4) fail(`${where}: corners must be four points`);
      const corners = (c as unknown[]).map((p) => {
        const q = p as { x?: unknown; y?: unknown };
        if (typeof q?.x !== "number" || typeof q?.y !== "number" || !Number.isFinite(q.x) || !Number.isFinite(q.y)) {
          fail(`${where}: a corner is not a finite {x, y}`);
        }
        return { x: q.x as number, y: q.y as number };
      }) as unknown as Quad;
      // A crossed or collapsed outline is a mis-click, and scoring against it would grade every detector
      // against a shape no page has.
      if (selfIntersects(corners)) fail(`${where}: the corners cross — they must go top-left, top-right, bottom-right, bottom-left`);
      if (polygonArea(corners) < 0.01 * e.width! * e.height!) fail(`${where}: the outline covers under 1% of the photo`);
      document = { corners, kind: d!.kind as DocumentKind };
    }
    return { id: e.id!, file: e.file!, width: e.width!, height: e.height!, document, tags: tags as Record<string, string> };
  });
  return { version: LABELS_VERSION, entries };
}
