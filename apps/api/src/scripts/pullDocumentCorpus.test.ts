import { describe, it, expect } from "vitest";
import { CORPUS_DIR, labelsSkeleton, photoUrls } from "./pullDocumentCorpus.js";

describe("pullDocumentCorpus", () => {
  it("writes only inside the gitignored private corpus folder", () => {
    // The PII rule (`fixtures/real/README.md`): a real BOL may never land anywhere a commit can reach.
    expect(CORPUS_DIR.replaceAll("\\", "/")).toMatch(/packages\/capture-engine\/fixtures\/real\/private\/documents$/);
  });

  it("starts every label empty, so a labeller reads the paper rather than agreeing with a guess", () => {
    const l = labelsSkeleton(["pages/1.jpg", "pages/2.jpg"]);
    expect(l.pages).toEqual([
      { file: "pages/1.jpg", class: null, band: null, assignedBy: null },
      { file: "pages/2.jpg", class: null, band: null, assignedBy: null },
    ]);
    expect(l.identity.bolNumber).toBeNull();
    expect(l.hazmat.lines).toEqual([]);
    expect(l.labelledBy).toEqual([]);
  });

  it("finds each photo's fresh url by id in the raw item", () => {
    const urls = photoUrls({
      fields: [
        { type: "photo", value: { photoValue: [{ id: "p1", url: "https://s3.samsara.com/1" }, { id: "p2" }] } },
        { type: "string", value: { stringValue: "x" } },
      ],
    });
    expect([...urls]).toEqual([["p1", "https://s3.samsara.com/1"]]);
  });
});
