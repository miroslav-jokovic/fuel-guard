import type { ReaderOptions, ZXingModuleOverrides } from "zxing-wasm/reader";
import { readBarcodeTexts } from "@/lib/barcode/barcodeReader";

/**
 * The licence's PDF417, through the shared decoder (`lib/barcode/barcodeReader.ts`, moved there in M9c).
 *
 * ⚠ **Never import this statically** either: it imports the decoder, so it is reached through
 * `readLicenceBarcode.ts`'s dynamic `import()` — the WASM stays out of the apply route's budget.
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

/** Every valid PDF417 text in a photograph or a live frame. `overrides` is for a test, which loads the binary from disk. */
export const readPdf417Texts = (photo: Blob | ImageData, overrides?: ZXingModuleOverrides): Promise<string[]> =>
  readBarcodeTexts(photo, PDF417_READER_OPTIONS, overrides);
