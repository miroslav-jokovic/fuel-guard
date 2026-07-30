/**
 * GovInfo live smoke test (Phase H1) — run with a REAL key to verify the integration end-to-end.
 *
 * The CI/sandbox network cannot reach api.govinfo.gov, so THIS is the verification step: run it on a
 * machine (or Railway shell) where GOVINFO_API_KEY is set. It exercises the whole path against the
 * live service and prints a report + a pass/fail on the fields we depend on. If a shape differs from
 * GPO's docs, this is where it shows up — paste the output and the client gets corrected.
 *
 *   GOVINFO_API_KEY=xxxxx npx tsx import/govinfoSmoke.ts
 *   # or:  node --experimental-strip-types import/govinfoSmoke.ts
 *
 * It NEVER prints the api_key. Nothing here writes to the dataset (H1.6 — data only via the reviewed
 * pipeline); it downloads the §172.101 legal PDF to /tmp only as proof the content path works.
 */

import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GovInfoClient } from "./govinfoClient.js";
import {
  resolveCfrSectionGranule,
  toProvenance,
  fetchLegalPdfBytes,
  fetchGranuleXml,
  GOVINFO_SECTIONS,
} from "./govinfo.js";

const PDF_MAGIC = "%PDF-";

function ok(label: string, pass: boolean, detail = ""): boolean {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  return pass;
}

async function main(): Promise<void> {
  const client = new GovInfoClient(); // throws early with a clear message if GOVINFO_API_KEY is unset
  let allPass = true;

  console.log("1) Collections — is CFR present?");
  const collections = await client.getCollections();
  const cfr = collections.collections.find((c) => c.collectionCode === "CFR");
  allPass = ok("CFR collection listed", Boolean(cfr), cfr ? `${cfr.packageCount} packages` : "not found") && allPass;

  console.log("\n2) Resolve the official §172.101 granule (HMT)…");
  const resolved = await resolveCfrSectionGranule(client, GOVINFO_SECTIONS.hmt);
  console.log(`   package : ${resolved.packageId}`);
  console.log(`   granule : ${resolved.granuleId}`);
  console.log(`   edition : ${resolved.editionYear} (vol ${resolved.volume}), resolvedBy=${resolved.resolvedBy}`);
  allPass = ok("granuleId contains sec172-101", resolved.granuleId.includes("172-101")) && allPass;

  console.log("\n3) Provenance record (goes onto the dataset for audit):");
  const prov = toProvenance(resolved);
  console.log(JSON.stringify(prov, null, 2));
  allPass = ok("dateIssued present", Boolean(prov.dateIssued), prov.dateIssued ?? "") && allPass;
  allPass = ok("pdfLink present", Boolean(prov.pdfLink)) && allPass;

  console.log("\n4) Legal PDF — download the section granule and check the magic bytes…");
  const pdf = await fetchLegalPdfBytes(client, resolved);
  const head = new TextDecoder().decode(pdf.slice(0, 8));
  const isPdf = head.startsWith(PDF_MAGIC);
  allPass = ok("looks like a PDF", isPdf, `${pdf.length.toLocaleString()} bytes, head="${head.replace(/\n/g, " ")}"`) && allPass;
  if (isPdf) {
    const out = join(tmpdir(), `${resolved.granuleId}.pdf`);
    await writeFile(out, pdf);
    console.log(`   saved → ${out} (the transcriber's source; not committed)`);
  }

  console.log("\n5) Granule XML — the cross-check tripwire input…");
  const xml = await fetchGranuleXml(client, resolved);
  allPass = ok("XML returned & non-trivial", xml.length > 200, `${xml.length.toLocaleString()} chars`) && allPass;

  console.log("\n6) The other two sections resolve too…");
  for (const [name, section] of [["placardTables", GOVINFO_SECTIONS.placardTables], ["segregation", GOVINFO_SECTIONS.segregation]] as const) {
    const r = await resolveCfrSectionGranule(client, section);
    console.log(`   ${name} §${section} → ${r.granuleId} (${r.resolvedBy})`);
  }

  console.log(`\n${allPass ? "✅ ALL CHECKS PASSED" : "❌ SOME CHECKS FAILED"} — GovInfo integration ${allPass ? "verified" : "needs a fix (paste this output)"}.`);
  if (!allPass) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
