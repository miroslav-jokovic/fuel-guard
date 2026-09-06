/**
 * Where every value goes on J.J. Keller form 14834 (Rev. 1/22) — D-AVI7's coordinate map.
 *
 * ── THESE NUMBERS WERE MEASURED, NOT CHOSEN ────────────────────────────────────────────────────
 * Extracted with `pdftotext -bbox-layout` from the filled report the office produced for tractor 654
 * on 2026-06-16, then verified against the blank template in `assets/`: **max drift 0.009 pt across
 * 26 artwork anchors**. These are the positions the office has printed into for years, not an
 * interpretation of where the boxes look like they are.
 *
 * The plan's §2.5 records the two findings that shaped this file:
 *   · pdftotext measures TOP-DOWN and pdf-lib draws BOTTOM-UP, so every `y` below is a top-down
 *     distance and `baselineOf()` is the single place that flips it. Getting that conversion wrong
 *     mirrors the whole page, which is why it happens in one function.
 *   · a four-digit repair date OVERFLOWS its cell (40.03 pt of text in a 39.2 pt box), so a cell is
 *     a RECTANGLE with a `maxWidth` rather than a point, and `../layout.test.ts` fails the build when a
 *     realistic value does not fit.
 *
 * ── IF KELLER REISSUES THE FORM ────────────────────────────────────────────────────────────────
 * Only this file and `assets/` move. Reports already filed keep their stored bytes — which is why A6
 * files the rendered PDF rather than re-rendering — and the bijection test refuses a map that has
 * stopped covering the catalogue, so a revision fails the build instead of printing into a wrong
 * cell.
 */
import { INSPECTION_ITEMS, type InspectionSubjectType } from "@silvicom/shared";

/** The template's page box, and the number `baselineOf` flips around. Asserted at load in render.ts. */
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 846;

export const TEMPLATE_REVISION = "jjkeller-14834-rev-1-22";


/**
 * What the blank in `assets/` ACTUALLY CARRIES — the switch the artwork restoration hangs off.
 *
 * The renderer used to decide this by believing a comment. That is how a heading came to be drawn
 * in black on a page whose original has it in white on red: the belief ("Keller knocks the headings
 * out for its own pad") was wrong, nothing could contradict it, and the output was defensible only
 * against the belief.
 *
 * So it is a declared fact instead, and `../assets.test.ts` reads the PDF and fails the build when
 * the file and this table stop agreeing. Swap in a clean export and the test tells you which lines
 * to flip; flip them and the renderer stops drawing what the page already has, rather than
 * double-printing it.
 *
 * Every `false` below is a loss measured in the file itself, not a preference — see
 * `keller14834Rev0122Artwork.ts` for what each one costs and where the replacement is measured.
 */
export const TEMPLATE_SUPPLIES = {
  /** The sixteen coloured bands the section headings are knocked out of. */
  headingBands: false,
  /** The heading text itself. Fifteen survive, painted white; `1. BRAKE SYSTEM` does not exist. */
  headingTitles: false,
  /** The `OK` label above the first ruled column, in all three groups. */
  okColumnHeader: false,
  /** The ✓ inside `VEHICLE IDENTIFICATION (✓ AND COMPLETE)`. */
  identificationTick: false,
  /** The ✓ / X / NA marks on the INSTRUCTIONS legend. */
  legendMarks: false,
} as const;

export interface Cell {
  /** Left edge, in PDF points from the left of the page. */
  readonly x: number;
  /** Top-down distance to the text baseline — flip it with `baselineOf`. */
  readonly y: number;
  /** The box the value must fit inside. Enforced by `../layout.test.ts`, not by hope. */
  readonly maxWidth: number;
}

/**
 * pdftotext's top-down y to pdf-lib's baseline.
 *
 * The measured `y` is the BOTTOM of the reported glyph box, which sits one descender below the
 * baseline; without the correction every mark prints 1.66 pt low at 8 pt, which is visible on paper.
 * 0.207 is Helvetica's AFM descender. Verified by stamping over the sample and rendering at 400 dpi
 * until red sat exactly on black (plan §2.5).
 */
export const HELVETICA_DESCENT_RATIO = 0.207;
export function baselineOf(cell: Cell, size: number): number {
  return PAGE_HEIGHT - cell.y + HELVETICA_DESCENT_RATIO * size;
}

/**
 * The three printed column groups: left carries Appendix A groups 1-5, middle 6-11, right 12-15 —
 * which is how the form folds 56 components onto one page.
 *
 * Widths are the ruled columns, derived from the header positions measured on the blank: OK 14.6 pt,
 * NEEDS REPAIR 16.5, REPAIRED DATE 39.2 (the gap to where the item text begins).
 */
interface ColumnGroup {
  readonly ok: number;
  readonly needsRepair: number;
  readonly repairedDate: number;
}
const COLUMN_GROUPS: readonly ColumnGroup[] = [
  { ok: 18.8, needsRepair: 33.6, repairedDate: 48.6 },
  { ok: 210.6, needsRepair: 225.6, repairedDate: 240.6 },
  { ok: 402.6, needsRepair: 417.6, repairedDate: 432.6 },
];
/**
 * The RULED widths, found by scanning the blank at 300 dpi for vertical lines rather than inferred
 * from where the item text starts — which is what a first pass did, and it was wrong by 15 pt.
 *
 * The rules sit at 18.1 / 32.9 / 47.9 / 71.9 in the left group and repeat at +191.8 and +383.8. So
 * every OK and NEEDS REPAIR box is ~15 pt wide and **REPAIRED DATE is only 24 pt** — a third of what
 * the item-text inference suggested. The x values above are each rule + 0.7 pt of padding, and the
 * widths are the inner span less that padding on both sides.
 *
 * This is why `shortDate` prints `M/D/YY` and why `fit()` exists: 24 pt is genuinely narrow, the
 * office has never printed a repair date on this form (the sample carries none), and a full date at
 * the body size would run straight across the item text.
 */
const OK_WIDTH = 13.4;
const NEEDS_REPAIR_WIDTH = 13.6;
const REPAIRED_DATE_WIDTH = 22.6;

/**
 * `[catalogue key, column group, top-down baseline]`, in printed order.
 *
 * Derived from the sample's own 57 marks — 56 components plus one stray, because group 7's item (c)
 * wraps onto a second printed line and the inspector ticked both halves. That stray is exactly why
 * the catalogue is the source of truth and the paper is not.
 */
const ITEM_ROWS: ReadonlyArray<readonly [string, number, number]> = [
  ["brake.service_brakes", 0, 299.56],
  ["brake.parking_system", 0, 311.3],
  ["brake.drums_rotors", 0, 325.56],
  ["brake.hose", 0, 338.56],
  ["brake.tubing", 0, 351.56],
  ["brake.low_pressure_warning", 0, 374.56],
  ["brake.tractor_protection_valve", 0, 384.71],
  ["brake.air_compressor", 0, 398.56],
  ["brake.electric", 0, 411.56],
  ["brake.hydraulic", 0, 423.56],
  ["brake.vacuum", 0, 436.56],
  ["brake.antilock", 0, 448.56],
  ["brake.automatic_adjusters", 0, 461.56],
  ["coupling.fifth_wheel", 0, 485.56],
  ["coupling.pintle_hooks", 0, 497.56],
  ["coupling.drawbar_eye", 0, 510.56],
  ["coupling.drawbar_tongue", 0, 523.56],
  ["coupling.safety_devices", 0, 535.56],
  ["coupling.saddle_mounts", 0, 547.56],
  ["exhaust.no_leaks_at_cab", 0, 572.56],
  ["exhaust.bus_discharge", 0, 606.56],
  ["exhaust.no_burn_risk", 0, 640.56],
  ["fuel.no_visible_leak", 0, 695.56],
  ["fuel.filler_cap", 0, 708.56],
  ["fuel.tank_secure", 0, 721.56],
  ["lighting.all_operable", 0, 756.56],
  ["safe_loading.parts_secured", 1, 301.26],
  ["safe_loading.front_end_structure", 1, 336.26],
  ["safe_loading.intermodal_securement", 1, 349.56],
  ["steering.wheel_free_play", 1, 384.92],
  ["steering.column", 1, 397.92],
  ["steering.front_axle_beam", 1, 411.92],
  ["steering.gear_box", 1, 436.92],
  ["steering.pitman_arm", 1, 449.92],
  ["steering.power_steering", 1, 462.92],
  ["steering.ball_socket_joints", 1, 475.92],
  ["steering.tie_rods_drag_links", 1, 488.92],
  ["steering.nuts", 1, 501.92],
  ["steering.system", 1, 514.92],
  ["suspension.axle_positioning", 1, 539.92],
  ["suspension.spring_assembly", 1, 552.92],
  ["suspension.torque_radius_tracking", 1, 565.92],
  ["frame.members", 1, 603.92],
  ["frame.tire_wheel_clearance", 1, 616.92],
  ["frame.adjustable_axle", 1, 630.92],
  ["tires.steer_axle", 1, 676.92],
  ["tires.all_other", 1, 689.92],
  ["tires.speed_restricted", 1, 702.92],
  ["wheels.lock_or_side_ring", 1, 727.92],
  ["wheels.wheels_and_rims", 1, 740.92],
  ["wheels.fasteners", 1, 753.92],
  ["wheels.welds", 1, 766.92],
  ["windshield.glazing", 2, 301.26],
  ["wipers.operable", 2, 347.26],
  ["motorcoach_seats.secure", 2, 384.26],
  ["rear_impact_guard.present", 2, 420.26],
];

export interface ItemCells {
  readonly ok: Cell;
  readonly needsRepair: Cell;
  readonly repairedDate: Cell;
}

const CELLS: ReadonlyMap<string, ItemCells> = new Map(
  ITEM_ROWS.map(([key, group, y]) => {
    const col = COLUMN_GROUPS[group]!;
    return [
      key,
      {
        ok: { x: col.ok, y, maxWidth: OK_WIDTH },
        needsRepair: { x: col.needsRepair, y, maxWidth: NEEDS_REPAIR_WIDTH },
        repairedDate: { x: col.repairedDate, y, maxWidth: REPAIRED_DATE_WIDTH },
      },
    ] as const;
  }),
);

export function cellsFor(itemKey: string): ItemCells | undefined {
  return CELLS.get(itemKey);
}

/** Every key the map covers — the other half of the bijection the test asserts. */
export function mappedItemKeys(): string[] {
  return [...CELLS.keys()];
}

/**
 * The header block. Positions are the sample's own, so the carrier block lands where the office has
 * always seen it. The template lost its three AcroForm fields in the Illustrator round trip
 * (`Form: none`), so these are stamped as text like everything else rather than filled and flattened
 * — simpler, and one fewer pdf-lib behaviour to depend on.
 */
export const HEADER_CELLS = {
  decalSerial: { x: 385.7, y: 125.1, maxWidth: 96 },
  fleetUnitNumber: { x: 515.5, y: 125.7, maxWidth: 82 },
  inspectedOn: { x: 448.2, y: 146.0, maxWidth: 100 },
  inspectorName: { x: 440.7, y: 175.8, maxWidth: 160 },
  carrierName: { x: 24.3, y: 174.1, maxWidth: 300 },
  carrierAddress: { x: 24.3, y: 198.6, maxWidth: 300 },
  carrierCityStateZip: { x: 23.3, y: 222.5, maxWidth: 300 },
  vehicleIdentificationValue: { x: 331.6, y: 222.5, maxWidth: 180 },
  inspectionAgencyLocation: { x: 447.0, y: 233.0, maxWidth: 158 },
} as const satisfies Record<string, Cell>;

/**
 * ── FOUR OF THESE MOVED 2026-08-31, AND THE REASON IS WHICH SAMPLE THEY CAME FROM ──────────────
 * The map was measured against `654 6-26`, which the owner later found to be a damaged export. The
 * carrier block matched the office's own filled trailer report (`535968 8-26`) to two decimal places
 * — 24.29/174.07, 24.29/198.55, 23.29/222.53 — but four cells did not, because they had been
 * inferred from artwork rather than read off a filled page:
 *
 * | cell | was | is | drift |
 * | --- | --- | --- | --- |
 * | decalSerial | 389.2, 125.8 | 385.7, 125.1 | 3.5 pt right, 0.7 low |
 * | fleetUnitNumber | 519.7, 125.8 | 515.5, 125.7 | 4.2 pt right |
 * | inspectedOn | 447.2, 144.7 | 448.2, 146.0 | 1.0 left, 1.3 high |
 * | vehicleIdentificationValue | 324.0, 221.9 | 331.6, 222.5 | 7.6 pt left |
 *
 * The two files were confirmed to share a coordinate system before anything moved: the "VEHICLE
 * COMPONENTS INSPECTED" bar renders at exactly y 252.96–264.72, x 18.00–593.76 in both at 300 dpi.
 */

/**
 * The per-field type sizes, measured off the office's own filled report rather than chosen.
 *
 * Everything used to print at one size — 10 pt — which is why the top of the page read as small and
 * thin next to the form's own artwork. What the office actually types (`535968 8-26`):
 *
 *   · the carrier block is **Helvetica-Bold at 12.085 pt**, read straight out of the AcroForm field's
 *     appearance stream (`/HeBo 12.085 Tf`) — so bold is not a preference here, it is what the page
 *     has always carried;
 *   · the top-right block is far bigger than the rest: the decal serial and the fleet unit number
 *     both advance 9.00 pt per digit, which for Helvetica's 0.556 em digit is **16.2 pt**, and
 *     "GEORGE" measures 72.74 pt across six caps summing 4.39 em, which is **16.6 pt**;
 *   · the date advances 39.01 pt over 3.614 em, which is **10.8 pt**;
 *   · the VIN is the one value the office prints SMALL — 75.32 pt over 9.788 em, about **7.7 pt** —
 *     because seventeen characters have to sit inside the identification box.
 *
 * Rounded to the nearest half point. `fit()` still shrinks anything that would overrun its cell, so
 * these are opening sizes and not promises.
 */
export const HEADER_SIZES = {
  decalSerial: 16,
  fleetUnitNumber: 16,
  inspectedOn: 11,
  inspectorName: 16,
  carrierName: 12,
  carrierAddress: 12,
  carrierCityStateZip: 12,
  vehicleIdentificationValue: 9,
  inspectionAgencyLocation: 8,
} as const satisfies Record<keyof typeof HEADER_CELLS, number>;

/**
 * The tick boxes — each one the artwork's OWN rectangle, not a guess at where it looks like it is.
 *
 * ── THREE OF THESE WERE PRINTING ON TOP OF THE LABEL, 2026-09-01 ───────────────────────────────
 * The earlier positions were inferred rather than read, and the only assertion on them — "gives
 * every tick box its own position" in `../layout.test.ts` — checked that no two of them collided
 * with EACH OTHER, which every wrong answer also satisfies. The page draws its nine boxes as plain
 * `re` operators, so they can simply be read out:
 *
 * | box | artwork (x, y, 5.5 × 5.5) | was stamped at | drift |
 * | --- | --- | --- | --- |
 * | §396.19 YES | 316.75, 652.442 | 318.9 | 2.2 pt right, 1.5 low |
 * | LIC. PLATE NO. | 451.75, 638.302 | 470.0 | **18.3 pt right — on the word "LIC."** |
 * | VIN | 523.75, 638.302 | 524.3 | 0.6 right, 1.5 low |
 * | OTHER | 552.75, 638.302 | 574.0 | **21.3 pt right — inside the word "OTHER"** |
 * | TRACTOR | 71.25, 614.302 | 70.9 | 0.4 left, 1.5 low |
 * | TRAILER | 123.25, 614.302 | 128.0 | **4.8 pt right — on the word "TRAILER"** |
 *
 * So a plate-identified report and an other-identified report each printed their only vehicle-ID
 * mark across a printed label with all three boxes left empty, and EVERY trailer report struck out
 * the word it was meant to be ticking. Rendered and read at 300 dpi before and after.
 *
 * Pinned now by "puts every tick box on the rectangle the template actually draws" and "keeps the
 * drawn X inside the 5.5 pt box, horizontally and vertically", both in `../layout.test.ts`.
 *
 * The remaining three boxes on the same rows — TRUCK 171.25, BUS 213.25 and the (OTHER) vehicle
 * type at 71.25, 602.442 — are recorded here rather than in code because §396.17 subjects are
 * tractors and trailers only (D-AVI12); a fleet that grows a bus needs the catalogue changed, not
 * a coordinate.
 *
 * `qualifiedYes` is the §396.19 assertion, and the renderer stamps it ONLY from the inspector's
 * register row rather than from an argument — see report.ts. A boolean parameter here is exactly
 * how a derived legal claim turns back into a typed one.
 */
export const CHECKBOX_SIZE = 5.5;

export interface TickBox {
  /** Left edge, in points from the left of the page. */
  readonly x: number;
  /** Top-down distance to the box's TOP edge — the box, not a baseline. */
  readonly y: number;
}

const boxAt = (x: number, pdfBottom: number): TickBox => ({ x, y: PAGE_HEIGHT - pdfBottom - CHECKBOX_SIZE });

export const CHECKBOX_CELLS = {
  qualifiedYes: boxAt(316.75, 652.442),
  identificationPlate: boxAt(451.75, 638.302),
  identificationVin: boxAt(523.75, 638.302),
  identificationOther: boxAt(552.75, 638.302),
  vehicleTypeTractor: boxAt(71.25, 614.302),
  vehicleTypeTrailer: boxAt(123.25, 614.302),
} as const satisfies Record<string, TickBox>;


/** Which tick box a subject type lights up (D-AVI12 — one template, both kinds of equipment). */
export const VEHICLE_TYPE_BOX: Record<InspectionSubjectType, keyof typeof CHECKBOX_CELLS> = {
  tractor: "vehicleTypeTractor",
  trailer: "vehicleTypeTrailer",
};

/** How the form's identification row is ticked, from the report's own method. */
export const IDENTIFICATION_BOX = {
  vin: "identificationVin",
  plate: "identificationPlate",
  other: "identificationOther",
} as const;

/**
 * Keller's group 16 — free text on the ruled lines down the right column.
 *
 * Also measured rather than estimated: the eighteen write-lines run from 501.7 to 767.6 top-down at
 * a 15.65 pt pitch, and the printed "List any other condition(s)…" label sits ABOVE the first of
 * them. A first pass started at 460 and printed the note straight through that label.
 */
export const OTHER_CONDITIONS_LINES = {
  x: 474.0,
  /** Baseline of the first writable line — just above the rule at 501.7. */
  firstY: 498.5,
  lineHeight: 15.65,
  lines: 18,
  maxWidth: 116,
} as const;

export const MAPPED_ITEM_COUNT = CELLS.size;
export const CATALOGUE_ITEM_COUNT = INSPECTION_ITEMS.length;
