/**
 * Regenerate datasets/erg2024.json from the committed ERG PDF (Phase H1 deliverable 4).
 *
 * ONE-TIME / at ERG 2028. Requires poppler's `pdftotext` on PATH (`brew install poppler`). Run from
 * packages/hazmat-data:
 *   node --experimental-strip-types import/ergExtract.ts
 *   # or: npx tsx import/ergExtract.ts
 *
 * It extracts the yellow ID Number Index (physical pages 30–89), parses it with `parseErgIdIndex`,
 * asserts every fuel id is present (fails otherwise), and writes datasets/erg2024.json with the PDF
 * SHA-256 for provenance. It never invents rows — the JSON is exactly what the official PDF says.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseErgIdIndex, verifyErg, ERG_MULTI_GUIDE_IDS } from "./erg.js";

const PDF_URL = new URL("../datasets/ERG2024-Eng-Web-a.pdf", import.meta.url);
const OUT_URL = new URL("../datasets/erg2024.json", import.meta.url);
const FIRST_PAGE = 30; // physical PDF page where the yellow ID Number Index begins (printed Page 28)
const LAST_PAGE = 89; //  … and ends (printed Page 87; the blue Name Index starts at physical 90)

function pdftotextLayout(pdfPath: string): string {
  try {
    return execFileSync(
      "pdftotext",
      ["-layout", "-f", String(FIRST_PAGE), "-l", String(LAST_PAGE), pdfPath, "-"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      // Keep the original ENOENT as `cause`: the actionable install hint is the message, but the
      // underlying errno is what you need if the failure is something other than a missing binary.
      throw new Error(
        "`pdftotext` not found — install poppler (macOS: `brew install poppler`; Debian: `apt install poppler-utils`).",
        { cause: err },
      );
    }
    throw err;
  }
}

function main(): void {
  const pdfPath = fileURLToPath(PDF_URL);
  const text = pdftotextLayout(pdfPath);
  const entries = parseErgIdIndex(text);
  const v = verifyErg(entries);
  if (!v.ok) {
    throw new Error(`ERG extraction failed — missing fuel IDs: ${v.missingFuelIds.join(", ")}`);
  }

  const sha256 = createHash("sha256").update(readFileSync(pdfPath)).digest("hex");
  const doc = {
    edition: "2024",
    source: "Emergency Response Guidebook 2024 (English) — U.S. DOT/PHMSA · Transport Canada · SCT Mexico",
    sourceFile: "ERG2024-Eng-Web-a.pdf",
    sourceUrl: "https://www.phmsa.dot.gov/sites/phmsa.dot.gov/files/2024-04/ERG2024-Eng-Web-a.pdf",
    index: "Yellow-bordered ID Number Index (printed pages 28-87 / physical PDF pages 30-89)",
    pdfSha256: sha256,
    frozenUntil: "ERG 2028",
    note:
      "One-time extraction of the ID Number Index (ID No. -> Guide No.). guideNumber is faithful to " +
      "the ERG incl. a trailing 'P' polymerization marker (guide PAGE = guideNumber without the P). " +
      "Some IDs map to multiple guides by form and appear as multiple entries. '— —' no-ID rows excluded.",
    entryCount: entries.length,
    uniqueIdCount: v.uniqueIds,
    multiGuideIds: Object.keys(v.multiGuide).sort(),
    entries,
  };
  writeFileSync(fileURLToPath(OUT_URL), JSON.stringify(doc, null, 2) + "\n");

  console.log(`Wrote datasets/erg2024.json — ${entries.length} entries, ${v.uniqueIds} unique IDs.`);
  console.log(`Multi-guide IDs: ${Object.keys(v.multiGuide).join(", ") || "none"} (expected: ${ERG_MULTI_GUIDE_IDS.join(", ")}).`);
}

main();
