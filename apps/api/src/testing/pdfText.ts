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
  return decodeShownText(out);
}

/**
 * The same text, split PER PAGE and in page order.
 *
 * ── ⚠ WHY THIS IS NOT `pdfText` WITH A SPLIT ─────────────────────────────────────────────────
 * `pdfText` above walks the raw bytes for anything that inflates, which cannot say which page a
 * stream belonged to — the font subsets and the xref sit among them in file order, not page order.
 * This walks the PAGE TREE instead and reads each page's own `Contents`, so what comes back is
 * "what a reader sees on sheet n".
 *
 * ⚠ **Each stream of a page is inflated SEPARATELY and the results joined, never the other way
 * round.** A page may carry an ARRAY of content streams and the spec concatenates them after
 * decoding; joining the compressed bytes and inflating once yields the first and silently drops the
 * rest. `packetTemplate.ts` learned that on the carrier's file, where every page has exactly one
 * stream and the defect stayed invisible for a day.
 *
 * ⚠ Still not a PDF parser, and the limit is the same one stated above: it can say a row is on the
 * WRONG SHEET, which is a fact about order and page membership. It cannot say a row is in the wrong
 * PLACE on its sheet — that needs a raster and a pair of eyes.
 */
export async function pdfPageTexts(pdf: Buffer): Promise<string[]> {
  const { inflateSync } = await import("node:zlib");
  const { PDFArray, PDFDocument, PDFStream } = await import("pdf-lib");
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });

  const inflate = (stream: InstanceType<typeof PDFStream>): string => {
    const raw = Buffer.from(stream.getContents());
    try {
      return inflateSync(raw).toString("latin1");
    } catch {
      return raw.toString("latin1");
    }
  };

  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    if (!contents) return "";
    const body =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => inflate(doc.context.lookup(ref, PDFStream))).join("\n")
        : inflate(contents as InstanceType<typeof PDFStream>);
    return decodeShownText(body);
  });
}

/**
 * The words out of a content stream's text-showing operands.
 *
 * ⚠ **The drawn text is neither one string per line nor plain ASCII.** pdfkit emits kerned runs of
 * HEX strings — `Driver employment application` arrives as
 * `[<44726976657220656d706c6f> 20 <796d656e74…>] TJ` — so the words a reader sees only exist once
 * the hex is decoded and the runs are joined. Literal `(…)` strings are decoded too, because pdfkit
 * uses them for some fonts and a reader that handled only one form would silently find nothing and
 * make every assertion vacuous.
 */
function decodeShownText(stream: string): string {
  return (stream.match(/<[0-9a-fA-F\s]+>|\((?:\\.|[^\\)])*\)/g) ?? [])
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
