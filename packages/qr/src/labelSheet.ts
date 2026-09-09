/**
 * Label-sheet geometry (D-INV25, `docs/plans/maintenance/INVENTORY-PLAN.md` I10).
 *
 * Where each label goes on a printed sheet, in PDF points. `apps/api` draws these numbers with
 * `lib/pdfDraw.ts`; the web preview renders the same numbers as SVG. One source, because I10's
 * done-when is a pixel comparison between the two and two geometries cannot be compared.
 *
 * ── POINTS, AND WHY ─────────────────────────────────────────────────────────────────────────────
 * PDF's user space is 72 units to the inch and pdfkit works in it directly, so points are the unit
 * that needs no conversion at the place where a mistake would be invisible. The presets below are
 * declared in inches, because that is how every vendor publishes them and a transcription error in
 * inches is legible in review, and converted once here.
 *
 * ── THE ORIGIN IS TOP-LEFT ──────────────────────────────────────────────────────────────────────
 * `y` grows downward, matching pdfkit and SVG. PDF's own native origin is bottom-left; converting
 * once at the drawing call is one subtraction, while a geometry module that speaks two coordinate
 * conventions is a bug generator.
 *
 * ── THESE NUMBERS WERE VERIFIED, NOT RECALLED ───────────────────────────────────────────────────
 * Each preset's arithmetic closes: left margin + n × pitch − gap + label = sheet width, and the same
 * vertically, with both margins coming out equal. That symmetry check is what resolves the one
 * ambiguity in the published sources — several vendor spec tables report "labels across" and
 * "labels down" transposed, and for each preset here only one orientation fits the sheet at all.
 * It is asserted in the tests rather than trusted.
 *
 * What this cannot establish is which stock the shop actually owns; that is assumption A5, retired
 * at I10 against a printed sheet. The X/Y nudge exists for PRINTER drift (Avery's own guidance:
 * a uniform shift is a nudge, a progressive drift is a scaling problem) and must not be used to
 * paper over a preset whose nominal geometry is wrong.
 */

export const POINTS_PER_INCH = 72;
const inches = (n: number): number => n * POINTS_PER_INCH;

export const LABEL_PRESET_IDS = [
  "avery-22805",
  "avery-22816",
  "avery-5160",
  "avery-5520",
  "roll-single",
] as const;
export type LabelPresetId = (typeof LABEL_PRESET_IDS)[number];

export interface LabelPreset {
  id: LabelPresetId;
  /** What the shop calls it when buying more. */
  name: string;
  /** Sheet dimensions in points. */
  sheet: { width: number; height: number };
  /** One label's dimensions in points. */
  label: { width: number; height: number };
  /** Distance from the sheet's top-left to the first label's top-left, in points. */
  margin: { left: number; top: number };
  /** Left-edge to left-edge, and top-edge to top-edge, in points. */
  pitch: { x: number; y: number };
  columns: number;
  rows: number;
  /** What the stock survives, so the label screen can say it (§2.4). */
  material: string;
}

/**
 * The five presets. No designer and no custom sizes (D-INV25) — Cheqroom's in-app designer is
 * described by its own users as "a frustrating version of excel", and a shop needs five known-good
 * sheets far more than it needs a canvas.
 */
export const LABEL_PRESETS: Record<LabelPresetId, LabelPreset> = {
  /**
   * Avery 22805 — 1½" square, 24 to a sheet in 4 columns × 6 rows.
   *
   * The bin-and-shelf default. 24 up means one sheet re-labels a whole aisle, and 1½" leaves a
   * version-2 symbol at roughly 1.16 mm per module — three times the phone-camera floor — with room
   * for the `display_no` printed beneath it.
   *
   * Note the count: this is 24 per sheet, not 12. It was checked against the vendor's own product
   * page rather than assumed from the label size.
   */
  "avery-22805": {
    id: "avery-22805",
    name: "Avery 22805 — 1½\" square, 24 per sheet",
    sheet: { width: inches(8.5), height: inches(11) },
    label: { width: inches(1.5), height: inches(1.5) },
    margin: { left: inches(0.78125), top: inches(0.5) },
    pitch: { x: inches(1.8125), y: inches(1.7) },
    columns: 4,
    rows: 6,
    material: "Thermal-transfer polyester with matte laminate. Adhesive paper fails in 60–90 days in a shop.",
  },

  /** Avery 22816 — 2" square, 12 to a sheet in 3 columns × 4 rows. For a shelf read at a distance. */
  "avery-22816": {
    id: "avery-22816",
    name: "Avery 22816 — 2\" square, 12 per sheet",
    sheet: { width: inches(8.5), height: inches(11) },
    label: { width: inches(2), height: inches(2) },
    margin: { left: inches(0.625), top: inches(0.645) },
    pitch: { x: inches(2.625), y: inches(2.57) },
    columns: 3,
    rows: 4,
    material: "Thermal-transfer polyester with matte laminate.",
  },

  /**
   * Avery 5160 — the 1" × 2⅝" address label, 30 to a sheet in 3 columns × 10 rows.
   *
   * The one preset that is not square, and it is here because it is the sheet every office already
   * has in a drawer. The symbol is set in the 1" height and the text sits beside it, which is the
   * only layout that fits a scannable QR on a one-inch-tall label.
   */
  "avery-5160": {
    id: "avery-5160",
    name: "Avery 5160 — 1\" × 2⅝\" address, 30 per sheet",
    sheet: { width: inches(8.5), height: inches(11) },
    label: { width: inches(2.625), height: inches(1) },
    margin: { left: inches(0.1875), top: inches(0.5) },
    pitch: { x: inches(2.75), y: inches(1) },
    columns: 3,
    rows: 10,
    material: "Paper. Office use only — it will not survive a bay.",
  },

  /**
   * Avery 5520 — the weatherproof stock on the 5160 template. Same geometry, different film.
   *
   * Kept as its own preset rather than an alias so the label screen can name the right box to buy;
   * the geometry being identical is asserted in the tests, so the two cannot silently drift.
   */
  "avery-5520": {
    id: "avery-5520",
    name: "Avery 5520 — 1\" × 2⅝\" weatherproof, 30 per sheet",
    sheet: { width: inches(8.5), height: inches(11) },
    label: { width: inches(2.625), height: inches(1) },
    margin: { left: inches(0.1875), top: inches(0.5) },
    pitch: { x: inches(2.75), y: inches(1) },
    columns: 3,
    rows: 10,
    material: "Weatherproof film. Survives damp and handling; still not the choice for a truck exterior.",
  },

  /**
   * A single 2" × 2" label on a continuous roll — for a thermal label printer, where the media IS
   * the page and there are no margins.
   *
   * Unlike the four above, this is OUR definition rather than a vendor template, so there is no
   * published geometry to check it against. The 2" media size is the assumption; it is the one
   * preset A5 can invalidate, and the label screen says so.
   */
  "roll-single": {
    id: "roll-single",
    name: "Roll — 2\" square, one per feed",
    sheet: { width: inches(2), height: inches(2) },
    label: { width: inches(2), height: inches(2) },
    margin: { left: 0, top: 0 },
    pitch: { x: inches(2), y: inches(2) },
    columns: 1,
    rows: 1,
    material: "Photo-anodized aluminium for truck items — near exhaust and under a pressure washer, paper and film both fail.",
  },
};

export interface LabelPlacement {
  /** 1-based, reading left-to-right then down — the number a person counts to on a part-used sheet. */
  position: number;
  /** 0-based page this label falls on. */
  page: number;
  /** Top-left corner in points, nudge applied. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LabelSheetOptions {
  /**
   * Where to start on the first sheet, 1-based (Sortly's "start at position n"). A shop that used
   * six labels off a sheet last week starts at 7, and the six empty backing squares are skipped.
   */
  startPosition?: number;
  /** Whole-sheet offset in points, for printer drift. Positive x is right, positive y is down. */
  nudge?: { x: number; y: number };
}

export interface LabelSheet {
  preset: LabelPreset;
  perSheet: number;
  pages: number;
  placements: LabelPlacement[];
}

/**
 * Where to draw `count` labels.
 *
 * `startPosition` offsets only the FIRST sheet. Once the run rolls onto a second sheet that sheet
 * is fresh and starts at position 1, which is what a person expects: you skip only the labels you
 * already peeled off the sheet in your hand.
 *
 * The two-branch form below is written out rather than folded into `(start - 1 + i) % perSheet`,
 * which produces identical slots for every input — checked algebraically, since the first sheet's
 * capacity is `perSheet - (start - 1)` and the modulo therefore cancels it exactly. The branches
 * are kept because `page` needs the same split anyway, and because a reader should not have to redo
 * that cancellation to satisfy themselves that the second sheet starts at the top.
 *
 * The nudge is applied to every placement identically, because it models the printer's registration
 * being off by a constant. Avery's own diagnostic is the reason it works that way: a uniform shift
 * is a margin problem the nudge fixes, while a drift that grows down the page is a scaling problem
 * that a nudge cannot fix and that the label screen tells the user to solve by printing at 100 %.
 */
export function labelSheet(
  count: number,
  presetId: LabelPresetId,
  options: LabelSheetOptions = {},
): LabelSheet {
  const preset = LABEL_PRESETS[presetId];
  const perSheet = preset.columns * preset.rows;
  const start = options.startPosition ?? 1;
  const nudge = options.nudge ?? { x: 0, y: 0 };

  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Label count must be a non-negative integer; got ${count}.`);
  }
  if (!Number.isInteger(start) || start < 1 || start > perSheet) {
    throw new Error(
      `Start position must be between 1 and ${perSheet} for ${presetId}; got ${start}.`,
    );
  }

  const placements: LabelPlacement[] = [];
  // The first sheet is short by the labels already peeled off it; every later sheet is whole.
  const firstSheetCapacity = perSheet - (start - 1);
  for (let i = 0; i < count; i += 1) {
    const onFirstSheet = i < firstSheetCapacity;
    const page = onFirstSheet ? 0 : 1 + Math.floor((i - firstSheetCapacity) / perSheet);
    const slot = onFirstSheet
      ? start - 1 + i
      : (i - firstSheetCapacity) % perSheet;
    const column = slot % preset.columns;
    const row = Math.floor(slot / preset.columns);
    placements.push({
      position: slot + 1,
      page,
      x: preset.margin.left + column * preset.pitch.x + nudge.x,
      y: preset.margin.top + row * preset.pitch.y + nudge.y,
      width: preset.label.width,
      height: preset.label.height,
    });
  }

  return {
    preset,
    perSheet,
    pages: placements.length === 0 ? 0 : (placements[placements.length - 1]?.page ?? 0) + 1,
    placements,
  };
}
