import { encode as uqrEncode } from "uqr";

/**
 * QR encoding for inventory labels (D-INV16, `docs/plans/maintenance/INVENTORY-PLAN.md` I1b).
 *
 * A thin, deliberate layer over `uqr`. It exists for three reasons rather than as a wrapper for its
 * own sake: it fixes the defaults this product needs (ECC-H, no baked-in border), it hands back a
 * shape whose only field is the module grid so nothing downstream depends on `uqr`'s result type,
 * and it is where the determinism guarantee is asserted (`lint:boundaries` scans this package the
 * way it scans `@hazmat/engine`).
 *
 * ── PURE, AND MECHANICALLY SO ───────────────────────────────────────────────────────────────────
 * No clock, no randomness, no I/O, no workspace imports. The same string encodes to the same matrix
 * on the API that draws the PDF and in the browser that previews it, which is the property that
 * makes I10's pixel comparison between the two meaningful at all. `uqr`'s mask pattern defaults to
 * automatic, and "automatic" is a penalty-score computation over the data rather than a choice —
 * measured stable across calls, and pinned by the golden fixtures at every ECC level.
 *
 * ── NO DECODING, EVER ───────────────────────────────────────────────────────────────────────────
 * Out of scope by D-INV16 and §7. Reading a camera frame is a different problem with a different
 * dependency (a ~1 MiB WASM build), and it lives with the scanner at I6.
 */

/** Error correction level. `H` recovers 30 % and is what a greasy shop label needs (D-INV25). */
export const ECC_LEVELS = ["L", "M", "Q", "H"] as const;
export type EccLevel = (typeof ECC_LEVELS)[number];

/**
 * The default, and it is not a tuning knob. §2.4: a tag on a bin gets grease, and a tag on a
 * trailer gets a pressure washer and road salt. The cost of ECC-H is a slightly larger symbol,
 * which the payload budget below shows we can afford several times over.
 */
export const DEFAULT_ECC: EccLevel = "H";

/**
 * The quiet zone, in modules, on every side. Four is the QR specification's requirement and the
 * figure research §4.7 cites; it is NOT decoration, and a symbol printed hard against a box edge
 * is the classic label that will not scan.
 *
 * It is deliberately not baked into the matrix. `encode` returns the symbol alone, so `size` is the
 * real version-determined module count (17 + 4 × version) and a caller can assert on it; the quiet
 * zone is applied at render time by `toSvg`, because it is layout rather than data.
 */
export const QUIET_ZONE_MODULES = 4;

export interface QrMatrix {
  /** Modules per side, excluding the quiet zone. Always 17 + 4 × version. */
  size: number;
  /** QR version, 1–40. Recorded because the label's physical module size depends on it. */
  version: number;
  /** Row-major, `true` for dark. `modules[row][col]`. */
  modules: boolean[][];
}

export interface EncodeOptions {
  ecc?: EccLevel;
}

/**
 * Encode a string into a QR matrix.
 *
 * `border: 0` is passed through deliberately — see `QUIET_ZONE_MODULES`. Everything else is left at
 * `uqr`'s defaults, including automatic mask selection, because overriding the mask would mean
 * reimplementing the penalty scoring the specification defines and we have no reason to disagree
 * with it.
 */
export function encode(text: string, options: EncodeOptions = {}): QrMatrix {
  const result = uqrEncode(text, { ecc: options.ecc ?? DEFAULT_ECC, border: 0 });
  return {
    size: result.size,
    version: result.version,
    modules: result.data.map((row) => [...row]),
  };
}

/**
 * The narrowest printed feature of a symbol, in millimetres, when it is printed at `widthMm` across
 * INCLUDING its quiet zone.
 *
 * This is the number that decides whether a label scans, and it is here rather than in a comment
 * because I10 has to be able to check a preset against it. Research §4.7 puts the floor for a phone
 * camera at about 0.4 mm; the same source's "~0.69 mm at 1 inch" figure is a version-3 symbol
 * measured with its quiet zone, which is the convention reproduced here.
 *
 * Measured 2026-09-08: `SIL1:AST:7K3M9P` at ECC-H encodes to **version 2, 25 × 25** — smaller than
 * the version-4 ceiling §2.4 budgeted for. On a 1-inch label that is 25.4 / (25 + 8) ≈ 0.77 mm per
 * module, comfortably clear of the floor, with room for a longer tag kind later.
 */
export function moduleSizeMm(matrix: QrMatrix, widthMm: number): number {
  return widthMm / (matrix.size + QUIET_ZONE_MODULES * 2);
}
