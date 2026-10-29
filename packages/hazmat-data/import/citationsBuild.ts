/**
 * Verify datasets/citations.json against eCFR and write each entry's evidence (TWO-CLICK-READER-PLAN TC0.5).
 *
 *   npx tsx import/citationsBuild.ts [YYYY-MM-DD]     (default: eCFR's latest Title 49 date)
 *
 * For every entry: fetch its section, find the paragraph its designators name (citationParagraph.ts), and require
 * every `mustSay` phrase in that paragraph's text. A phrase not there is a citation that does not say what the engine
 * uses it for — the build FAILS and names it, and writes nothing. On success each entry gets its section, paragraph,
 * the excerpt around its first phrase and the eCFR URL; the file gets the eCFR date and today's date.
 *
 * `cfr` and `mustSay` are the person's; nothing here edits them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EcfrClient } from "./ecfrClient.js";
import { resolveImportContext } from "./ecfr.js";
import { extractSectionText } from "./referenceText.js";
import { paragraphAt } from "./citationParagraph.js";
import { parseCitation } from "../src/referenceText.js";
import { citationListSchema, normaliseCfrText, type CitationList } from "../src/citations.js";

const FILE = fileURLToPath(new URL("../datasets/citations.json", import.meta.url));

async function main(): Promise<void> {
  const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>;
  const list: CitationList = citationListSchema.parse(raw);
  const client = new EcfrClient();
  const ctx = await resolveImportContext(client);
  const date = process.argv[2] ?? ctx.date;

  const sections = new Map<string, ReturnType<typeof extractSectionText>>();
  const failures: string[] = [];
  for (const entry of list.citations) {
    const { sectionNumber, designators } = parseCitation(entry.cfr);
    if (!sectionNumber) { failures.push(`${entry.cfr}: no section number`); continue; }
    // "172.200-172.204" names a range; its first section is the one read.
    if (!sections.has(sectionNumber)) {
      const xml = await client.getFullXml(date, 49, { section: sectionNumber });
      sections.set(sectionNumber, extractSectionText(xml, { sectionNumber, sourceVersion: date }));
    }
    const text = paragraphAt(sections.get(sectionNumber)!.paragraphs, designators);
    if (text === null) { failures.push(`${entry.cfr}: §${sectionNumber} has no paragraph (${designators.join(")(")})`); continue; }
    const norm = normaliseCfrText(text);
    const missing = entry.mustSay.filter((p) => !norm.includes(normaliseCfrText(p)));
    if (missing.length) { failures.push(`${entry.cfr}: the paragraph does not say ${missing.map((m) => JSON.stringify(m)).join(", ")}`); continue; }
    const at = norm.indexOf(normaliseCfrText(entry.mustSay[0]!));
    entry.section = sectionNumber;
    entry.paragraph = designators.map((d) => `(${d})`).join("") || null;
    entry.excerpt = norm.slice(Math.max(0, at - 120), at + normaliseCfrText(entry.mustSay[0]!).length + 200);
    entry.source = `https://www.ecfr.gov/on/${date}/title-49/section-${sectionNumber}${designators.length ? `#p-${sectionNumber}(${designators.join(")(")})` : ""}`;
  }
  if (failures.length) {
    console.error(`${failures.length} citation(s) fail against eCFR ${date}; nothing written:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  const out = { _note: raw._note, ...list, ecfrDate: date, readOn: new Date().toISOString().slice(0, 10) };
  writeFileSync(FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote datasets/citations.json — ${list.citations.length} citations verified against eCFR ${date}.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
