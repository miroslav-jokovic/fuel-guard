/**
 * The artwork J.J. Keller's page carries and OUR COPY OF IT DOES NOT — form 14834 (Rev. 1/22).
 *
 * The blank in `../assets/` is the carrier's own purchased form opened in Adobe Illustrator 30.7
 * and saved with the filled values removed. Four things did not survive that round trip, and every
 * one of them is printed ink on the paper the office has filed for years:
 *
 *   1. **all sixteen coloured section bands**, leaving fifteen white heading strings stranded on
 *      white paper and `1. BRAKE SYSTEM` gone from the file entirely;
 *   2. the **`OK` column heading**, from all three column groups (the ruled box survived);
 *   3. the **✓ in `VEHICLE IDENTIFICATION (✓ AND COMPLETE)`**, now a hollow .notdef box;
 *   4. the **✓ / X / NA marks on the INSTRUCTIONS legend**, leaving four bare red rules that
 *      explain nothing.
 *
 * (A fifth loss, the three AcroForm text fields, needs no artwork: the renderer stamps that block
 * as text like every other value.)
 *
 * This file is the measured position of each one, so the renderer can put them back on the
 * plain-paper path. It is deliberately SEPARATE from the coordinate map next door: that file says
 * where OUR values go, this one says what the template owes the page. If Keller reissues the form,
 * or a clean export ever replaces the blank, this is the file that stops being needed — and
 * `TEMPLATE_SUPPLIES` in the map is the switch that turns it off.
 *
 * Sources, in order of authority: the blank's own content stream (exact — operators, not pixels);
 * the office's filed trailer report scanned at 1.33 px/pt, for anything the blank no longer holds.
 */
import { PAGE_HEIGHT } from "./keller14834Rev0122.js";

/**
 * The sixteen section headings, and the coloured band each one is knocked out of.
 *
 * ── WHAT THE TEMPLATE ACTUALLY LOST, MEASURED 2026-09-01 ───────────────────────────────────────
 * The earlier reading of this — that Keller paints the headings in zero ink over a 0.48 pt red
 * hairline because the pad it ships is pre-printed — was wrong, and wrong in a way that put a
 * black heading on a white page where the form has white-on-red. What the blank's content stream
 * actually contains:
 *
 *   · **no `scn` operator anywhere**, and no CMYK. The page paints in `rg`/`RG` only, in four
 *     colours: near-black `0.137 0.122 0.125`, Keller red `0.933 0.212 0.251`, the pale column
 *     tint `0.992 0.918 0.89`, and white `1 1 1`;
 *   · **no red rule at any heading row.** The only red strokes on the page are the four blanks in
 *     the INSTRUCTIONS legend. There is no hairline for a heading to be knocked out of;
 *   · fifteen heading strings painted `1 1 1 rg` — white on nothing. `1. BRAKE SYSTEM` is absent
 *     from the file altogether.
 *
 * So the export did not preserve a design for pre-printed stock. It **dropped the sixteen filled
 * bands** and left the knockout text stranded on white paper. The band is artwork this file has to
 * put back, not something a Keller pad would supply — which is why it is drawn on the plain-paper
 * path and, as before, not onto a pad that already carries it (D-AVI8).
 *
 * ── THE BAND IS EXACT, BECAUSE THE FORM STILL RULES IT ─────────────────────────────────────────
 * Every band survives as its own two horizontal rules — the only rules on the page that span a
 * whole column group rather than stopping at the item text. They come in pairs **12.00 pt apart**,
 * sixteen of them, one per section, and `BAND_CENTRES` below is each pair's midpoint. That is a
 * measurement off the artwork we hold, not a reading of a scan.
 */
export const BAND_HEIGHT = 12;

/**
 * Keller red, read straight off the "VEHICLE COMPONENTS INSPECTED" bar in the same file — which is
 * drawn as a **12 pt stroked line**, the same construct and the same weight as a heading band. That
 * the one surviving coloured bar on the page is exactly 12 pt is the second, independent reason to
 * believe `BAND_HEIGHT`.
 */
export const KELLER_RED = { r: 0.933, g: 0.212, b: 0.251 } as const;

/**
 * The page's own rule: near-black, 0.5 pt (`0.137 0.122 0.125 RG` / `0.5 w`).
 *
 * A band has to be FRAMED, not just filled. Measured across band 1 on the office's filed report:
 * the two horizontal rules bounding the band survive across its whole width, and so do the four
 * group-boundary verticals (18.25 / 210 / 402 / 593.75) — while the internal column rules (33, 48,
 * 72) stop at the band and resume beneath it. Painting the band without redrawing that frame leaves
 * the section rows visibly unboxed, which is the difference a first pass shipped.
 */
export const RULE = { r: 0.137, g: 0.122, b: 0.125, width: 0.5 } as const;

/**
 * The three printed column groups' outer edges, from the page's own vertical rules.
 *
 * A band spans its group EDGE TO EDGE — across the OK / NEEDS REPAIR / REPAIRED DATE boxes as well
 * as the ITEM column, which is why the column rules stop at every heading row on the office's own
 * filed report and resume beneath it.
 */
export const COLUMN_GROUP_BOUNDS: readonly (readonly [number, number])[] = [
  [18.25, 210],
  [210, 402],
  [402, 593.75],
];

/**
 * Where the heading number starts, by column and by how many digits the number has.
 *
 * Two digits start **3.00 pt further left** than one — Keller's own `Td` says so (`-3.125` against
 * `-2.778` in the same em, at 8.64 pt), and the office's filed report measures the same. Column 3
 * carries an absolute `Tm` at x 459, which is where the 12–16 headings are read from directly.
 */
const HEADING_NUMBER_X: readonly (readonly [number, number])[] = [
  [78, 75],
  [270, 267],
  [462, 459],
];

/**
 * The gap from the number's origin to the title's, again from Keller's own operators rather than
 * from a ruler: `1.388/1.389 0 Td` for a one-digit number and `1.735 0 Td` for two, at 8.64 pt.
 *
 * This is why `1.  BRAKE SYSTEM` carries a visibly wide gap and `16. OTHER` carries a normal one —
 * the tab is fixed, so a short number leaves more air after its period.
 */
const HEADING_TITLE_TAB = [1.3885 * 8.64, 1.735 * 8.64] as const;

/**
 * Keller sets the headings at 8.64 pt wide by 9 pt tall (`8.64 0 -0 9 Tm` — a 96% condensation of
 * 9 pt type). pdf-lib has no horizontal-scale control, so they are drawn at **8.64 pt**, which
 * reproduces the width exactly and leaves the cap 0.25 pt short of Keller's. Width is what has to
 * be right: it is what decides whether a heading fits its band.
 */
export const HEADING_SIZE = 8.64;

/**
 * The baseline sits 3.26 pt above the band's centre.
 *
 * Derived rather than stored per heading: the sixteen baselines Keller's `Tm` operators give sit
 * between 3.22 and 3.32 pt above their own band's centre, so one constant reproduces every one of
 * them to within 0.06 pt and makes the band and the type it holds provably concentric. Sixteen
 * independent numbers could not be.
 */
export const HEADING_BASELINE_ABOVE_CENTRE = 3.26;

/** Each band's vertical centre, top-down — the midpoint of its own pair of full-width rules. */
const BAND_CENTRES: readonly (readonly [number, number, number])[] = [
  // [group number, column index, band centre]
  [1, 0, 283.04],
  [2, 0, 468.04],
  [3, 0, 555.04],
  [4, 0, 678.04],
  [5, 0, 738.04],
  [6, 1, 283.04],
  [7, 1, 367.04],
  [8, 1, 522.04],
  [9, 1, 586.04],
  [10, 1, 659.04],
  [11, 1, 710.04],
  [12, 2, 283.04],
  [13, 2, 329.04],
  [14, 2, 365.04],
  [15, 2, 401.04],
  [16, 2, 448.04],
];

export interface HeadingBand {
  readonly number: number;
  /** Which printed column group the band spans. */
  readonly column: number;
  /** The band rectangle, top-down: `[x0, x1]` and the top edge. */
  readonly x0: number;
  readonly x1: number;
  readonly top: number;
  readonly height: number;
  /** Where the number is drawn, and where its title starts. Both top-down baselines. */
  readonly numberX: number;
  readonly titleX: number;
  readonly baseline: number;
}

export const GROUP_HEADINGS: readonly HeadingBand[] = BAND_CENTRES.map(([number, column, centre]) => {
  const [x0, x1] = COLUMN_GROUP_BOUNDS[column]!;
  const digits = number >= 10 ? 1 : 0;
  const numberX = HEADING_NUMBER_X[column]![digits]!;
  return {
    number,
    column,
    x0,
    x1,
    top: centre - BAND_HEIGHT / 2,
    height: BAND_HEIGHT,
    numberX,
    titleX: numberX + HEADING_TITLE_TAB[digits]!,
    baseline: centre + HEADING_BASELINE_ABOVE_CENTRE,
  };
});

/**
 * Group 16 is the form's own "OTHER" box and has no catalogue entry — `INSPECTION_GROUPS` stops at
 * 15 because the first fifteen are Appendix A's component groups and the sixteenth is a free-text
 * field. The heading still has to print, so its title lives here, with the form it belongs to.
 */
export const OTHER_GROUP_TITLE = "Other";

/**
 * The `OK` column heading, which the export dropped from all three column groups.
 *
 * The ruled box survived and its label did not — the same failure as `1. BRAKE SYSTEM`, and unlike
 * its two neighbours (`NEEDS REPAIR`, `REPAIRED DATE`), which are still there at 4 pt. Measured off
 * the office's own filed report: the ink is **10.50 pt wide in all three groups**, which is
 * Helvetica-Bold "OK" at exactly 7 pt (regular is 10.12 and does not fit the measurement), sitting
 * on `ITEM`'s own baseline.
 *
 * The x is CENTRED in the OK column rather than stored three times: the three measured positions
 * are 2.25 / 2.58 / 2.67 pt in from their group's left edge, and centring lands within half a point
 * of each — which is inside the half-point a 1.33 px/pt scan can resolve.
 */
export const OK_COLUMN_HEADER = {
  size: 7,
  bold: true,
  /** `ITEM`'s baseline, from the template's own `8 0 -0 8 131.4438 571.9482 Tm`. */
  y: PAGE_HEIGHT - 571.9482,
  /** The OK box, from the page's vertical rules: the group's left edge to the next rule. */
  width: 14.75,
} as const;

/**
 * The three marks Keller prints on the INSTRUCTIONS legend to say what each column takes.
 *
 * Also lost. The four red blanks they sit on survived — they are the only red strokes left on the
 * page — so the marks go back **centred on their own rule**, which is where the filed report has
 * them to within 0.2 pt. Helvetica-Bold at the legend's own 7 pt: measured 4.5 pt for `X` (bold is
 * 4.67, regular 4.67) and 10.5 for `NA` (bold 10.11), and they are visibly heavier than the
 * sentence they sit in.
 *
 * The fourth blank, under REPAIRED DATE, carries no mark on the original and gets none here.
 */
export const LEGEND_MARKS = [
  { mark: "check", rule: [258.2, 282.2] },
  { mark: "X", rule: [300.2, 324.2] },
  { mark: "NA", rule: [384.3, 408.3] },
] as const satisfies readonly { mark: string; rule: readonly [number, number] }[];

export const LEGEND_MARK_SIZE = 7;
/** Top-down baseline: the marks sit 0.7 pt clear of their rule rather than on the legend's own. */
export const LEGEND_MARK_BASELINE = 776.35;

/**
 * The tick in `VEHICLE IDENTIFICATION (✓ AND COMPLETE)`.
 *
 * The glyph was a MyriadPro codepoint (`\037`) whose subset did not survive the export, so the page
 * prints a hollow .notdef box in the middle of a sentence. Its slot is exact: the label's line
 * starts at x 313.77 at 6 pt, `VEHICLE IDENTIFICATION (` measures 77.96 pt, and the operator that
 * resumes the sentence (`14.113 0 Td`) puts ` AND COMPLETE)` at 398.45 — so the tick occupies
 * 391.73 to 398.45, one em wide. Redrawn in ZapfDingbats, which is a standard-14 face and needs no
 * embedding.
 */
export const IDENTIFICATION_TICK = { x: 392.6, y: PAGE_HEIGHT - 639.8252, size: 7 } as const;
