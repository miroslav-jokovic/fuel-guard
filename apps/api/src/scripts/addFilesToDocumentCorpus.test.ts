import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { shippingDocumentLabelsSchema } from "@silvicom/shared";
import { corpusEntryFor } from "./addFilesToDocumentCorpus.js";
import { faxScanPdf, pagesPdf } from "../modules/document-reading/pages/__fixtures__/fixtures.js";

describe("addFilesToDocumentCorpus", () => {
  it("files a PDF as its rendered pages, named by content hash, with an all-empty label skeleton", async () => {
    const pdf = await pagesPdf(2);
    const result = await corpusEntryFor("0001234.pdf", pdf);
    if (!result.ok) throw new Error(result.code);
    const { id, files } = result.entry;
    expect(id).toBe(`file-${createHash("sha256").update(pdf).digest("hex").slice(0, 16)}`);
    expect(files.map((f) => f.name)).toEqual(["source.pdf", "pages/1.png", "pages/2.png", "meta.json", "labels.json"]);
    expect(files[0]!.bytes.equals(pdf)).toBe(true);

    const meta = JSON.parse(files.find((f) => f.name === "meta.json")!.bytes.toString());
    expect(meta.source).toMatchObject({ fileName: "0001234.pdf", format: "pdf", declaredMimeMatches: true });
    // Each page's hash is the PNG's actually written beside it — the page hash a read's cache key uses.
    expect(meta.pages.map((p: { sha256: string }) => p.sha256)).toEqual(
      files.filter((f) => f.name.startsWith("pages/")).map((f) => createHash("sha256").update(f.bytes).digest("hex")),
    );

    const labels = shippingDocumentLabelsSchema.parse(JSON.parse(files.find((f) => f.name === "labels.json")!.bytes.toString()));
    expect(labels.pages.map((p) => [p.file, p.class, p.band])).toEqual([["pages/1.png", null, null], ["pages/2.png", null, null]]);
    expect(labels.identity.bolNumber).toBeNull();
  });

  it("files a CCITT scan with ink on its page (the office samples' format)", async () => {
    const result = await corpusEntryFor("scan.pdf", await faxScanPdf());
    if (!result.ok) throw new Error(result.code);
    const meta = JSON.parse(result.entry.files.find((f) => f.name === "meta.json")!.bytes.toString());
    expect(meta.pages).toEqual([expect.objectContaining({ width: 2550, height: 3300, dpi: 300, textLayerWords: null })]);
  });

  it("reports the stage's refusal and files nothing", async () => {
    expect(await corpusEntryFor("notes.pdf", Buffer.from("%PDF-1.7\nnot really"))).toEqual({ ok: false, code: "decode_failed" });
  });
});
