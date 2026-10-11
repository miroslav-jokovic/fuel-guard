/**
 * The AAMVA 2020 standard's own licence example (Annex D §D.13) as the exact bytes a PDF417 carries — FOR
 * TESTS: the barcode unit tests read it back through zxing, and the browser specs print it on the fake
 * camera's licence (`e2e-apply/cameraFeed.ts`). One transcription, so the two cannot drift apart.
 *
 * `annex` is `docs/plans/recruitment/aamva/annex-d-12-13.txt`, read by the caller: this file has no IO, so
 * it runs in Node and in the browser alike. Nothing in the app imports it.
 */
/** §D.13's example as bytes: each printed line ends in the name of its separator (LF / CR). */
export function aamvaStandardExample(annex: string): string {
  const start = annex.indexOf("@LFRSCR");
  const end = annex.indexOf("ZVZVA01CR") + "ZVZVA01CR".length;
  const lines = annex
    .slice(start, end)
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.includes("© AAMVA"));
  return lines
    .map((l, i) => {
      if (i === 0) return "@\n\u001e\r";
      const line = l.replace(/^\s+/, "");
      // ⚠ `DAK` is F11 — FIXED at eleven characters (Table D.3 p.) — and the PDF's text layer gives
      // "232690000 " (ten): a run of spaces printed as one. Padded to its fixed width, both of the
      // header's numbers below land to the byte; left as extracted, both are one short.
      if (line.startsWith("DAK")) return `${line.slice(0, -2).trimEnd().padEnd(3 + 11, " ")}\n`;
      if (line.endsWith("LF")) return `${line.slice(0, -2)}\n`;
      if (line.endsWith("CR")) return `${line.slice(0, -2)}\r`;
      throw new Error(`unterminated example line: ${line}`);
    })
    .join("");
}
