/**
 * `@silvicom/qr` — QR encoding and label-sheet geometry (D-INV16).
 *
 * Pure, deterministic, and dependency-free of the workspace: it may not import `@silvicom/*`,
 * `@/*` or `@hazmat/*`, and it may not read a clock, a random source, the network or the
 * filesystem. Both halves of that are machine-checked by `lint:boundaries`, which scans this
 * package exactly as it scans `@hazmat/engine`.
 *
 * Encoding only. Decoding a camera frame is a different problem with a ~1 MiB WASM dependency and
 * lives with the scanner (§7, I6).
 */
export { encode, moduleSizeMm, DEFAULT_ECC, ECC_LEVELS, QUIET_ZONE_MODULES } from "./encode.js";
export type { EccLevel, EncodeOptions, QrMatrix } from "./encode.js";
export { toSvg, toSvgPath } from "./svg.js";
export type { SvgOptions } from "./svg.js";
export { labelSheet, LABEL_PRESETS, LABEL_PRESET_IDS, POINTS_PER_INCH } from "./labelSheet.js";
export type { LabelPreset, LabelPresetId, LabelPlacement, LabelSheet, LabelSheetOptions } from "./labelSheet.js";
