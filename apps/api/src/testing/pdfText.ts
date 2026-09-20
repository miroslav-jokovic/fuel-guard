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
  return (await pageStreams(pdf)).map(decodeShownText);
}

/** Each page's decoded content stream, in sheet order. */
async function pageStreams(pdf: Buffer): Promise<string[]> {
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
    return contents instanceof PDFArray
      ? contents.asArray().map((ref) => inflate(doc.context.lookup(ref, PDFStream))).join("\n")
      : inflate(contents as InstanceType<typeof PDFStream>);
  });
}

/** One run of drawn text, where pdfkit put it. `y` is points DOWN from the top of the sheet. */
export interface DrawnLine {
  page: number;
  x: number;
  y: number;
  /** The point size in force, which is how a caption is told from the body beneath it. */
  size: number;
  /**
   * The font RESOURCE name — `/F1`, `/F2` — not a typeface.
   *
   * ⚠ Deliberately raw. Resolving it to "Helvetica-Bold" means reading the page's font dictionary,
   * and a test that hardcoded `/F2` would pin an allocation order rather than a weight. Compare a
   * run's font with that of a run known to be bold (any `field()` value is) and the assertion says
   * what it means (AUD-9).
   */
  font: string;
  /**
   * The fill colour in force when the run was drawn, `#rrggbb`.
   *
   * ⚠ Carried because DANGER is the one place in this family where colour is allowed to mean
   * something, so "is this drawn as a warning" is a real question a test must be able to ask. It is
   * tracked as STREAM STATE — the `scn` operator precedes the `BT` block and persists — so this
   * reads the last fill set before each run. ⚠ Lowercase `scn` only: `SCN` sets the STROKE colour,
   * and the two interleave on any page carrying a rule.
   */
  color: string;
  text: string;
}

/**
 * Every run of text a pdfkit document drew, with its position — for the claims text cannot carry.
 *
 * ── ⚠ WHY THIS EXISTS BESIDE `pdfPageTexts` AND DOES NOT REPLACE IT (AUD-8, 2026-09-20) ───────
 * Five defects in a row have had the same shape: every string is in the content stream whether the
 * layout is right or wrong, so a text assertion is green either way. AUD-8 is the purest case —
 * `Version v0-draft` printed identically when it sat 1.96pt above the rows it looked like one of
 * and when it sat 9.84pt above them, and only the second is a caption. What discriminates is where
 * the renderer put it, which is what this returns.
 *
 * ⚠ **It reads the OUTPUT, not a helper's opinion of the output.** AUD-19 shipped a test that asked
 * a placement function where a notice should go; the draw loop ignored the function, the mutant
 * survived and the collision stayed in the document. So this parses the drawn stream and nothing
 * else.
 *
 * ⚠ It is still not a PDF parser. pdfkit sets its text matrix per run as `1 0 0 1 x y Tm` inside a
 * flipped `1 0 0 -1 0 H cm`, so `H - y` is the distance down the page — true of every run this
 * module's documents emit and NOT true of PDFs in general. Rotated text (the band `stamp.ts` draws)
 * uses a different matrix and is deliberately not matched, which is why the band never appears here.
 */
export async function pdfDrawnLines(pdf: Buffer): Promise<DrawnLine[]> {
  const { PDFDocument } = await import("pdf-lib");
  const heights = (await PDFDocument.load(pdf, { ignoreEncryption: true }))
    .getPages()
    .map((p) => p.getHeight());

  // ⚠ One alternation, scanned in ORDER, because the fill colour is state set outside the run it
  // applies to — two passes would have to re-derive which `scn` was in force and could not.
  const token =
    /(?<r>[\d.]+) (?<g>[\d.]+) (?<b>[\d.]+) scn|BT\s+1 0 0 1 (?<x>-?[\d.]+) (?<y>-?[\d.]+) Tm\s+(?<font>\/\w+) (?<size>[\d.]+) Tf\s+(?<body>.*?)\s*ET/gs;
  const hex = (v: string): string =>
    Math.round(Number(v) * 255).toString(16).padStart(2, "0");

  return (await pageStreams(pdf)).flatMap((stream, page) => {
    const height = heights[page] ?? 792;
    let fill = "#000000";
    const lines: DrawnLine[] = [];
    for (const m of stream.matchAll(token)) {
      const g = m.groups!;
      if (g.r !== undefined) {
        fill = `#${hex(g.r)}${hex(g.g!)}${hex(g.b!)}`;
        continue;
      }
      lines.push({
        page,
        x: Number(g.x),
        y: height - Number(g.y!),
        size: Number(g.size),
        font: g.font!,
        color: fill,
        text: decodeShownText(g.body ?? ""),
      });
    }
    return lines;
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

/**
 * Where a page's horizontal rules were stroked — points down from the top, per sheet.
 *
 * ⚠ A rule is not text and `pdfDrawnLines` cannot see one, which matters because a rule is how
 * these documents separate a header block from a body. On the permissions PDF's first sheet it sat
 * 7.65pt under the lede and 10.39pt above the carrier rows, so it read as an UNDERLINE on the lede
 * rather than as the separator it is — a fact no assertion about words could reach (AUD-8).
 *
 * ⚠ These coordinates are already the distance down the page. pdfkit flips the whole content stream
 * once with `1 0 0 -1 0 792 cm` and then un-flips inside each text block, so paths are drawn in the
 * flipped space and text is not — which is why this does not subtract from the page height and
 * `pdfDrawnLines` does.
 */
export async function pdfDrawnRules(pdf: Buffer): Promise<Array<{ page: number; y: number }>> {
  const stroke = /(-?[\d.]+) (-?[\d.]+) m\s+(-?[\d.]+) (-?[\d.]+) l\s+S/g;
  return (await pageStreams(pdf)).flatMap((stream, page) =>
    [...stream.matchAll(stroke)]
      .filter((m) => m[2] === m[4])
      .map((m) => ({ page, y: Number(m[2]) })),
  );
}
