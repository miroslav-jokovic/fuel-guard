import { describe, it, expect } from "vitest";
import { graphFolderReader } from "./graphFolder.js";
import type { GraphRequester } from "./graphMail.js";

/**
 * The read-only folder reader's attachment half (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §4). What matters is
 * what it asks Graph for: PDFs only, always through `$value` (Graph omits `contentBytes` above ~4 MB and the
 * 2026-11 invoice is 4.3 MB), and never a write — the owner reads this mailbox.
 */
function fakeGraph(attachments: unknown[]) {
  const calls: { path: string; method: string }[] = [];
  const rq: GraphRequester = {
    base: "/users/miki%40x.test",
    async graph(path, init) {
      calls.push({ path, method: init?.method ?? "GET" });
      if (path.endsWith("/$value")) return new Response(Buffer.from(`bytes of ${path.split("/").at(-2)}`));
      return new Response(JSON.stringify({ value: attachments }));
    },
  };
  return { rq, calls };
}

describe("graphFolderReader.pdfAttachments", () => {
  it("returns only PDF file attachments, each fetched raw through $value, and never writes", async () => {
    const { rq, calls } = fakeGraph([
      { id: "a1", name: "Standard_Invoice_Gen_Template_INV-59656.pdf", contentType: "application/pdf", size: 4_330_285 },
      { id: "a2", name: "logo.png", contentType: "image/png", size: 2_000 },
      { id: "a3", name: "db139445S.PDF", contentType: "application/octet-stream", size: 30_000 },
      { id: "a4", name: "forwarded.pdf", "@odata.type": "#microsoft.graph.itemAttachment", size: 10 },
    ]);
    const pdfs = await graphFolderReader(rq).pdfAttachments("m1");
    expect(pdfs.map((p) => [p.name, p.bytes.toString()])).toEqual([
      ["Standard_Invoice_Gen_Template_INV-59656.pdf", "bytes of a1"],
      ["db139445S.PDF", "bytes of a3"],
    ]);
    expect(calls.map((c) => c.path)).toEqual([
      "/users/miki%40x.test/messages/m1/attachments?$select=id,name,contentType,size",
      "/users/miki%40x.test/messages/m1/attachments/a1/$value",
      "/users/miki%40x.test/messages/m1/attachments/a3/$value",
    ]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("skips an attachment far larger than any weekly bill", async () => {
    const { rq } = fakeGraph([{ id: "big", name: "huge.pdf", contentType: "application/pdf", size: 90 * 1024 * 1024 }]);
    expect(await graphFolderReader(rq).pdfAttachments("m1")).toEqual([]);
  });
});
