#!/usr/bin/env node
/**
 * Printable calibration targets for the device session (SCANNER-UPGRADE-PLAN.md, Step 0.1).
 *
 * ── THE PROBLEM THESE SOLVE ───────────────────────────────────────────────────────────────────
 * Step 0.1 puts a phone in a truck cab. Without a known subject that session produces anecdotes:
 * "it seemed blurry", "the glare was bad". What it needs to produce is measurements, and a
 * measurement needs a subject whose truth you already hold. Photograph a sheet this file drew and
 * every degradation is a difference from something exact — the wedge step that clipped, the line
 * pitch that stopped resolving, the glyph height that stopped being read, the fiducial centre that
 * moved.
 *
 * ── WHY THIS IS NOT THE SYNTHETIC CORPUS AGAIN ────────────────────────────────────────────────
 * `fixtures/*.png` are pages with simulated degradation, and they exist to hold three
 * implementations of one metric to the same numbers (parity). They cannot tell you what a real
 * sensor, a real lens, a real cab light and a real print do, because nothing about them is real.
 * These are the other half: an exact subject, degraded by the actual world, measured on the way
 * back. Parity and calibration are different jobs and the corpus should not pretend otherwise.
 *
 * ── AND WHY THE SUBJECT IS OURS, NOT A REAL BILL OF LADING ────────────────────────────────────
 * ⚠ THIS REPOSITORY IS PUBLIC. A photograph of a real BOL carries shipper and consignee names,
 * addresses, load and seal numbers, driver signatures and sometimes UN numbers tied to a customer's
 * cargo. It is PII and it cannot be committed here — the same rule that gitignores `docs/psp-docs/`
 * and `docs/McLeod-Testing/`, and for the same reason those entries record: untracking later does
 * not remove anything from history. Photographs of THESE sheets carry no PII at all, which is what
 * makes a committed, re-runnable benchmark possible. Genuine customer documents are handled the
 * other way — see `fixtures/real/README.md`.
 *
 * ── WHAT EACH SHEET MEASURES, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────────────
 * Sheet A (metrology): exposure transfer and highlight clipping (step wedge), white balance and
 * colour preservation (patches), true optical sharpness (slanted edge, the ISO 12233 method — a
 * tilted edge samples the edge response at sub-pixel phases, which a straight edge cannot),
 * resolution limit (line-pair blocks), and corner-localisation error (fiducials at known centres).
 * Sheet B (legibility): glyph height, which is the one config threshold that has never been
 * measured against a glyph — `minMedianCharHeightPx: 16` ships and enforces today.
 *
 * They do NOT calibrate OCR accuracy on real paper. Carbon copies, thermal fade, fold shadows and
 * dot-matrix print are not reproducible by a laser printer, and claiming otherwise would put a
 * number on something these sheets cannot see. That stays with telemetry on real captures (Step 5.1).
 *
 * ── PRINTING ──────────────────────────────────────────────────────────────────────────────────
 * A4 at 300 dpi (2480 x 3508). Print at 100% / "actual size" — any fit-to-page scaling changes every
 * printed dimension below and silently invalidates the height and pitch labels, which are the whole
 * point. Plain white paper, no duplex, best available quality.
 *
 * Usage:  node fixtures/targets/generate-targets.mjs           write the sheets + manifest
 *         node fixtures/targets/generate-targets.mjs --check   regenerate in memory; non-zero on drift
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../png.mjs";
import { drawText, textWidth, GLYPH_ADVANCE, GLYPH_HEIGHT } from "./font5x7.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));

/** A4 at 300 dpi. Every printed dimension in this file is stated in these pixels. */
const DPI = 300;
const WIDTH = 2480;
const HEIGHT = 3508;
const MARGIN = 200;
const INK = [0, 0, 0];
const PAPER = [255, 255, 255];

// ── canvas ──────────────────────────────────────────────────────────────────────────────────────
function sheet() {
  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3, 0xff);
  return { width: WIDTH, height: HEIGHT, rgb };
}

function px(c, x, y, colour) {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
  const i = (y * c.width + x) * 3;
  c.rgb[i] = colour[0];
  c.rgb[i + 1] = colour[1];
  c.rgb[i + 2] = colour[2];
}

function rect(c, x, y, w, h, colour) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(c, xx, yy, colour);
}

function outline(c, x, y, w, h, thickness, colour) {
  rect(c, x, y, w, thickness, colour);
  rect(c, x, y + h - thickness, w, thickness, colour);
  rect(c, x, y, thickness, h, colour);
  rect(c, x + w - thickness, y, thickness, h, colour);
}

function label(c, text, x, y, scale) {
  drawText(text, x, y, scale, (lx, ly) => px(c, lx, ly, INK));
}

// ── fiducials ───────────────────────────────────────────────────────────────────────────────────
/**
 * Concentric squares, because a centroid over concentric rings is robust to blur and to threshold
 * choice in a way a single corner is not — and the number Step 0.1 wants back is "how far did the
 * detected corner move", which needs a centre that survives a bad photograph.
 */
const FIDUCIAL = 180;
const FIDUCIAL_CENTRES = [
  { name: "top-left", x: MARGIN + FIDUCIAL / 2, y: MARGIN + FIDUCIAL / 2, keyed: true },
  { name: "top-right", x: WIDTH - MARGIN - FIDUCIAL / 2, y: MARGIN + FIDUCIAL / 2, keyed: false },
  { name: "bottom-left", x: MARGIN + FIDUCIAL / 2, y: HEIGHT - MARGIN - FIDUCIAL / 2, keyed: false },
  { name: "bottom-right", x: WIDTH - MARGIN - FIDUCIAL / 2, y: HEIGHT - MARGIN - FIDUCIAL / 2, keyed: false },
];

function fiducial(c, centre) {
  const x = centre.x - FIDUCIAL / 2;
  const y = centre.y - FIDUCIAL / 2;
  rect(c, x, y, FIDUCIAL, FIDUCIAL, INK);
  rect(c, x + 30, y + 30, FIDUCIAL - 60, FIDUCIAL - 60, PAPER);
  rect(c, x + 60, y + 60, FIDUCIAL - 120, FIDUCIAL - 120, INK);
  // The top-left marker alone carries a key bar, so a sheet photographed upside down or mirrored is
  // detectable from the image rather than from whoever remembers which way up it was.
  if (centre.keyed) rect(c, x + FIDUCIAL + 24, y + FIDUCIAL / 2 - 12, 90, 24, INK);
}

// ── the measured blocks ─────────────────────────────────────────────────────────────────────────

/** 11 steps, 0..255 in equal increments. Clipping at either end is visible as two steps that match. */
function stepWedge(c, x, y, w, h) {
  const steps = 11;
  const sw = Math.floor(w / steps);
  const patches = [];
  for (let i = 0; i < steps; i++) {
    const v = Math.round((255 * i) / (steps - 1));
    rect(c, x + i * sw, y, sw, h, [v, v, v]);
    patches.push({ index: i, value: v, x: x + i * sw, y, w: sw, h });
    // Labels sit BELOW the wedge on white, never on the patch: text inside a patch changes that
    // patch's mean, which is the quantity being measured.
    label(c, String(v).padStart(3, "0"), x + i * sw + 8, y + h + 16, 3);
  }
  outline(c, x, y, sw * steps, h, 3, INK);
  return { steps, x, y, w: sw * steps, h, patchWidth: sw, patches };
}

/** Primaries, secondaries and three neutrals. Neutrals are what white balance is judged on; the
 *  saturated patches are what "colour must survive enhancement" (Phase 6.1) is judged on. */
const PATCHES = [
  { name: "red", rgb: [200, 30, 30] },
  { name: "green", rgb: [30, 150, 60] },
  { name: "blue", rgb: [30, 60, 170] },
  { name: "cyan", rgb: [30, 160, 170] },
  { name: "magenta", rgb: [170, 40, 140] },
  { name: "yellow", rgb: [220, 190, 40] },
  { name: "neutral-dark", rgb: [64, 64, 64] },
  { name: "neutral-mid", rgb: [128, 128, 128] },
  { name: "neutral-light", rgb: [192, 192, 192] },
];

function colourPatches(c, x, y, w, h) {
  const pw = Math.floor(w / PATCHES.length);
  const placed = PATCHES.map((patch, i) => {
    rect(c, x + i * pw, y, pw, h, patch.rgb);
    outline(c, x + i * pw, y, pw, h, 2, INK);
    return { ...patch, x: x + i * pw, y, w: pw, h };
  });
  label(c, "COLOUR PATCHES R G B C M Y AND THREE NEUTRALS", x, y + h + 16, 3);
  return { x, y, w: pw * PATCHES.length, h, patchWidth: pw, patches: placed };
}

/**
 * A near-vertical edge tilted about 5 degrees. The tilt is the point: it makes each scanline cross
 * the edge at a different sub-pixel phase, so the edge response can be reconstructed far finer than
 * the pixel grid. A perfectly vertical edge measures only the pixel grid.
 */
const SLANT_RUN = 0.0875; // tan(5 degrees)

function slantedEdge(c, x, y, w, h) {
  for (let yy = 0; yy < h; yy++) {
    const boundary = Math.round(x + w / 2 + SLANT_RUN * (yy - h / 2));
    rect(c, x, y + yy, boundary - x, 1, INK);
  }
  outline(c, x, y, w, h, 3, INK);
  label(c, "SLANTED EDGE 5 DEG", x, y + h + 16, 3);
  return { x, y, w, h, degrees: 5, tangent: SLANT_RUN, centreX: x + w / 2 };
}

/** Vertical line pairs at decreasing pitch. `pitch` is the full black+white period in printed px. */
const LINE_PITCHES = [24, 16, 12, 8, 6, 4, 2];

function linePairs(c, x, y, blockW, blockH) {
  const blocks = LINE_PITCHES.map((pitch, i) => {
    const bx = x + i * (blockW + 12);
    for (let xx = 0; xx < blockW; xx++) {
      if (xx % pitch < pitch / 2) rect(c, bx + xx, y, 1, blockH, INK);
    }
    outline(c, bx, y, blockW, blockH, 2, INK);
    label(c, String(pitch), bx + 4, y + blockH + 12, 3);
    return { pitchPx: pitch, x: bx, y, w: blockW, h: blockH };
  });
  label(c, "LINE PAIR PITCH IN PRINTED PIXELS AT 300 DPI", x, y + blockH + 60, 3);
  return { gap: 12, blocks };
}

/**
 * The legibility ladder. Cap height is `GLYPH_HEIGHT * scale` printed pixels, exactly, and each row
 * says its own height so a photograph of it is self-describing without the manifest.
 */
const LADDER_SCALES = [2, 3, 4, 6, 8, 12, 16];
const LADDER_TEXT = "SILVICOM 360 BILL OF LADING 0123456789 SEAL UN1203";

function legibilityLadder(c, x, y, maxWidth) {
  let cursor = y;
  const rows = [];
  for (const scale of LADDER_SCALES) {
    const capHeight = GLYPH_HEIGHT * scale;
    const tag = `${String(capHeight).padStart(3, "0")}PX`;
    label(c, tag, x, cursor, 3);
    const textX = x + textWidth(tag) * 3 + 40;
    // Trim the sample to whatever fits, rather than running off the sheet: a clipped glyph would be
    // measured as a shorter glyph and would corrupt the very height this row exists to state.
    const available = maxWidth - (textX - x);
    const fits = Math.max(1, Math.floor((available + scale) / (GLYPH_ADVANCE * scale)));
    const text = LADDER_TEXT.slice(0, fits);
    label(c, text, textX, cursor, scale);
    rows.push({ capHeightPx: capHeight, scale, sample: text, x: textX, y: cursor });
    cursor += capHeight + 44;
  }
  return { rows, endY: cursor };
}

// ── the two sheets ──────────────────────────────────────────────────────────────────────────────

function header(c, title, sheetId) {
  for (const centre of FIDUCIAL_CENTRES) fiducial(c, centre);
  label(c, title, MARGIN, MARGIN + FIDUCIAL + 90, 8);
  label(c, sheetId, MARGIN, MARGIN + FIDUCIAL + 190, 4);
  label(c, "PRINT AT 100 PERCENT ACTUAL SIZE - DO NOT FIT TO PAGE", MARGIN, MARGIN + FIDUCIAL + 250, 4);
  rect(c, MARGIN, MARGIN + FIDUCIAL + 310, WIDTH - MARGIN * 2, 5, INK);
  return MARGIN + FIDUCIAL + 380;
}

function metrologySheet() {
  const c = sheet();
  let y = header(c, "SCAN TARGET A", "METROLOGY - A4 300DPI - SILVICOM 360");
  const w = WIDTH - MARGIN * 2;

  // Every region reports WHERE it was drawn, not only what it contains. Without that, anyone
  // measuring a photograph of this sheet has to re-derive the layout from the source — and a layout
  // re-derived by hand is a second source of truth about where the truth is.
  const regions = {};
  regions.stepWedge = stepWedge(c, MARGIN, y, w, 320);
  y += 320 + 90;

  regions.colourPatches = colourPatches(c, MARGIN, y, w, 300);
  y += 300 + 90;

  regions.slantedEdge = slantedEdge(c, MARGIN, y, 700, 700);
  regions.linePairs = linePairs(c, MARGIN + 780, y, 130, 700);
  y += 700 + 130;

  // A large empty field, bounded so its edges are findable. Its job is to carry NOTHING: the noise,
  // vignetting and glare a photograph adds to it are the whole measurement.
  label(c, "FLAT FIELD BELOW - MEASURES NOISE VIGNETTING AND GLARE - INTENTIONALLY EMPTY", MARGIN, y, 4);
  y += 60;
  const flatH = HEIGHT - MARGIN - FIDUCIAL - 60 - y;
  outline(c, MARGIN, y, w, flatH, 3, INK);
  // The interior, inset past the 3px rule, is the region that must contain nothing.
  regions.flatField = { x: MARGIN + 3, y: y + 3, w: w - 6, h: flatH - 6 };
  return { canvas: c, regions };
}

function legibilitySheet() {
  const c = sheet();
  const y = header(c, "SCAN TARGET B", "LEGIBILITY - A4 300DPI - SILVICOM 360");
  const ladder = legibilityLadder(c, MARGIN, y, WIDTH - MARGIN * 2);

  let cursor = ladder.endY + 60;
  label(c, "DENSE BLOCK AT 028PX CAP HEIGHT", MARGIN, cursor, 4);
  cursor += 70;
  // A paragraph rather than a single line: median glyph height over one line is a sample of one, and
  // the gate's `medianCharHeightPx` is a median over a page.
  for (let i = 0; i < 60 && cursor < HEIGHT - MARGIN - FIDUCIAL - 120; i++) {
    label(c, LADDER_TEXT, MARGIN, cursor, 4);
    cursor += GLYPH_HEIGHT * 4 + 22;
  }
  return { canvas: c, regions: { ladder: ladder.rows } };
}

// ── manifest + entry point ──────────────────────────────────────────────────────────────────────
const metrology = metrologySheet();
const legibility = legibilitySheet();
const sheets = [
  {
    name: "target-a-metrology",
    canvas: metrology.canvas,
    regions: metrology.regions,
    measures: ["exposure-transfer", "highlight-clipping", "white-balance", "colour-preservation", "optical-sharpness", "resolution-limit", "corner-localisation", "noise-and-vignetting"],
  },
  {
    name: "target-b-legibility",
    canvas: legibility.canvas,
    regions: legibility.regions,
    measures: ["glyph-height", "text-legibility-limit", "corner-localisation"],
  },
];

const manifest = {
  targetsVersion: "scan-targets-1",
  note: "Generated by fixtures/targets/generate-targets.mjs. Print A4 at 100 percent. Digests are over raw RGB pixels, not file bytes.",
  print: { dpi: DPI, widthPx: WIDTH, heightPx: HEIGHT, paper: "A4", scalingRequired: "100% / actual size" },
  fiducials: { sizePx: FIDUCIAL, centres: FIDUCIAL_CENTRES },
  linePairPitchesPx: LINE_PITCHES,
  sheets: sheets.map((s) => ({
    name: s.name,
    file: `${s.name}.png`,
    width: s.canvas.width,
    height: s.canvas.height,
    measures: s.measures,
    regions: s.regions,
    pixelSha256: createHash("sha256").update(s.canvas.rgb).digest("hex"),
  })),
};

if (process.argv.includes("--check")) {
  const onDisk = JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8"));
  const drift = [];
  if (onDisk.targetsVersion !== manifest.targetsVersion) {
    drift.push(`targetsVersion: manifest says ${onDisk.targetsVersion}, generator says ${manifest.targetsVersion}`);
  }
  const byName = new Map((onDisk.sheets ?? []).map((s) => [s.name, s]));
  for (const s of manifest.sheets) {
    const previous = byName.get(s.name);
    if (!previous) drift.push(`${s.name}: absent from manifest.json`);
    else if (previous.pixelSha256 !== s.pixelSha256) drift.push(`${s.name}: pixels changed`);
    byName.delete(s.name);
  }
  for (const orphan of byName.keys()) drift.push(`${orphan}: in manifest.json but no longer generated`);
  if (drift.length > 0) {
    console.error("✗ scan targets drifted from manifest.json:\n" + drift.map((d) => `  ${d}`).join("\n"));
    console.error("\n  A printed sheet in somebody's cab is now a different sheet from the one recorded here.");
    console.error("  Bump targetsVersion, regenerate, REPRINT, and say so — measurements taken against the");
    console.error("  old print are not comparable with measurements taken against the new one.");
    process.exit(1);
  }
  console.log(`✓ scan targets match manifest.json (${manifest.sheets.length} sheets)`);
} else {
  for (const s of sheets) {
    writeFileSync(join(HERE, `${s.name}.png`), encodePng(s.canvas.rgb, s.canvas.width, s.canvas.height));
  }
  writeFileSync(join(HERE, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`✓ wrote ${manifest.sheets.length} target sheets + manifest.json`);
}
