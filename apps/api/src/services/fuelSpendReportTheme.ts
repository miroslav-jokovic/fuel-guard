/**
 * The fuel-spend report's design tokens.
 *
 * ── WHY THIS FILE EXISTS AND WHY IT IS NOT `dqBinder/pdfDraw` ────────────────────────────────────
 * `pdfDraw` carries the palette `defensePacket.ts` established — NAVY #1F3864 on Helvetica — and it
 * stays exactly as it is, because the documents it draws are EVIDENCE: a DQ binder is read by an
 * auditor beside the paper it was scanned from, and its job is to look like a filing.
 *
 * This document is a different genre. It is analytical, it is forwarded to somebody who will never
 * open the app, and every figure on it exists somewhere on a screen the sender was just looking at.
 * So its colours are not a second house style invented here — they are the PRODUCT's, lifted from
 * `packages/ui/src/tokens.generated.css` and `apps/web/src/features/dashboard/chartTheme.ts`, resolved
 * to hex because pdfkit cannot read a CSS variable and OKLCH is not a PDF colour space. A spend bar in
 * this PDF is the same green as the spend bar on the dashboard, on purpose.
 *
 * ── THE KNOWN DIVERGENCE ─────────────────────────────────────────────────────────────────────────
 * That leaves two palettes in one product: this one, and the binder's older navy. That is a real cost
 * and it is taken deliberately rather than by accident — closing it means re-theming a compliance
 * document whose look auditors already recognise, which is not this change's to do. Whoever does it
 * next should move the binder onto these tokens and delete the constants at the top of `pdfDraw`.
 *
 * ── WHY THE HEXES ARE PINNED RATHER THAN COMPUTED ───────────────────────────────────────────────
 * `chartTheme.ts` has the same problem and solved it the same way: canvas cannot read CSS variables
 * either. Sixteen of its nineteen fallbacks had silently drifted from the tokens by the time anybody
 * compared them (see `scripts/check-chart-colors.mjs`). These are pinned with the token they came from
 * named beside each one so the same comparison is possible by eye until a check exists for this file.
 */

/** Light mode only. A PDF has one surface and it is white. */
export const C = {
  // ── ink (tokens: --ink, --ink-secondary, --ink-muted, --ink-subtle) ───────────────────────────
  ink: "#252c35",
  inkSecondary: "#4b535f",
  inkMuted: "#5e6570",
  inkSubtle: "#838a94",
  inkInverse: "#ffffff",

  // ── surfaces and edges (tokens: --surface-subtle, --edge-subtle, --edge, --surface-inverse) ───
  surface: "#ffffff",
  wash: "#f7f9fc",
  hairline: "#e4e6ea",
  rule: "#d1d4da",
  inverse: "#181e29",

  /**
   * The identity mark: rules, section numerals, the letterhead spine. Never a data colour.
   *
   * `--viz-brand`, which is the purple the dashboard already uses for the brand series precisely so it
   * cannot be confused with a spend or a severity colour. The same reasoning holds in a document.
   */
  mark: "#955cad",
  markWash: "#f6f1f9",

  // ── data (tokens: --viz-spend, --viz-severity-*, --viz-cost-idle) ─────────────────────────────
  /** Money saved, contract honoured, a metric moving the right way. */
  good: "#019669",
  goodWash: "#e8f7f1",
  /** Money added, an overcharge, a policy exception. */
  bad: "#9f0712",
  badWash: "#fdeced",
  /** Measured-but-not-anybody's-fault: reducible idle, a carried-forward quote. */
  warn: "#aa530a",
  warnWash: "#fdf2e6",
  /** A series with no verdict attached — gallons, miles, coverage. */
  neutral: "#4f5763",
  neutralWash: "#eef0f3",
} as const;

/**
 * The type scale.
 *
 * ── WHY THERE IS ONE FAMILY AND WHY THAT IS NOT THE PROBLEM IT LOOKS LIKE ────────────────────────
 * Helvetica, because `winAnsi` exists: pdfkit's standard fonts are the only ones that need no font
 * binary and no licence in this repository, and that trade was made deliberately in `pdfDraw`. So
 * hierarchy here is carried by SIZE, WEIGHT, COLOUR and TRACKING rather than by a second family —
 * which is the harder discipline but not a worse document.
 *
 * The old report had ten sizes between 6.5 and 19 with no relationship between them. These are a
 * scale: each step is a legible jump at reading distance, and a section that wants an eleventh size
 * wants one of these instead.
 */
export const T = {
  display: 25,
  metric: 17,
  section: 12.5,
  subhead: 9.5,
  body: 9,
  small: 7.8,
  micro: 6.6,
} as const;

/**
 * Tracking for the small uppercase labels — eyebrows, KPI captions, column headers.
 *
 * Helvetica at 6.6pt in caps sets far too tight to read as a label; it reads as a smudge. A point of
 * letter-spacing is what turns it back into a word, and it is the single cheapest thing that separates
 * a document that looks designed from one that looks generated.
 */
export const TRACK_LABEL = 0.9;

export const GEOM = {
  /** Letter, in points — matching `pdfDraw` so a reader never gets two page sizes from one product. */
  pageWidth: 612,
  pageHeight: 792,
  margin: 54,
  /** Bottom of the last line of content, above the footer rule. */
  contentBottom: 792 - 54 - 22,
  radius: 3.5,
} as const;

export const CONTENT_W = GEOM.pageWidth - GEOM.margin * 2; // 504
