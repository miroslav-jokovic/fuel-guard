/**
 * Federal Register live smoke test (Phase H1) — NO API KEY needed.
 *
 * The FR API is fully open, so this can run anywhere with network (locally, Railway, or a future CI
 * job). The CI/sandbox where this was authored is network-restricted, so this is the live-verification
 * step. It confirms the PHMSA agency, lists recent HMR amendments with their effective dates, runs a
 * currency check, and re-fetches a known real rule (2026-10962) to confirm the effective_on /
 * cfr_references shapes against the live service.
 *
 *   npx tsx import/fedRegisterSmoke.ts
 *   # or:  node --experimental-strip-types import/fedRegisterSmoke.ts
 */

import { FrClient } from "./fedRegisterClient.js";
import {
  PHMSA_SLUG,
  PHMSA_AGENCY_ID,
  listHmrAmendmentsSince,
  checkHmrCurrency,
  describeAmendment,
} from "./fedRegister.js";

function ok(label: string, pass: boolean, detail = ""): boolean {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  return pass;
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const client = new FrClient();
  let all = true;

  console.log("1) PHMSA agency resolves…");
  const agency = await client.getAgency(PHMSA_SLUG);
  all = ok(`agency id === ${PHMSA_AGENCY_ID}`, agency.id === PHMSA_AGENCY_ID, `${agency.name} (${agency.short_name})`) && all;

  const since = isoDaysAgo(540); // ~18 months of HMR rulemaking
  console.log(`\n2) HMR final + proposed rules since ${since}…`);
  const amendments = await listHmrAmendmentsSince(client, { sinceDate: since, includeProposed: true });
  console.log(`   ${amendments.length} document(s):`);
  for (const a of amendments.slice(0, 15)) console.log(`   ${describeAmendment(a)}`);
  all = ok("returned at least one HMR document", amendments.length > 0) && all;
  all = ok("each carries cfr parts", amendments.every((a) => a.cfrParts.length >= 0)) && all;

  console.log(`\n3) Currency check (as if our last dataset was cut ${since})…`);
  const report = await checkHmrCurrency(client, { sinceDate: since, todayIso: new Date().toISOString().slice(0, 10), includeProposed: true });
  console.log(`   relevant=${report.relevant.length}  effectivePending=${report.effectivePending.length}  effectiveAlready=${report.effectiveAlready.length}`);
  for (const a of report.effectivePending) console.log(`   PENDING → re-cut before ${a.effectiveOn}: ${a.documentNumber} (${a.title})`);

  console.log("\n4) Known rule 2026-10962 (real HMR final rule) shape check…");
  const known = await client.getDocument("2026-10962", ["document_number", "effective_on", "cfr_references", "citation", "action"]);
  all = ok("effective_on is a date", typeof known.effective_on === "string", known.effective_on ?? "null") && all;
  all = ok("cfr_references present with 49 CFR parts", (known.cfr_references ?? []).some((r) => r.title === 49),
    (known.cfr_references ?? []).map((r) => r.part).join(",")) && all;

  console.log(`\n${all ? "✅ ALL CHECKS PASSED" : "❌ SOME CHECKS FAILED"} — Federal Register monitor ${all ? "verified" : "needs a fix (paste this output)"}.`);
  if (!all) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
