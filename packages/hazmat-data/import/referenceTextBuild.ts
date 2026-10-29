/**
 * Build datasets/referenceText.json (Phase H1, D12) — the citation-keyed CFR display text.
 *
 * Runs LOCALLY (eCFR reachable). Uses the eCFR client to fetch each cited section's XML, extracts
 * readable paragraphs, and writes the store. Display + audit only — never read by the engine.
 *
 *   npx tsx import/referenceTextBuild.ts [YYYY-MM-DD]     (default: the verified list's eCFR date)
 *
 * The sections are DERIVED from datasets/citations.json — every section a verified citation names
 * (TWO-CLICK-READER-PLAN TC0.5/Q-TC6 (a), 2026-10-29). Until then this file kept its own list of 16, which
 * missed 24 of the 39 sections the engine cites (§171.4, §171.8, §172.315, §172.331–.334, every placard-design
 * section …) and held one it does not (§172.519) — and was never run, so the store was empty and every
 * /reference request answered 404. Read at the list's date, so a citation and the text shown for it are the
 * same printing of the CFR.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EcfrClient } from "./ecfrClient.js";
import { resolveImportContext } from "./ecfr.js";
import { readFileSync } from "node:fs";
import { extractSectionText } from "./referenceText.js";
import { parseCitation, type ReferenceStore } from "../src/referenceText.js";
import { citationListSchema } from "../src/citations.js";

const OUT_URL = new URL("../datasets/referenceText.json", import.meta.url);

const CITATIONS = citationListSchema.parse(JSON.parse(readFileSync(new URL("../datasets/citations.json", import.meta.url), "utf8")));

/** Every section a verified citation names, in section order. A range ("172.200-172.204") names its first. */
export const REFERENCE_SECTIONS: readonly string[] = [
  ...new Set(CITATIONS.citations.map((c) => parseCitation(c.cfr).sectionNumber).filter((s): s is string => s !== null)),
].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

async function main(): Promise<void> {
  const client = new EcfrClient();
  const ctx = await resolveImportContext(client);
  const date = process.argv[2] ?? CITATIONS.ecfrDate ?? ctx.date;
  const store: ReferenceStore = {
    version: date,
    provisional: false,
    source: `eCFR Title 49 @ ${date}`,
    sections: {},
  };

  for (const section of REFERENCE_SECTIONS) {
    const xml = await client.getFullXml(date, ctx.title, { section });
    const ref = extractSectionText(xml, { sectionNumber: section, sourceVersion: date });
    store.sections[section] = ref;
    console.log(`  ${section}  "${ref.subject}"  (${ref.paragraphs.length} paragraphs)`);
  }

  writeFileSync(fileURLToPath(OUT_URL), JSON.stringify(store, null, 2) + "\n");
  console.log(`\nWrote datasets/referenceText.json — ${Object.keys(store.sections).length} sections @ ${date}.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
