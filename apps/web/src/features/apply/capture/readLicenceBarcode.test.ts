// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { prepareZXingModule as prepareWriter, writeBarcode } from "zxing-wasm/writer";
import { AAMVA_ELEMENTS, AAMVA_ISSUERS, parseAamvaBarcode } from "@silvicom/shared";
import { readPdf417Texts } from "./licenceBarcodeReader";
import { readLicenceBarcode } from "./readLicenceBarcode";
import { aamvaStandardExample } from "./aamvaStandardExample";

/**
 * The licence barcode, against the standard it implements and through a real decoder (AW5).
 *
 * The parser's case-by-case tests are `packages/shared/src/aamvaBarcode.test.ts`. These are the ones
 * that read files, which that package cannot (no Node types, on purpose):
 *
 *  - §D.13's "example of raw PDF417 data", read out of the committed extraction of the 2020 standard
 *    (`docs/plans/recruitment/aamva/`). Its header states its own subfile offsets and lengths, so a
 *    transcription that dropped or added one byte fails on the STANDARD's numbers rather than on ours.
 *  - every element ID the parser reads, found in Table D.3 or D.4 of the same extraction;
 *  - `AAMVA_ISSUERS`, row for row against AAMVA's published IIN table;
 *  - the example drawn as a real PDF417 by zxing's own writer and decoded by the reader with the
 *    options the page uses — the `Plain` text mode is what keeps LF/RS/CR, and this is what proves it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCES = join(HERE, "../../../../../../docs/plans/recruitment/aamva");
const annex = readFileSync(join(SOURCES, "annex-d-12-13.txt"), "utf8");
const resolve = createRequire(import.meta.url).resolve;
const wasm = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(`zxing-wasm/${name}`)));

const standardExample = (): string => aamvaStandardExample(annex);

const EXAMPLE_READ = {
  aamvaVersion: 10,
  iin: "636000",
  issuingState: "VA",
  licenceNumber: "T64235789",
  familyName: "SAMPLE",
  firstName: "MICHAEL",
  middleName: "JOHN",
  dateOfBirth: "1986-06-06",
  expiresOn: "2024-12-10",
  address: { line1: "2300 WEST BROAD STREET", line2: null, city: "RICHMOND", state: "VA", postalCode: "23269" },
};

describe("the standard's own example (§D.13)", () => {
  const raw = standardExample();

  it("is transcribed byte for byte — its header's offsets and lengths land exactly", () => {
    // DL at 0041 for 0278, ZV at 0319 for 0008: the standard's own numbers.
    expect(raw.slice(41, 43)).toBe("DL");
    expect(raw[41 + 278 - 1]).toBe("\r");
    expect(raw.slice(319, 321)).toBe("ZV");
    expect(raw.length).toBe(319 + 8);
  });

  it("reads every field the form prefills", () => {
    expect(parseAamvaBarcode(raw)).toEqual(EXAMPLE_READ);
  });
});

describe("the sources the reader is written from", () => {
  it("reads only element IDs that Table D.3 or D.4 defines", () => {
    for (const id of Object.values(AAMVA_ELEMENTS)) {
      expect(annex, id).toMatch(new RegExp(`^\\s*[a-z.]+\\s+${id}\\s`, "m"));
    }
  });

  it("is AAMVA's IIN table, row for row", () => {
    const rows = readFileSync(join(SOURCES, "iin.tsv"), "utf8")
      .trim()
      .split("\n")
      .slice(1)
      .map((l) => l.split("\t"));
    expect(AAMVA_ISSUERS.map(([iin, name]) => [iin, name])).toEqual(rows.map((r) => [r[0], r[1]]));
  });
});

describe("a real PDF417, through the decoder the page loads", () => {
  it("decodes the standard's example drawn by zxing's writer, separators intact", async () => {
    prepareWriter({ overrides: { wasmBinary: wasm("writer/zxing_writer.wasm").buffer as ArrayBuffer }, fireImmediately: false });
    const drawn = await writeBarcode(standardExample(), { format: "PDF417", scale: 3 });
    expect(drawn.error).toBe("");
    const texts = await readPdf417Texts(drawn.image!, { wasmBinary: wasm("reader/zxing_reader.wasm").buffer as ArrayBuffer });
    expect(texts).toEqual([standardExample()]);
    expect(parseAamvaBarcode(texts[0]!)).toEqual(EXAMPLE_READ);
  }, 30_000);
});

describe("readLicenceBarcode — an unreadable barcode costs nothing", () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])]);

  it("answers the first text that is an AAMVA licence", async () => {
    const read = vi.fn(async () => ["https://example.com", standardExample()]);
    expect(await readLicenceBarcode(blob, async () => read)).toEqual(EXAMPLE_READ);
    expect(read).toHaveBeenCalledWith(blob);
  });

  it("is null when the photo holds no licence barcode", async () => {
    expect(await readLicenceBarcode(blob, async () => async () => [])).toBeNull();
    expect(await readLicenceBarcode(blob, async () => async () => ["not aamva"])).toBeNull();
  });

  it("is null, never a throw, when the decoder will not load or fails", async () => {
    expect(await readLicenceBarcode(blob, () => Promise.reject(new Error("offline")))).toBeNull();
    expect(await readLicenceBarcode(blob, async () => () => Promise.reject(new Error("wasm")))).toBeNull();
  });
});
