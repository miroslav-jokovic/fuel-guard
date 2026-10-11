/**
 * Capture 40 CFR 302.4 — the CERCLA hazardous-substance list — from both official sources. Run LOCALLY
 * (CI/sandbox cannot reach ecfr.gov or govinfo.gov):
 *
 *   npx tsx import/captureCercla.ts
 *
 * Why a separate script (and not three more lines in captureFixtures.ts): 91 FR 49305 (FR doc
 * 2026-15809, effective 2026-12-02) replaces 49 CFR 172.101 Appendix A with "Refer to 40 CFR 302.4 to
 * see the list of hazardous substances and their reportable quantities (RQs) in Table 302.4", so the
 * `hazSubstances` table moves to Title 40. captureFixtures.ts re-captures §172.101/§172.504/§177.848 and
 * would overwrite the committed fixtures that reproduce 2026.07.1 and 2026.08.0 byte-for-byte
 * (PROMOTION-CHECKLIST §1); this script touches ONLY the two 302.4 files and their provenance.
 *
 * It writes:
 *   fixtures/section-40-302-4.xml              — Source A: eCFR versioner, Title 40 pinned to its own
 *                                                `up_to_date_as_of` (Title 40 and Title 49 move separately)
 *   fixtures/govinfo/cercla-302-4.xml          — Source B: the GovInfo CFR annual edition granule
 *   fixtures/govinfo/provenance-40-302-4.json  — which edition/volume/date both came from
 *
 * Source B needs NO api key: the CFR annual-edition granules are served at the public
 * `www.govinfo.gov/content/pkg/...` path (the same files the keyed api.govinfo.gov `xmlLink` returns).
 * Title 40 parts 300–399 are volume 30 of the July-1 edition; the script probes newest edition first
 * and accepts a response only if it is a real `<CFRGRANULE>` (govinfo answers a missing granule with an
 * HTML page and HTTP 200, so the status code alone proves nothing).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { EcfrClient } from "./ecfrClient.js";
import { CERCLA_SECTION, CERCLA_TITLE } from "./hazSubstancesSource.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
/** Title 40 volume probe order for Part 302 — vol 30 (parts 300–399) in every edition since 2017. */
const VOLUMES = [30, 29, 31];

export function govInfoCerclaUrl(year: number, volume: number): string {
  const pkg = `CFR-${year}-title${CERCLA_TITLE}-vol${volume}`;
  return `https://www.govinfo.gov/content/pkg/${pkg}/xml/${pkg}-sec${CERCLA_SECTION.replace(".", "-")}.xml`;
}

async function captureGovInfo(fromYear: number): Promise<{ xml: string; year: number; volume: number; url: string }> {
  for (let year = fromYear; year >= fromYear - 3; year--) {
    for (const volume of VOLUMES) {
      const url = govInfoCerclaUrl(year, volume);
      const res = await fetch(url);
      const body = await res.text();
      if (res.ok && body.includes("<CFRGRANULE") && body.includes("Table 302.4")) return { xml: body, year, volume, url };
    }
  }
  throw new Error(`captureCercla: no GovInfo edition of 40 CFR ${CERCLA_SECTION} found for ${fromYear - 3}–${fromYear}.`);
}

async function main(): Promise<void> {
  const client = new EcfrClient();
  const summary = await client.getTitleSummary(CERCLA_TITLE);
  const date = summary.up_to_date_as_of ?? summary.latest_issue_date;
  if (!date) throw new Error(`Title ${CERCLA_TITLE} has no up_to_date_as_of — cannot pin a date.`);
  await mkdir(join(FIXTURES, "govinfo"), { recursive: true });

  const ecfr = await client.getFullXml(date, CERCLA_TITLE, { section: CERCLA_SECTION });
  await writeFile(join(FIXTURES, "section-40-302-4.xml"), ecfr);
  console.log(`eCFR 40 CFR ${CERCLA_SECTION} @ ${date} → fixtures/section-40-302-4.xml (${ecfr.length.toLocaleString()} chars)`);

  const gov = await captureGovInfo(Number(date.slice(0, 4)));
  await writeFile(join(FIXTURES, "govinfo", "cercla-302-4.xml"), gov.xml);
  const dateIssued = /<DATE>([^<]+)<\/DATE>/.exec(gov.xml)?.[1] ?? null;
  const provenance = {
    ecfr: { title: CERCLA_TITLE, section: CERCLA_SECTION, date, latestAmendedOn: summary.latest_amended_on },
    govinfo: {
      source: "govinfo",
      collectionCode: "CFR",
      cfrTitle: CERCLA_TITLE,
      section: CERCLA_SECTION,
      packageId: `CFR-${gov.year}-title${CERCLA_TITLE}-vol${gov.volume}`,
      editionYear: gov.year,
      volume: gov.volume,
      dateIssued,
      xmlLink: gov.url,
    },
  };
  await writeFile(join(FIXTURES, "govinfo", "provenance-40-302-4.json"), JSON.stringify(provenance, null, 2) + "\n");
  console.log(`GovInfo ${provenance.govinfo.packageId} (${dateIssued}) → fixtures/govinfo/cercla-302-4.xml`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
