import { describe, expect, it } from "vitest";
import { ASSEMBLY_MAX_PAGES, INTAKE_LIMITS, INTAKE_REFUSALS } from "@silvicom/shared";
import { addFiles, canPreview, fileProblem, includedFiles, mimeOf, moveFile, removeFile, toggleFile } from "./bolFiles";

/**
 * The photos picked for one BOL (N2). The order shown is the order read, so the mistakes that matter are
 * a list that reorders itself, an unticked photo that is read anyway, and an iPhone photo refused because
 * a desktop browser reports its type as "".
 */
const file = (name: string, type = "image/jpeg", size = 1000, lastModified = 1) => new File([new Uint8Array(size)], name, { type, lastModified });
let n = 0;
const key = () => `k${++n}`;

describe("mimeOf / fileProblem", () => {
  it("takes the browser's type, else the extension — an iPhone HEIC reported as '' is still a HEIC", () => {
    expect(mimeOf({ name: "a.jpg", type: "image/jpeg" })).toBe("image/jpeg");
    expect(mimeOf({ name: "IMG_0001.HEIC", type: "" })).toBe("image/heic");
    expect(mimeOf({ name: "bol.pdf", type: "application/octet-stream" })).toBe("application/pdf");
    expect(mimeOf({ name: "notes.txt", type: "text/plain" })).toBeNull();
  });

  it("refuses with the intake's own sentence: an unreadable type, a file over the size limit, an empty file", () => {
    expect(fileProblem({ name: "notes.txt", type: "text/plain", size: 10 })).toBe(INTAKE_REFUSALS.unsupported_format);
    expect(fileProblem({ name: "a.jpg", type: "image/jpeg", size: INTAKE_LIMITS.maxBytes + 1 })).toBe(INTAKE_REFUSALS.too_large);
    expect(fileProblem({ name: "a.jpg", type: "image/jpeg", size: 0 })).toBe(INTAKE_REFUSALS.decode_failed);
    expect(fileProblem({ name: "a.jpg", type: "image/jpeg", size: INTAKE_LIMITS.maxBytes })).toBeNull();
  });
});

describe("addFiles", () => {
  it("appends in the order picked, ticked, after what is there, and says why it skipped any", () => {
    const first = addFiles([], [file("1.jpg"), file("2.jpg")], key).files;
    const { files, skipped } = addFiles(first, [file("3.jpg"), file("x.txt", "text/plain"), file("1.jpg")], key);
    expect(files.map((f) => [f.file.name, f.included])).toEqual([["1.jpg", true], ["2.jpg", true], ["3.jpg", true]]);
    expect(skipped).toEqual([
      { name: "x.txt", reason: INTAKE_REFUSALS.unsupported_format },
      { name: "1.jpg", reason: "Already added." },
    ]);
  });

  it("stops at one document's page limit", () => {
    const many = Array.from({ length: ASSEMBLY_MAX_PAGES + 2 }, (_, i) => file(`${i}.jpg`));
    const { files, skipped } = addFiles([], many, key);
    expect(files).toHaveLength(ASSEMBLY_MAX_PAGES);
    expect(skipped.map((s) => s.name)).toEqual([`${ASSEMBLY_MAX_PAGES}.jpg`, `${ASSEMBLY_MAX_PAGES + 1}.jpg`]);
  });
});

describe("moving, unticking and removing", () => {
  const three = () => addFiles([], [file("a.jpg"), file("b.jpg"), file("c.jpg")], key).files;
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

  it("previews what a browser can draw, and shows a file tile for PDF and HEIC", () => {
    expect(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"].map((m) => canPreview(m as never)))
      .toEqual([true, true, true, false, false]);
  });
});
