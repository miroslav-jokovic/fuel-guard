/**
 * captureGovInfo.ts (Phase H1, D5 v6) — capture the OFFICIAL GovInfo annual-edition CFR content for the
 * sections we verify (§172.101 HMT, §172.504 placard tables, §177.848 segregation) as the automated
 * SECOND SOURCE. The eCFR (Source A, current) is parsed by parseHmt/parsePlacards/parseSegregation; the
 * GovInfo annual edition is the *legally official* rendering, produced on a separate publication schedule
 * — so an automated diff of the two catches parser bugs across every row, reproducibly. Differences are
 * expected to be amendments since the Oct-1 edition and are reconciled against the Federal Register (the
 * `fedRegister*` tooling) + the eCFR corrections feed. The human role shrinks to attesting a clean report.
 *
 * The sandbox/CI cannot reach api.govinfo.gov, so run this locally (or on a Railway shell) with the key:
 *
 *   GOVINFO_API_KEY=xxxxx npx tsx import/captureGovInfo.ts
 *
 * It writes each granule's XML + a provenance record into import/fixtures/govinfo/ (gitignored — large
 * and regenerable, like the eCFR captures). It NEVER prints the api_key. It writes NOTHING to the dataset
 * (H1.6 — data ships only through the reviewed pipeline).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GovInfoClient } from "./govinfoClient.js";
import { resolveCfrSectionGranule, fetchGranuleXml, toProvenance, GOVINFO_SECTIONS } from "./govinfo.js";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "govinfo");

async function main(): Promise<void> {
  const client = new GovInfoClient(); // throws a clear message if GOVINFO_API_KEY is unset
  await mkdir(OUT_DIR, { recursive: true });

  const provenance: Record<string, unknown> = {};
  for (const [name, section] of Object.entries(GOVINFO_SECTIONS)) {
    process.stdout.write(`resolving official §${section} (${name})… `);
    const resolved = await resolveCfrSectionGranule(client, section);
    const xml = await fetchGranuleXml(client, resolved);
    const file = join(OUT_DIR, `${name}-${section.replace(/\./g, "-")}.xml`);
    await writeFile(file, xml);
    provenance[name] = toProvenance(resolved); // carries `section` (+ package/granule/edition ids)
    console.log(`edition ${resolved.editionYear} vol ${resolved.volume} → ${file} (${xml.length.toLocaleString()} chars)`);
  }

  const provFile = join(OUT_DIR, "provenance.json");
  await writeFile(provFile, JSON.stringify(provenance, null, 2) + "\n");
  console.log(`\nprovenance → ${provFile}`);
  console.log(
    "\nNext: paste the edition years above. I'll build the GovInfo-format HMT/placard/segregation parsers\n" +
      "against these real fixtures and wire the automated eCFR↔GovInfo cross-check into the release gate (D5 v6).",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
