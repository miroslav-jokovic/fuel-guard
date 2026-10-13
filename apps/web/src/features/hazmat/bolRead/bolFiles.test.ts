import { beforeAll, describe, expect, it } from "vitest";
import { ASSEMBLY_MAX_PAGES, INTAKE_LIMITS, INTAKE_REFUSALS } from "@silvicom/shared";
import { formatOf } from "@/lib/fileFormat";
import { addFiles, BOL_ACCEPT, canPreview, fileProblem, includedFiles, moveFile, removeFile, toggleFile } from "./bolFiles";

/**
 * The photos picked for one BOL (N2). The order shown is the order read, so the mistakes that matter are
 * a list that reorders itself, an unticked photo that is read anyway, and a real photo refused because of
 * what it is CALLED — an iPhone HEIC a desktop browser types as "", a Google Voice JPEG named `.jfif`
 * (10/12/2026: the dispatcher could not add the photos drivers send).
 */
const MAGIC: Record<string, number[]> = {
  jpeg: [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0], // FF D8 FF E0 … "JFIF\0"
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  heic: [0, 0, 0, 0x18, ...[..."ftypheic"].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...[..."mif1heic"].map((c) => c.charCodeAt(0))],
  tiff: [0x49, 0x49, 0x2a, 0],
  pdf: [...[..."%PDF-1.7"].map((c) => c.charCodeAt(0))],
  text: [...[..."Bill of lading notes"].map((c) => c.charCodeAt(0))],
};
const bytes = (kind: string, size: number) => { const b = new Uint8Array(size); b.set(MAGIC[kind]!.slice(0, size)); return b; };
const file = (name: string, kind = "jpeg", { type = "", size = 1000, lastModified = 1 } = {}) =>
  new File([bytes(kind, size)], name, { type, lastModified });
let n = 0;
const key = () => `k${++n}`;

describe("formatOf / fileProblem", () => {
  it("knows a file by its bytes, never its name or type — a .jfif is a JPEG, a HEIC typed '' is a HEIC", async () => {
    expect(await formatOf(file("IMG_20261012.jfif"))).toBe("jpeg");
    expect(await formatOf(file("IMG_0001.HEIC", "heic"))).toBe("heic");
    expect(await formatOf(file("scan.tif", "tiff"))).toBe("tiff");
    expect(await formatOf(file("bol", "pdf", { type: "application/octet-stream" }))).toBe("pdf");
    expect(await formatOf(file("photo.jpg", "png", { type: "image/jpeg" }))).toBe("png");
    expect(await formatOf(file("bol.jpg", "text", { type: "image/jpeg" }))).toBeNull();
  });

  it("refuses with the intake's own sentence: an unreadable format, a file over the size limit, an empty file", () => {
    expect(fileProblem({ size: 10 }, null)).toBe(INTAKE_REFUSALS.unsupported_format);
    expect(fileProblem({ size: INTAKE_LIMITS.maxBytes + 1 }, "jpeg")).toBe(INTAKE_REFUSALS.too_large);
    expect(fileProblem({ size: 0 }, null)).toBe(INTAKE_REFUSALS.decode_failed);
    expect(fileProblem({ size: INTAKE_LIMITS.maxBytes }, "jpeg")).toBeNull();
  });

  it("offers every image to the picker, and lists .jfif and .tif by name for a desktop dialog", () => {
    expect(BOL_ACCEPT.split(",")).toEqual(expect.arrayContaining(["image/*", "application/pdf", ".jfif", ".tif", ".heic", ".pdf"]));
  });
});

describe("addFiles", () => {
  it("appends in the order picked, ticked, after what is there, and says why it skipped any", async () => {
    const first = (await addFiles([], [file("1.jpg"), file("2.jpg")], key)).files;
    const { files, skipped } = await addFiles(first, [file("3.jpg"), file("x.txt", "text"), file("1.jpg")], key);
    expect(files.map((f) => [f.file.name, f.included])).toEqual([["1.jpg", true], ["2.jpg", true], ["3.jpg", true]]);
    expect(skipped).toEqual([
      { name: "x.txt", reason: INTAKE_REFUSALS.unsupported_format },
      { name: "1.jpg", reason: "Already added." },
    ]);
  });

  it("declares the format the bytes are, under its canonical mime — a Google Voice .jfif goes up as image/jpeg", async () => {
    const { files } = await addFiles([], [file("voice.jfif"), file("IMG_1.HEIC", "heic", { type: "image/jpeg" }), file("fax.tiff", "tiff")], key);
    expect(files.map((f) => f.mime)).toEqual(["image/jpeg", "image/heic", "image/tiff"]);
  });

  it("refuses an empty file as unreadable without reading it", async () => {
    expect((await addFiles([], [file("a.jpg", "jpeg", { size: 0 })], key)).skipped).toEqual([{ name: "a.jpg", reason: INTAKE_REFUSALS.decode_failed }]);
  });

  it("stops at one document's page limit", async () => {
    const many = Array.from({ length: ASSEMBLY_MAX_PAGES + 2 }, (_, i) => file(`${i}.jpg`));
    const { files, skipped } = await addFiles([], many, key);
    expect(files).toHaveLength(ASSEMBLY_MAX_PAGES);
    expect(skipped.map((s) => s.name)).toEqual([`${ASSEMBLY_MAX_PAGES}.jpg`, `${ASSEMBLY_MAX_PAGES + 1}.jpg`]);
  });
});

describe("moving, unticking and removing", () => {
  let three: () => ReturnType<typeof includedFiles>;
  beforeAll(async () => {
    const fs = (await addFiles([], [file("a.jpg"), file("b.jpg"), file("c.jpg")], key)).files;
    three = () => fs.map((f) => ({ ...f }));
  });
  const names = (fs: { file: File }[]) => fs.map((f) => f.file.name);

  it("moves a file one place either way, and a move past either end changes nothing", () => {
    expect(names(moveFile(three(), 2, -1))).toEqual(["a.jpg", "c.jpg", "b.jpg"]);
    expect(names(moveFile(three(), 0, 1))).toEqual(["b.jpg", "a.jpg", "c.jpg"]);
    expect(names(moveFile(three(), 0, -1))).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(names(moveFile(three(), 2, 1))).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  it("reads only the ticked files, in the order shown", () => {
    const fs = three();
    const unticked = toggleFile(moveFile(fs, 2, -1), fs[0]!.key);
    expect(names(includedFiles(unticked))).toEqual(["c.jpg", "b.jpg"]);
    expect(names(includedFiles(toggleFile(unticked, fs[0]!.key)))).toEqual(["a.jpg", "c.jpg", "b.jpg"]);
    expect(names(removeFile(fs, fs[1]!.key))).toEqual(["a.jpg", "c.jpg"]);
  });

  it("previews what every browser can draw, and shows a file tile for PDF, HEIC and TIFF", () => {
    expect(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/tiff", "application/pdf"].map((m) => canPreview(m as never)))
      .toEqual([true, true, true, true, true, false, false, false]);
  });
});
