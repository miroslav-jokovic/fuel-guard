import { describe, expect, it } from "vitest";
import { DOCUMENT_CONTENT_TYPES, EMPLOYER_RESPONSE_CONTENT_TYPES, INVENTORY_PHOTO_CONTENT_TYPES } from "@silvicom/shared";
import { uploadContentType } from "./fileFormat";

/**
 * The content type every upload declares comes from the file's bytes, not the browser's guess from its name:
 * a Google Voice `.jfif` is a JPEG, and desktop Chrome types an iPhone HEIC as "" (10/12/2026).
 */
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const BYTES = {
  jpeg: [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, ...ascii("JFIF"), 0],
  heic: [0, 0, 0, 0x18, ...ascii("ftypheic"), 0, 0, 0, 0, ...ascii("mif1heic")],
  pdf: ascii("%PDF-1.7\n"),
  tiff: ascii("II*\0"),
  text: ascii("not a picture"),
};
const file = (name: string, kind: keyof typeof BYTES, type = "") => new File([new Uint8Array(BYTES[kind])], name, { type });

describe("uploadContentType", () => {
  it("declares a Google Voice .jfif as image/jpeg, and a HEIC the browser typed '' as image/heic", async () => {
    expect(await uploadContentType(file("voice.jfif", "jpeg"), DOCUMENT_CONTENT_TYPES)).toBe("image/jpeg");
    expect(await uploadContentType(file("IMG_0001.HEIC", "heic"), DOCUMENT_CONTENT_TYPES)).toBe("image/heic");
  });

  it("believes the bytes over the name and the browser's type", async () => {
    expect(await uploadContentType(file("scan.jpg", "pdf", "image/jpeg"), DOCUMENT_CONTENT_TYPES)).toBe("application/pdf");
    expect(await uploadContentType(file("photo.jpg", "text", "image/jpeg"), DOCUMENT_CONTENT_TYPES)).toBeNull();
  });

  it("answers null for a real format this upload does not take — each surface keeps its own list", async () => {
    expect(await uploadContentType(file("IMG_1.HEIC", "heic"), EMPLOYER_RESPONSE_CONTENT_TYPES)).toBeNull();
    expect(await uploadContentType(file("letter.pdf", "pdf"), INVENTORY_PHOTO_CONTENT_TYPES)).toBeNull();
    expect(await uploadContentType(file("fax.tif", "tiff"), DOCUMENT_CONTENT_TYPES)).toBeNull();
  });
});
