/**
 * The OCR engine as a ROW-BOUND witness on a hazmat line's numbers (DOCUMENT-READER-PLAN §7B, step A5,
 * Q-DR22). Pure: it judges text boxes the OCR engine already produced (ocr/pageOcr.ts) and never runs it.
 *
 * Why row-bound and not "printed anywhere". Measured on the ten office BOLs (2026-10-11, PP-OCRv6 medium):
 * a whole-page presence check would have CONFIRMED Sonnet 4.6's wrong 9 drums on 0132900 — a "9" is
 * printed elsewhere on that page, as the hazard class. Bound to the printed row of the line's own UN id, the
 * same text confirmed 27 of 32 true counts and weights and rejected both wrong values (9 drums, 3,808 lb).
 *
 * What it may say. It only ever CHECKS a value a model reader gave — it reads no value of its own, because
 * open-source OCR alone scores far below the reader on real documents (§7B.1 P1, D-DR21). And it abstains,
 * rather than guessing, whenever the row is not unambiguous: no anchor, or a different number of printed
 * anchors than read lines carry that id (a header or a placard note naming the id again would otherwise
 * bind the line to the wrong row).
 *
 * Tokens and normalisation are the spike's, kept exactly so the measurement above still describes this code:
 * a thousands separator (comma, or a dot before three digits) is not a difference, "UN 1263" is "UN1263", and
 * a value matches a whole TOKEN, never a substring — so a "9" is not found inside "1789".
 *
 * One addition to the spike: a value that is also a token of the line's own hazard class is UNPROVABLE by
 * the row, because the basic description printed on that row carries the class ("UN2735, Amines…, 8, PG
 * II") — a reader that wrote 8 drums on a class 8 line would otherwise be backed by the class.
 */

export interface OcrBox { x: number; y: number; width: number; height: number }
export interface OcrItem { text: string; box: OcrBox }
/** One read page's OCR, in pixels of the upright original the engine was given. */
export interface OcrPage { page: number; width: number; height: number; items: OcrItem[] }

/** The fields a row witness judges: a line's numbers. Identifying fields stay with the table and the readers. */
export const ROW_JUDGED_KEYS = ["packageCount", "grossWeightLb", "quantity.value"] as const;

/** How far the row reaches above and below the anchor, in multiples of the anchor box's height. */
const ROW_ABOVE = 1.5;
const ROW_BELOW = 2.5;

const norm = (t: string) =>
  t.toUpperCase().replace(/(\d),(\d{3})/g, "$1$2").replace(/(\d)\.(\d{3})\b/g, "$1$2").replace(/\bUN\s+(\d{4})/g, "UN$1").replace(/\bNA\s+(\d{4})/g, "NA$1");
const tokens = (t: string): string[] => norm(t).match(/[A-Z]*\d+(?:\.\d+)?|[A-Z]+/g) ?? [];
// Two number tokens are the same printed value when they are the same number: "20030.00" is 20030, as
// 0134527 prints its weights (measured in A5's build; the spike's string match missed both).
const NUMBER = /^\d+(?:\.\d+)?$/;
const sameToken = (a: string, b: string) => a === b || (NUMBER.test(a) && NUMBER.test(b) && Number(a) === Number(b));

/** The id as an anchor token: "UN 1263" → "UN1263". Null when the read id is not an id-shaped token. */
export function anchorOf(idText: string | null | undefined): string | null {
  const t = tokens(idText ?? "");
  return t.length === 1 && /^(UN|NA)\d{4}$/.test(t[0]!) ? t[0]! : null;
}

export interface Row { page: number; bbox: { x: number; y: number; w: number; h: number }; items: OcrItem[] }

/**
 * The printed row of the `nth` (0-based) read line carrying `idText`, or null to abstain. `linesWithId` is
 * how many read lines carry that id: the printed anchors must number exactly that, else the row is ambiguous.
 */
export function rowOf(pages: readonly OcrPage[], idText: string | null | undefined, nth: number, linesWithId: number): Row | null {
  const id = anchorOf(idText);
  if (!id) return null;
  const anchors = pages
    .flatMap((p) => p.items.filter((i) => tokens(i.text).includes(id)).map((i) => ({ p, i })))
    .sort((a, b) => a.p.page - b.p.page || a.i.box.y - b.i.box.y);
  if (anchors.length !== linesWithId || !anchors[nth]) return null;
  const { p, i: a } = anchors[nth];
  const top = a.box.y - a.box.height * ROW_ABOVE;
  const bottom = a.box.y + a.box.height * (1 + ROW_BELOW);
  const items = p.items.filter((i) => {
    const mid = i.box.y + i.box.height / 2;
    return mid >= top && mid <= bottom;
  });
  const y = Math.max(0, top) / p.height;
  return { page: p.page, bbox: { x: 0, y, w: 1, h: Math.min(1, bottom / p.height) - y }, items };
}

/** Whether `value` is printed as a whole token on the row and is none of the `unprovable` tokens. */
export function rowShows(row: Row, value: unknown, unprovable: readonly string[] = []): boolean {
  if (typeof value !== "number" && typeof value !== "string") return false;
  const want = norm(String(value)).trim();
  return want !== "" && !unprovable.some((u) => sameToken(u, want)) && row.items.some((i) => tokens(i.text).some((t) => sameToken(t, want)));
}

/** The tokens of a line's hazard class(es) as printed — "3 (6.1)" → ["3", "6.1"] — which the row cannot prove. */
export const classTokens = (...hazardClass: (string | null | undefined)[]): string[] => hazardClass.flatMap((c) => tokens(c ?? ""));

/**
 * The row witness's word on one field: of the readers' candidate values, the ONE the row shows, or null when
 * it shows none of them or more than one (both "6" and "9" printed on the row backs neither), or the one it
 * shows is unprovable.
 */
export function rowBacks(row: Row, candidates: readonly unknown[], unprovable: readonly string[] = []): unknown {
  const distinct = [...new Map(candidates.filter((c) => c != null).map((c) => [norm(String(c)), c])).values()];
  const shown = distinct.filter((c) => rowShows(row, c, unprovable));
  return shown.length === 1 ? shown[0] : null;
}
