import type { ReaderOptions } from "zxing-wasm/reader";

/**
 * What the shop's camera reads (M9c). A type-only import: these are plain objects, and the decoder they are
 * handed to is loaded only when the camera opens (`lib/barcode/barcodeReader.ts`).
 *
 * `HRI`, the default text mode, is right for both — unlike `/apply`'s PDF417, where the AAMVA separators are
 * the structure, these barcodes are just the characters printed under them, which is what the Tera types.
 */

/**
 * The sticker on a tablet's back: makers print the IMEI, serial and model as Code 128, the symbology the Tera
 * is set up for. ⚠ Not yet seen on the shop's own stickers — M5, the owner's pass with a real tablet, is where a
 * second symbology would show up, and it would be added here. The box's retail barcode is EAN-13 or UPC-A, read
 * so `readStickerCode` can say it is not needed rather than the camera seeming to ignore it. Up to four symbols
 * a frame — a sticker carries three, and a sweep can catch them together.
 */
export const STICKER_READER: ReaderOptions = {
  formats: ["Code128", "EAN-13", "UPC-A"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: false,
  tryDownscale: true,
  maxNumberOfSymbols: 4,
};

/**
 * The Scan page: everything `/shop/scan` resolves — our own labels (QR, `packages/qr`), a tablet's sticker
 * (Code 128), and a supplier's carton (EAN-13, UPC-A). One symbol: one code is one lookup.
 */
export const SCAN_PAGE_READER: ReaderOptions = {
  formats: ["QRCode", "Code128", "EAN-13", "UPC-A"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: false,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
};
