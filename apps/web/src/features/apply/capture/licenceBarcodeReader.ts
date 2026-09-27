import { prepareZXingModule, readBarcodes, type ReaderOptions, type ZXingModuleOverrides } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

/**
 * The PDF417 decoder, and the ONLY file that imports `zxing-wasm` (AW5, §6.6.4, §6.8).
 *
 * ⚠ **Never import this statically.** It is reached through `readLicenceBarcode.ts`'s dynamic
 * `import()`, which is what keeps ~930 KiB of WebAssembly (measured: `zxing_reader.wasm`, 3.1.4) and
 * its glue out of the apply route's ≤ 200 KiB budget: a driver who never reaches the CDL's back never
 * downloads it.
 *
 * ── WHY THE WASM COMES FROM OUR ORIGIN ────────────────────────────────────────────────────────
 * The package's default `locateFile` fetches the binary from the jsDelivr CDN. That would put a third
 * party in the path of a page holding a driver's licence, and the CSP's `connect-src` refuses it anyway
 * (`appHttp.ts`). So Vite emits the binary as one of our own assets (`?url`) and the override points at
 * it. Compiling it needs `'wasm-unsafe-eval'` in `script-src`, which permits WebAssembly compilation
 * and nothing else — no `eval`, no other origin (`appHttp.ts`, pinned by its test).
 */

/**
 * PDF417 only, one symbol, and the text as the bytes were — `Plain`, never the default `HRI`, because
 * the AAMVA separators (LF, RS, CR) are the structure the parser reads.
 */
export const PDF417_READER_OPTIONS: ReaderOptions = {
  formats: ["PDF417"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: false,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
  textMode: "Plain",
};

const OWN_ORIGIN_WASM: ZXingModuleOverrides = {
  locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
};

let prepared = false;

/** Every valid PDF417 text in a photograph. `overrides` is for a test, which loads the binary from disk. */
export async function readPdf417Texts(photo: Blob, overrides: ZXingModuleOverrides = OWN_ORIGIN_WASM): Promise<string[]> {
  if (!prepared) {
    prepareZXingModule({ overrides, fireImmediately: false });
    prepared = true;
  }
  const results = await readBarcodes(photo, PDF417_READER_OPTIONS);
  return results.filter((r) => r.isValid).map((r) => r.text);
}
