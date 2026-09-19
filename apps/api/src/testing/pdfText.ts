/**
 * Reading back a PDF this API drew, for the tests that assert what is on the page.
 *
 * ── WHY A TEST HELPER AND NOT A LIBRARY ───────────────────────────────────────────────────────
 * pdfkit deflates its content streams, so the raw bytes of a rendered document carry none of its
 * words — `expect(pdf.toString()).toContain("Susan")` passes on nothing and fails on nothing. This
 * inflates every stream it can and pulls the text-showing operands out, which is enough to assert
 * that a sentence reached the paper. It is deliberately not a PDF parser: a document that draws the
 * right words in the wrong place passes here, which is exactly why every step that changes printing
 * also rasterises the result and LOOKS at it.
 *
 * ⚠ Promoted out of the application preview's suite on 2026-09-18, when B2's permissions document
 * became the second caller. Copying twenty-five lines of stream-inflating into a second test file is
 * how two documents come to be asserted by two slightly different readers — the smaller cousin of the
 * A2 defect this whole module family exists to have caught.
 */

/** The text a reader would see, with no layout — everything the content streams draw, concatenated. */
export async function pdfText(pdf: Buffer): Promise<string> {
  const { inflateSync } = await import("node:zlib");
  const raw = pdf.toString("latin1");
  let out = "";
  const re = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      out += inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1");
    } catch {
      // Not a deflate stream (a font subset, the xref) — nothing to read here.
    }
  }
  return (out.match(/<[0-9a-fA-F\s]+>|\((?:\\.|[^\\)])*\)/g) ?? [])
    .map((token) =>
      token.startsWith("<")
        ? Buffer.from(token.slice(1, -1).replace(/\s+/g, ""), "hex").toString("latin1")
        : token.slice(1, -1).replace(/\\([()\\])/g, "$1"),
    )
    .join("");
}

/** How many sheets a reader would hold. */
export async function pdfPageCount(pdf: Buffer): Promise<number> {
  const { PDFDocument } = await import("pdf-lib");
  return (await PDFDocument.load(pdf, { ignoreEncryption: true })).getPageCount();
}
