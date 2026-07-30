/**
 * Build datasets/referenceText.json (Phase H1, D12) — the citation-keyed CFR display text.
 *
 * Runs LOCALLY (eCFR reachable). Uses the eCFR client to fetch each cited section's XML, extracts
 * readable paragraphs, and writes the store. Display + audit only — never read by the engine.
 *
 *   npx tsx import/referenceTextBuild.ts
 *
 * The section list is the set our rule catalog cites. Grow it as rules are added (H2/H3); an unknown
 * citation just links out to eCFR rather than showing inline text, so a missing section is graceful.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EcfrClient } from "./ecfrClient.js";
import { resolveImportContext } from "./ecfr.js";
import { extractSectionText } from "./referenceText.js";
import type { ReferenceStore } from "../src/referenceText.js";

const OUT_URL = new URL("../datasets/referenceText.json", import.meta.url);

/** Sections HazmatGuard cites for display. Keep in sync with the H2/H3 rule catalogs. */
export const REFERENCE_SECTIONS = [
  "172.101", // HMT purpose & use
  "172.102", // special provisions
  "172.201", "172.202", "172.203", "172.204", // shipping paper description + certification
  "172.301", "172.302", "172.303", // marking
  "172.322", "172.336", // marine pollutant / ID-number marking
  "172.504", "172.505", "172.519", // placarding: general, subsidiary, general placard specs
  "173.150", // flammable/combustible liquid exceptions
  "177.848", // segregation
] as const;

async function main(): Promise<void> {
  const client = new EcfrClient();
  const ctx = await resolveImportContext(client);
  const store: ReferenceStore = {
    version: ctx.date,
    provisional: false,
    source: `eCFR Title 49 @ ${ctx.date}`,
    sections: {},
  };

  for (const section of REFERENCE_SECTIONS) {
    const xml = await client.getFullXml(ctx.date, ctx.title, { section });
    const ref = extractSectionText(xml, { sectionNumber: section, sourceVersion: ctx.date });
    store.sections[section] = ref;
    console.log(`  ${section}  "${ref.subject}"  (${ref.paragraphs.length} paragraphs)`);
  }

  writeFileSync(fileURLToPath(OUT_URL), JSON.stringify(store, null, 2) + "\n");
  console.log(`\nWrote datasets/referenceText.json — ${Object.keys(store.sections).length} sections @ ${ctx.date}.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
