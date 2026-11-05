import { tokens, type OcrItem } from "../../modules/document-reading/evidence/rowWitness.js";

/**
 * Which Samsara photos are shipping papers (OCR-JUDGE-PLAN §8, owner 2026-11-02): the "BOL, SECURMENT, PLACARDS"
 * document type mixes BOL pages with photos of trailers, placards, seals and loaded cargo, and only the papers
 * belong in the OCR training and test set. Decided LOCALLY from the production OCR engine's own text boxes — no
 * model call, no spend — and only for corpus building: the reader keeps its own page classifier (P2,
 * classifyPages.ts), which this does not replace.
 *
 * Why text and not pixels. A placard carries a large 4-digit number and a trailer its unit number, so "has text"
 * is not enough; a BOL is the only photo in the set with many lines of small text AND the vocabulary of a
 * shipping paper (shipper, consignee, weight, description, hazardous, emergency contact…). A rate confirmation
 * or a printed login sheet has the text but not the vocabulary, and is refused as `other_paper`.
 *
 * Pure: the text boxes in, a verdict out.
 */

/** Words a shipping paper prints. Each counts once per page, however often it appears. */
const BOL_WORDS = [
  "LADING", "SHIPPER", "CONSIGNEE", "CONSIGNOR", "CARRIER", "WEIGHT", "DESCRIPTION", "HAZARDOUS", "PACKAGES",
  "PACKAGE", "PIECES", "PKGS", "PCS", "FREIGHT", "EMERGENCY", "CHEMTREC", "INFOTRAC", "PREPAID", "COLLECT", "NMFC",
  "PLACARDS", "SHIP", "SEAL", "TRAILER", "MANIFEST", "GROSS", "QTY", "QUANTITY", "DRUM", "DRUMS", "TOTE", "TOTES",
  "PALLET", "PALLETS", "CERTIFY", "PROPERLY", "CLASSIFIED", "DELIVERY", "SIGNATURE", "COD",
] as const;
/** Papers that are not shipping papers but share the vocabulary. One hit refuses the page. */
const NOT_BOL_PHRASES = ["RATE CONFIRMATION", "LOAD - RATE", "LOAD-RATE", "PASSWORD", "USERNAME", "SAFETY DATA SHEET", "SDS SHEET", "HAZARD IDENTIFICATION", "FIRST-AID MEASURES", "FIRST AID MEASURES"] as const;
const ID = /^(UN|NA)\d{4}$/;

export interface PhotoVerdict {
  verdict: "bol" | "other_paper" | "not_paper";
  /** Text boxes the engine found on the page. */
  boxes: number;
  /** Distinct shipping-paper words found. */
  bolWords: number;
  /** UN/NA ids printed as text on the page — a hazmat BOL when the verdict is `bol`. */
  ids: string[];
}

/** Thresholds, measured on the 196-photo corpus (2026-11-02, §8). Exported for the measurement script. */
export const MIN_BOXES = 10;
export const MIN_BOL_WORDS = 3;
const PHRASE_OVERRIDE_WORDS = 10;

export function classifyPhotoText(items: readonly OcrItem[], minBoxes = MIN_BOXES, minWords = MIN_BOL_WORDS): PhotoVerdict {
  const text = items.map((i) => i.text.toUpperCase()).join("\n");
  const words = new Set(text.match(/[A-Z]+/g) ?? []);
  const bolWords = BOL_WORDS.filter((w) => words.has(w)).length;
  const ids = [...new Set(items.flatMap((i) => tokens(i.text)).filter((t) => ID.test(t)))];
  const boxes = items.length;
  if (boxes < minBoxes) return { verdict: "not_paper", boxes, bolWords, ids };
  // A not-BOL phrase refuses only a page with little shipping vocabulary: a real BOL can print "USERNAME=… PASSWORD=…"
  // in its special instructions (AFCO's SDS login, measured 2026-11-02), while the rate confirmations and the login
  // printout in the corpus carry ≤ 5 of the words.
  if ((bolWords < PHRASE_OVERRIDE_WORDS && NOT_BOL_PHRASES.some((p) => text.includes(p))) || bolWords < minWords) return { verdict: "other_paper", boxes, bolWords, ids };
  return { verdict: "bol", boxes, bolWords, ids };
}

/** The long side the filter reads a photo at: enough for 10-pt print on a phone photo, ~4× fewer pixels than 4032. */
export const FILTER_LONG_SIDE = 1600;
/** Below this many text boxes the photo may be sideways (the engine reads nothing on a quarter-turned page). */
const SIDEWAYS_RETRY_BOXES = 10;

/**
 * Judge one photo: EXIF-upright, downscaled to FILTER_LONG_SIDE, read; if almost no text, read again turned a quarter
 * each way and keep the turn with the most boxes. `read` is the production engine (pageOcr.ts) or a test double.
 */
export async function judgePhoto(
  bytes: Buffer,
  read: (png: Buffer) => Promise<{ items: OcrItem[] } | null>,
  sharpLib: typeof import("sharp").default,
): Promise<(PhotoVerdict & { rotation: 0 | 90 | 270 }) | null> {
  const base = await sharpLib(bytes).rotate().resize({ width: FILTER_LONG_SIDE, height: FILTER_LONG_SIDE, fit: "inside", withoutEnlargement: true }).png().toBuffer().catch(() => null);
  if (!base) return null;
  let best: { items: OcrItem[]; rotation: 0 | 90 | 270 } | null = null;
  for (const rotation of [0, 90, 270] as const) {
    if (best && best.items.length >= SIDEWAYS_RETRY_BOXES) break;
    const png = rotation === 0 ? base : await sharpLib(base).rotate(rotation).png().toBuffer();
    const r = await read(png);
    if (r && (!best || r.items.length > best.items.length)) best = { items: r.items, rotation };
  }
  if (!best) return null;
  const first = classifyPhotoText(best.items);
  // A paper photographed small in the frame loses its print in the reduced copy (measured on the first live chunk,
  // 2026-11-02: 9 of 29 BOLs refused, most with text found but ≤ 2 shipping words). Any page that HAS text but was
  // not judged a BOL is read once more at full resolution, in the turn already found.
  if (first.verdict === "bol" || first.boxes < FULL_RES_RETRY_BOXES) return { ...first, rotation: best.rotation };
  const full = await sharpLib(bytes).rotate().rotate(best.rotation).png().toBuffer();
  const r = await read(full);
  const second = r ? classifyPhotoText(r.items) : first;
  return { ...(second.verdict === "bol" ? second : first), rotation: best.rotation };
}
const FULL_RES_RETRY_BOXES = 4;
