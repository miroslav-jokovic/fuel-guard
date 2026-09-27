import { parseAamvaBarcode, type AamvaLicence } from "@silvicom/shared";

/**
 * Read the licence's barcode from the photograph of its back (AW5, §6.6.4).
 *
 * ── AN UNREADABLE BARCODE COSTS NOTHING ───────────────────────────────────────────────────────
 * Every failure — the decoder would not load (offline, an old browser without WebAssembly), the photo
 * holds no PDF417, the PDF417 is not an AAMVA licence — is `null`, and `null` means the driver types
 * what they would have typed anyway. Nothing here throws, and nothing here blocks the photo, which is
 * already staged by the time this runs.
 *
 * The decoder is loaded on the first call, not before (`licenceBarcodeReader.ts` says why).
 */
export type Pdf417Reader = (photo: Blob) => Promise<string[]>;

const loadReader = async (): Promise<Pdf417Reader> =>
  (await import("./licenceBarcodeReader")).readPdf417Texts;

export async function readLicenceBarcode(
  photo: Blob,
  load: () => Promise<Pdf417Reader> = loadReader,
): Promise<AamvaLicence | null> {
  try {
    const read = await load();
    for (const text of await read(photo)) {
      const licence = parseAamvaBarcode(text);
      if (licence) return licence;
    }
    return null;
  } catch {
    return null;
  }
}
