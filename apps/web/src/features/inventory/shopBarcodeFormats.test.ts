// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { prepareZXingModule as prepareWriter, writeBarcode, type WriteInputBarcodeFormat } from "zxing-wasm/writer";
import { readStickerCode } from "@silvicom/shared";
import { readBarcodeTexts } from "@/lib/barcode/barcodeReader";
import { SCAN_PAGE_READER, STICKER_READER } from "./shopBarcodeFormats";

/**
 * The shop's camera formats, through the real decoder the camera loads (M9c). Each barcode is drawn by zxing's
 * own writer and read back with the options the screen passes — so a format dropped from a list, or a text
 * mode that mangles the characters, fails here rather than in a technician's hand.
 */

const resolve = createRequire(import.meta.url).resolve;
const wasm = (name: string): ArrayBuffer => new Uint8Array(readFileSync(resolve(`zxing-wasm/${name}`))).buffer as ArrayBuffer;
const READER_WASM = { wasmBinary: wasm("reader/zxing_reader.wasm") };

prepareWriter({ overrides: { wasmBinary: wasm("writer/zxing_writer.wasm") }, fireImmediately: false });

async function drawn(text: string, format: WriteInputBarcodeFormat): Promise<Blob> {
  const out = await writeBarcode(text, { format, scale: 3 });
  expect(out.error).toBe("");
  return out.image!;
}

/** A real-shaped IMEI: 15 digits whose last is the Luhn check (`isImei`). */
const IMEI = "356938035643809";

describe("the sticker camera reads what a tablet's sticker carries", () => {
  it("reads an IMEI drawn as Code 128, and the sticker rules take it as an IMEI", async () => {
    const texts = await readBarcodeTexts(await drawn(IMEI, "Code128"), STICKER_READER, READER_WASM);
    expect(texts).toEqual([IMEI]);
    expect(readStickerCode(texts[0]!)).toMatchObject({ kind: "imei", imei: IMEI });
  }, 30_000);

  it("reads a serial and a model drawn as Code 128, characters as printed", async () => {
    for (const text of ["R52W70ABCDE", "SM-T575"]) {
      expect(await readBarcodeTexts(await drawn(text, "Code128"), STICKER_READER, READER_WASM)).toEqual([text]);
    }
  }, 30_000);

  it("reads the box's EAN-13, so the field can say it is not needed", async () => {
    const texts = await readBarcodeTexts(await drawn("8806090572593", "EAN-13"), STICKER_READER, READER_WASM);
    expect(texts).toEqual(["8806090572593"]);
    expect(readStickerCode(texts[0]!).kind).toBe("box_barcode");
  }, 30_000);
});

describe("the Scan page's camera reads everything the Scan page resolves", () => {
  it("reads our own QR label, a tablet's Code 128 and a carton's UPC-A", async () => {
    expect(await readBarcodeTexts(await drawn("SIL1:BIN:7K3M9P", "QRCode"), SCAN_PAGE_READER, READER_WASM)).toEqual(["SIL1:BIN:7K3M9P"]);
    expect(await readBarcodeTexts(await drawn(IMEI, "Code128"), SCAN_PAGE_READER, READER_WASM)).toEqual([IMEI]);
    expect(await readBarcodeTexts(await drawn("036000291452", "UPC-A"), SCAN_PAGE_READER, READER_WASM)).toEqual(["036000291452"]);
  }, 30_000);
});
