import { fitScale, inkBounds, padBounds } from "@/features/apply/signing/markRaster";

/**
 * The styles a driver may sign in, and the browser half that turns one into a PNG (C2, D-HUI14).
 *
 * ⚠ Read `markRaster.ts`'s header first — it carries the whole argument for why a mark is a picture
 * rather than a string, and the measurement that produced it.
 *
 * ── ⚠ WHY THE FACES ARE LOADED HERE AND NOT IN THE STYLESHEET ─────────────────────────────────
 * `signatureFaces.css` is imported dynamically by this module, so the four woff2 files are fetched the
 * first time somebody reaches the adoption screen and never on any other page. An applicant filling in
 * their work history should not be paying for a signature font, and the ceremony already asks them for
 * pdfjs and a 31-page PDF on the screen after this one.
 */

export interface MarkStyle {
  /** Stored in nothing and sent nowhere — the choice leaves this screen as pixels. */
  id: string;
  /**
   * What the driver reads in the picker.
   *
   * ⚠ Not the font's name. *"Dancing Script"* is a typographer's word for a thing a driver is choosing
   * by looking at it, and a list of four foundry names is a list of four things nobody can tell apart
   * without reading them. The label says what the hand looks like.
   */
  label: string;
  /** The `@font-face` family, exactly as `signatureFaces.css` declares it. */
  family: string;
  weight: number;
}

/**
 * Four, and four is a decision.
 *
 * ⚠ DocuSign offers around six; every one is another face to fetch on a truck-stop connection, and the
 * returns fall off fast because the choice is *"which of these looks most like my hand"* rather than a
 * typographic one. Four covers the range that matters — flowing, upright-handwritten, formal
 * copperplate, and a fine casual — and costs ~130 KB of latin.
 *
 * ⚠ **The first is the default and it is the most legible**, which is the right default for a document
 * a DOT auditor may read in ten years. Great Vibes is beautiful and Sacramento is fine-stroked; both
 * are reasonable choices for a driver to make deliberately and poor ones to make on their behalf.
 */
export const MARK_STYLES: readonly MarkStyle[] = [
  { id: "flowing", label: "Flowing", family: "Dancing Script", weight: 600 },
  { id: "handwritten", label: "Handwritten", family: "Caveat", weight: 600 },
  { id: "formal", label: "Formal", family: "Great Vibes", weight: 400 },
  { id: "fine", label: "Fine", family: "Sacramento", weight: 400 },
];

export const DEFAULT_MARK_STYLE_ID = MARK_STYLES[0]!.id;

/**
 * The style with this id, or the default.
 *
 * ⚠ Total rather than throwing, because the id can arrive from a control the driver is operating and a
 * signing ceremony is the wrong place to discover that a segmented control emitted something unexpected.
 */
export function markStyleById(id: string): MarkStyle {
  return MARK_STYLES.find((s) => s.id === id) ?? MARK_STYLES[0]!;
}

/**
 * The em size the name is drawn at before it is trimmed and scaled down.
 *
 * ⚠ Large on purpose. This is the resolution the carrier's packet is printed from — the overlay scales
 * the image to 18pt, so a mark rasterised at screen size arrives on paper as a blurred smear, which is
 * the same mistake `SignaturePad` avoids by scaling its backing store by the device pixel ratio.
 */
const RASTER_EM = 200;
/** Room for the swashes and descenders a script face puts outside its advance width. */
const RASTER_MARGIN = RASTER_EM;
/** Trimmed marks are downscaled to this long edge — plenty for 18pt, and far inside the 8 MB cap. */
const MAX_MARK_EDGE = 1200;
/** Kept so the antialiased tip of a descender survives the trim. See `padBounds`. */
const TRIM_PAD = 6;

/** Loaded once per page; `document.fonts` de-duplicates, but the import must not be re-awaited. */
let facesImported: Promise<unknown> | null = null;

/**
 * Put the four `@font-face` rules in the document, once.
 *
 * ⚠ **Exported because the PICKER needs them before any mark is rendered.** The style options show the
 * driver's name in each hand as CSS text, and a driver who has not typed anything yet gives
 * `renderStyledMark` nothing to do — so without this the list would show four rows in the generic
 * `cursive` fallback, which on most machines is one face repeated four times. A choice between four
 * identical rows is not a choice.
 */
export function loadSignatureFaces(): Promise<unknown> {
  facesImported ??= import("@/features/apply/signing/signatureFaces.css");
  return facesImported;
}

/**
 * Make the face available, and do not return until its glyphs are actually there.
 *
 * ⚠ **`document.fonts.load` is given the TEXT, and that is not optional.** `signatureFaces.css` splits
 * every face into latin and latin-ext by `unicode-range`, which is what stops a driver called Smith
 * downloading the extended file — but it also means the browser fetches a subset only when something
 * needs a character in it. Asking for the face alone loads latin; asking for the face *and this name*
 * is what loads the file that has the ć in it.
 *
 * ⚠ **And it is awaited before a single pixel is drawn.** A canvas drawn while the face is still in
 * flight captures the FALLBACK, silently, and the driver approves a preview of a signature the packet
 * will never carry — the exact failure `drawnMarkFailed` exists to prevent one step later, arriving by
 * a different door. `font-display: block` narrows the window; awaiting closes it.
 */
async function loadFace(style: MarkStyle, text: string): Promise<void> {
  await loadSignatureFaces();
  const spec = `${style.weight} ${RASTER_EM}px "${style.family}"`;
  try {
    await document.fonts.load(spec, text);
  } catch {
    // A browser that cannot report on its own fonts still draws them. Carrying on means the worst case
    // is a mark in the fallback face, which the driver is about to look at, rather than no mark at all.
  }
}

/**
 * Draw the name in the chosen hand and hand back the PNG the packet will print.
 *
 * Returns null when the browser cannot produce one — no 2D context, or `toBlob` refusing. ⚠ **Null is
 * a real answer and the caller must treat it as a failure to promise**, not as "use the typed name and
 * say nothing": that silence is precisely what A3 found and `drawnMarkFailed` was added to end.
 */
export async function renderStyledMark(text: string, style: MarkStyle): Promise<Blob | null> {
  const name = text.trim();
  if (!name) return null;
  await loadFace(style, name);

  const measuring = document.createElement("canvas").getContext("2d");
  if (!measuring) return null;
  const spec = `${style.weight} ${RASTER_EM}px "${style.family}", cursive`;
  measuring.font = spec;
  const advance = measuring.measureText(name).width;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(advance + RASTER_MARGIN * 2);
  canvas.height = RASTER_EM * 3;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = spec;
  ctx.textBaseline = "alphabetic";
  // ⚠ The same fixed ink as `SignaturePad`, and the token gate is waived on the same grounds: these
  // pixels never appear in the browser's own theme. They are re-encoded to a PNG and drawn onto a
  // printed white sheet, so a stroke that inherited a dark theme's foreground would arrive as a
  // near-white signature on white paper.
  ctx.fillStyle = "#1a1a1a"; // token-check-disable-line: canvas ink for a printed PNG, never a themed surface
  ctx.fillText(name, RASTER_MARGIN, RASTER_EM * 2);

  return trimToBlob(canvas, ctx);
}

/**
 * Crop a canvas to its ink, shrink it to fit, and encode it.
 *
 * ⚠ Shared by the styled and the uploaded mark, because the packet cannot tell them apart and neither
 * should this: both are a picture of somebody's signature that has to sit on an 18pt line without the
 * paper around it counting towards its height. See `inkBounds`.
 */
export async function trimToBlob(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): Promise<Blob | null> {
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const found = inkBounds(image.data, width, height);
  if (!found) return null;
  const box = padBounds(found, TRIM_PAD, width, height);
  const boxWidth = box.right - box.left + 1;
  const boxHeight = box.bottom - box.top + 1;

  const scale = fitScale(boxWidth, boxHeight, MAX_MARK_EDGE);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(boxWidth * scale));
  out.height = Math.max(1, Math.round(boxHeight * scale));
  const outCtx = out.getContext("2d");
  if (!outCtx) return null;
  outCtx.drawImage(canvas, box.left, box.top, boxWidth, boxHeight, 0, 0, out.width, out.height);

  return new Promise((resolve) => out.toBlob(resolve, "image/png"));
}
