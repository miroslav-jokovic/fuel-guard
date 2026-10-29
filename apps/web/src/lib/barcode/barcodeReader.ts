import { prepareZXingModule, readBarcodes, type ReaderOptions, type ZXingModuleOverrides } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { asHandheldTypesIt } from "./handheldText";

/**
 * The barcode decoder, and the ONLY file that imports `zxing-wasm` (AW5, §6.6.4, §6.8). Moved here from
 * `/apply` in M9c (2026-10-29), when the shop's sticker field and Scan page got a camera (`BarcodeCamera.vue`):
 * the decoder is the same and only the formats differ, so each caller passes its own `ReaderOptions` —
 * `/apply`'s PDF417 in `licenceBarcodeReader.ts`, the shop's in `shopBarcodeFormats.ts`.
 *
 * ⚠ **Never import this statically.** Every caller reaches it through a dynamic `import()`, which is what
 * keeps ~930 KiB of WebAssembly (measured: `zxing_reader.wasm`, 3.1.4) and its glue out of the apply route's
 * ≤ 200 KiB budget and out of the shop's pages: a driver who never reaches the CDL's back, and a technician who
 * never opens the camera, never downloads it.
 *
 * ── WHY THE WASM COMES FROM OUR ORIGIN ────────────────────────────────────────────────────────
 * The package's default `locateFile` fetches the binary from the jsDelivr CDN. That would put a third
 * party in the path of a page holding a driver's licence, and the CSP's `connect-src` refuses it anyway
 * (`appHttp.ts`). So Vite emits the binary as one of our own assets (`?url`) and the override points at
 * it. Compiling it needs `'wasm-unsafe-eval'` in `script-src`, which permits WebAssembly compilation
 * and nothing else — no `eval`, no other origin (`appHttp.ts`, pinned by its test).
 */

const OWN_ORIGIN_WASM: ZXingModuleOverrides = {
  locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
};

let prepared = false;

/**
 * Every valid barcode text in a photograph, or in a frame of a live camera (`ImageData`, read as it is — no
 * encode to a file and back, five times a second), as a handheld would have typed it (`handheldText.ts`; a
 * PDF417 is never touched). `overrides` is for a test, which loads the binary from disk.
 */
export async function readBarcodeTexts(
  photo: Blob | ImageData,
  options: ReaderOptions,
  overrides: ZXingModuleOverrides = OWN_ORIGIN_WASM,
): Promise<string[]> {
  if (!prepared) {
    prepareZXingModule({ overrides, fireImmediately: false });
    prepared = true;
  }
  const results = await readBarcodes(photo, options);
  return results.filter((r) => r.isValid).map((r) => asHandheldTypesIt(r.format, r.text));
}
