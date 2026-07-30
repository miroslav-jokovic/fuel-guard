/**
 * Capture real eCFR fixtures (Phase H1 tooling) — run LOCALLY, where ecfr.gov is reachable.
 *
 * The CI/sandbox network is allow-listed and cannot reach ecfr.gov, so the real regulatory XML/JSON
 * is captured here, by a person, on their own machine — then committed as frozen fixtures under
 * `import/fixtures/`. Those fixtures are what the parser (`parseHmt.ts`) and the offline tests build
 * against, so nothing downstream ever depends on a live network call.
 *
 * Run (Node 22+, from packages/hazmat-data):
 *   node --experimental-strip-types import/captureFixtures.ts
 * or with tsx:
 *   npx tsx import/captureFixtures.ts
 *
 * It writes:
 *   fixtures/titles.json                 — currency signal (poller input)
 *   fixtures/versions-172.json           — dated versions of Part 172 sections
 *   fixtures/structure-title-49.json     — Title 49 structure tree
 *   fixtures/corrections-49.json         — Title 49 corrections
 *   fixtures/section-172-101.xml         — the HMT (parser input — the important one)
 *   fixtures/section-172-504.xml         — placarding tables
 *   fixtures/section-177-848.xml         — segregation grid
 *
 * These files are the SOURCE for the parser step. Do not edit them by hand — re-run this to refresh.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { EcfrClient } from "./ecfrClient.js";
import {
  HMT_TITLE,
  HMT_SECTION,
  PLACARD_TABLES_SECTION,
  SEGREGATION_SECTION,
  resolveImportContext,
} from "./ecfr.js";

async function main(): Promise<void> {
  const client = new EcfrClient();
  const ctx = await resolveImportContext(client);
  const dir = new URL("./fixtures/", import.meta.url);
  await mkdir(dir, { recursive: true });

  const write = async (name: string, content: string): Promise<void> => {
    await writeFile(new URL(name, dir), content);
    console.log(`wrote ${name} (${content.length.toLocaleString()} bytes)`);
  };

  await write("titles.json", JSON.stringify(await client.getTitles(), null, 2));
  await write("versions-172.json", JSON.stringify(await client.getVersions(HMT_TITLE, { part: "172" }), null, 2));
  await write("structure-title-49.json", JSON.stringify(await client.getStructure(ctx.date, HMT_TITLE), null, 2));
  await write("corrections-49.json", JSON.stringify(await client.getCorrectionsForTitle(HMT_TITLE), null, 2));
  await write("section-172-101.xml", await client.getFullXml(ctx.date, HMT_TITLE, { section: HMT_SECTION }));
  await write("section-172-504.xml", await client.getFullXml(ctx.date, HMT_TITLE, { section: PLACARD_TABLES_SECTION }));
  await write("section-177-848.xml", await client.getFullXml(ctx.date, HMT_TITLE, { section: SEGREGATION_SECTION }));

  console.log(`\nDate pinned: ${ctx.date} (Title ${HMT_TITLE} up_to_date_as_of=${ctx.summary.up_to_date_as_of}, ` +
    `latest_amended_on=${ctx.summary.latest_amended_on}).`);
  console.log("Next: inspect section-172-101.xml and build parseHmt.ts against its real structure.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
