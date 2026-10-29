/**
 * A barcode's text as a handheld scanner types it — so a camera read and a trigger pull are the same string.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────────────────────────
 * Every screen behind the shop's camera was built for the Tera Pro's keystrokes first (`useScanInput`), and
 * looks codes up by EQUALITY — a part by its UPC (`findPartsByUpc`), a tablet by IMEI or serial. So the camera
 * must hand over the exact characters the handheld would have typed, or the same carton finds its part with
 * one and "not found" with the other.
 *
 * Measured 2026-10-29 (M9c), zxing-wasm 3.1.4: a UPC-A comes back as THIRTEEN digits with a leading 0 — as
 * format `UPCA` when UPC-A alone is asked for, and as `EAN13` when EAN-13 is asked for too. A UPC-A symbol IS
 * an EAN-13 whose first digit is 0 (the bars are identical), and a handheld's factory default transmits it as
 * the twelve digits printed under it. So a 13-digit `0…` read is cut to twelve. Every other read is unchanged.
 */
export function asHandheldTypesIt(format: string, text: string): string {
  if ((format === "UPCA" || format === "EAN13") && /^0\d{12}$/.test(text)) return text.slice(1);
  return text;
}
