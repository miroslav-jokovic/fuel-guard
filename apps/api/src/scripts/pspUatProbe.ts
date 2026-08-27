import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  parsePspReport,
  resolveCarrierIdentity,
  validatePspRequest,
  type PspRequestDraft,
} from "@silvicom/shared";
import { loadEnv, pspApiKey, pspApiKeyVar, type Env } from "../env.js";
import { PspError, fetchMonitoringReport, fetchRecordPdf, pspHost, requestRecord } from "../psp/client.js";

/**
 * Exercise the PSP vendor edge against the UAT account, and keep what comes back.
 *
 * THIS IS THE ONE PLACE `POST /Records` MAY BE CALLED BY HAND. The rule everywhere else — never call
 * it outside a test that scripts `fetch` — exists because §8 charges for 'Success', 'Partial' AND
 * 'Failure', and there is no idempotency header, so a retry is a second charge. That rule is not
 * suspended here; it is discharged by three guards that all have to agree before a request leaves:
 *
 *   1. `PSP_ENVIRONMENT` must be `uat`.
 *   2. `PSP_PRODUCTION_ACKNOWLEDGED` must NOT be true — the production interlock, read in reverse.
 *   3. The resolved host must be the UAT host, compared as a string.
 *
 * Guard 3 looks redundant against guard 1 and is not. `pspHost` reads a map keyed by the same
 * variable guard 1 checks, so both would follow a bad edit to that map together; the literal is the
 * only check that does not. The cost of the three agreeing wrongly is a real invoice.
 *
 * ── WHY IT DOES NOT WRITE TO THE DATABASE ──────────────────────────────────────────────────────
 * `orderPspRecord` needs a `drivers` row and signed `driver_authorizations`, and it appends to
 * `documents` and `qualification_records` — evidence tables, append-only, pinned in
 * RETENTION_FORBIDDEN. The only Supabase this repo is configured against is production. Seeding
 * fourteen synthetic FMCSA test drivers there to learn the shape of a vendor response would put rows
 * that cannot be deleted into the carrier's real DQ evidence. So this stops at the vendor edge: it
 * proves the request shape, the parser, and the round-trip, and the full order stays the operator's
 * runbook job against a database somebody chose on purpose.
 *
 * The raw body is written to `docs/psp-docs/uat-runs/` (gitignored) BEFORE it is parsed, because the
 * parse is the thing under test. If the projection is wrong the evidence survives and the parser is
 * fixed without buying the same record twice.
 *
 *   pnpm psp:uat --verify-key               # does the configured token belong to this environment?
 *   pnpm psp:uat --list                     # the roster, no network
 *   pnpm psp:uat --driver thomas            # dry run: what would be sent, and what validation says
 *   pnpm psp:uat --driver thomas --order    # the live call
 *   pnpm psp:uat --driver thomas --order --pdf   # and fetch the PDF on the same authCode (§7)
 */

/** A licence as the request carries it; `dl*` names mirror `PspLicenceQuery` so nothing is renamed twice. */
interface TestLicence {
  dlNum: string;
  dlState: string;
}

/**
 * The 14 drivers from `PSP Test Data 3 2019.xlsx`, which support supplied with this UAT account.
 *
 * Synthetic FMCSA test data, not personal data — the same table already reads in UAT-RUNBOOK.md §4.
 * DOBs arrive in the workbook as Excel serials and are converted here once, to ISO, because
 * `validatePspRequest` validates ours and `toPspDate` converts to theirs at the edge.
 *
 * Support's instruction was to IGNORE THE DATES on the inspections and crashes: they predate the
 * 3-year inspection / 5-year crash windows, and the records still return.
 */
const ROSTER: Record<
  string,
  { firstName: string; lastName: string; dob: string; licences: TestLicence[]; exercises: string }
> = {
  thomas: {
    firstName: "Gary",
    lastName: "Thomas",
    dob: "1974-07-07",
    licences: [
      { dlNum: "G12345678", dlState: "GA" },
      { dlNum: "P123456789", dlState: "PA" },
    ],
    exercises: "two licences — the only route to the Partial (status 4) path",
  },
  davis: {
    firstName: "Jose",
    lastName: "Davis",
    dob: "1975-11-06",
    licences: [{ dlNum: "T123456789", dlState: "VA" }],
    exercises: "4 inspections, no crash",
  },
  davidson: {
    firstName: "Joel",
    lastName: "Davidson",
    dob: "1963-07-21",
    licences: [{ dlNum: "TX3372976", dlState: "TX" }],
    exercises: "8 inspections — the heaviest record",
  },
  reid: {
    firstName: "Luis",
    lastName: "Reid",
    dob: "1974-08-06",
    licences: [{ dlNum: "VA129314", dlState: "VA" }],
    exercises: "crash and inspections",
  },
  knoll: {
    firstName: "Edward",
    lastName: "Knoll",
    dob: "1945-09-26",
    licences: [{ dlNum: "NT2812982", dlState: "NT" }],
    exercises: "Canadian territory (NT)",
  },
  marin: {
    firstName: "David",
    lastName: "Marin",
    dob: "1958-07-05",
    licences: [{ dlNum: "MN239648", dlState: "MN" }],
    exercises: "crash + inspection",
  },
  cross: {
    firstName: "Randhawa",
    lastName: "Cross",
    dob: "1974-06-24",
    licences: [{ dlNum: "ON246810", dlState: "ON" }],
    exercises: "Canadian province (ON)",
  },
  buck: {
    firstName: "Kelly",
    lastName: "Buck",
    dob: "1969-12-26",
    licences: [{ dlNum: "IL121416", dlState: "IL" }],
    exercises: "single crash",
  },
  mizer: {
    firstName: "Douglas",
    lastName: "Mizer",
    dob: "1960-10-06",
    licences: [{ dlNum: "IN182022", dlState: "IN" }],
    exercises: "crash outside the 5-year window",
  },
  barger: {
    firstName: "Gary",
    lastName: "Barger",
    dob: "1955-03-25",
    licences: [{ dlNum: "KY135245", dlState: "KY" }],
    exercises: "notPreventable crash (§10.5)",
  },
  litton: {
    firstName: "Burton",
    lastName: "Litton",
    dob: "1958-08-21",
    licences: [{ dlNum: "PA2336558", dlState: "PA" }],
    exercises: "4 crashes + 4 inspections, notPreventable",
  },
  hines: {
    firstName: "Conilio",
    lastName: "Hines",
    dob: "1962-12-06",
    licences: [{ dlNum: "GU352385", dlState: "GU" }],
    exercises: "US territory (Guam)",
  },
  carter: {
    firstName: "Franklin",
    lastName: "Carter",
    dob: "1934-03-14",
    licences: [{ dlNum: "VI2582166", dlState: "VI" }],
    exercises: "US territory (USVI)",
  },
  fisher: {
    firstName: "Richard",
    lastName: "Fisher",
    dob: "1973-09-07",
    licences: [{ dlNum: "OH88322", dlState: "OH" }],
    exercises: "crash + 3 inspections",
  },
};

const UAT_HOST = "https://rest-api.uat.psp.tylerapp.com";

function buildDraft(env: Env, key: string, stamp: string): PspRequestDraft {
  const d = ROSTER[key];
  if (!d) throw new Error(`Unknown driver "${key}"`);
  const identity = resolveCarrierIdentity({
    // The org row is deliberately NOT read: in UAT it is the wrong carrier, and this script has no
    // database connection to read it from either. `environment` makes that explicit rather than
    // incidental — see resolveCarrierIdentity's own comment.
    orgDotNumber: null,
    envDotNumber: env.PSP_DOT_NUMBER,
    envMotorCarrierId: env.PSP_MOTOR_CARRIER_ID,
    environment: "uat",
  });
  return {
    driverFirstName: d.firstName,
    driverLastName: d.lastName,
    driverDOB: d.dob,
    dotNumber: identity.dotNumber,
    motorCarrierId: identity.motorCarrierId,
    // Round-tripping this is PSP-PLAN's open question: driver resolution on the way back rests on it.
    internalRefId: `uat-${key}-${stamp}`,
    licenseQueries: d.licences.map((l) => ({
      ...l,
      dlFirstName: d.firstName,
      dlLastName: d.lastName,
    })),
    // Asserting the authorization exists. In production this is a fact about a signed record that
    // `checkPspGates` refuses without; here it is a property of the synthetic test account.
    driverConsent: true,
    monitor: false,
  };
}

/** Refuse to send unless all three agree this is UAT. Returns the reasons it would not. */
function productionGuards(env: Env): string[] {
  const stop: string[] = [];
  if (env.PSP_ENVIRONMENT !== "uat") stop.push(`PSP_ENVIRONMENT is "${env.PSP_ENVIRONMENT}", not "uat"`);
  if (env.PSP_PRODUCTION_ACKNOWLEDGED) stop.push("PSP_PRODUCTION_ACKNOWLEDGED is true");
  if (pspHost(env) !== UAT_HOST) stop.push(`resolved host is ${pspHost(env)}, not ${UAT_HOST}`);
  return stop;
}

function evidencePath(root: string, key: string, stamp: string, ext: string): string {
  const dir = path.join(root, "docs/psp-docs/uat-runs");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${key}-${stamp}.${ext}`);
}

async function main(argv: string[]): Promise<number> {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const has = (name: string): boolean => argv.includes(name);

  if (has("--verify-key")) {
    // The check a fingerprint cannot perform. A token is 32 hex characters either way; nothing in its
    // bytes says which account issued it, and comparing sha256 sums only ever proves two files
    // differ. `GET /DayMonitored45` asks the service, neither mints nor bills, and is therefore
    // allowed in BOTH environments — verifying the production key is when you most want it.
    const env = loadEnv();
    const variable = pspApiKeyVar(env);
    console.log(`environment       ${env.PSP_ENVIRONMENT}`);
    console.log(`reads             ${variable}`);
    console.log(`host              ${pspHost(env)}`);
    if (!pspApiKey(env)) {
      console.error(`\n${variable} is unset. Nothing to verify.`);
      return 1;
    }
    try {
      const report = await fetchMonitoringReport(env);
      console.log(`\nOK — ${variable} authenticates against the ${env.PSP_ENVIRONMENT} host.`);
      console.log(`45-day monitoring report: ${report.length} record(s).`);
      return 0;
    } catch (e) {
      const detail = e instanceof PspError ? e.detail : null;
      console.error(`\nFAILED — ${e instanceof Error ? e.message : String(e)}`);
      if (detail === 32) {
        console.error(
          `  Detail 32 here means this token is not the ${env.PSP_ENVIRONMENT} account's. A token for the\n`
          + `  other environment answers exactly this way — check that ${variable} holds the right one.`,
        );
      }
      return 1;
    }
  }

  if (has("--list") || argv.length === 0) {
    for (const [key, d] of Object.entries(ROSTER)) {
      const lic = d.licences.map((l) => `${l.dlNum} (${l.dlState})`).join(" + ");
      console.log(`${key.padEnd(9)} ${`${d.firstName} ${d.lastName}`.padEnd(18)} ${d.dob}  ${lic.padEnd(28)} ${d.exercises}`);
    }
    return 0;
  }

  const key = (arg("--driver") ?? "").toLowerCase();
  if (!ROSTER[key]) {
    console.error(`Unknown driver "${key}". Run with --list.`);
    return 1;
  }

  const env = loadEnv();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const draft = buildDraft(env, key, stamp);
  const issues = validatePspRequest(draft, new Date().toISOString().slice(0, 10));

  console.log(`host              ${pspHost(env)}`);
  console.log(`environment       ${env.PSP_ENVIRONMENT}`);
  console.log(`motorCarrierId    ${draft.motorCarrierId ?? "(none)"}`);
  console.log(`dotNumber         ${draft.dotNumber ?? "(unset — correct for UAT)"}`);
  console.log(`internalRefId     ${draft.internalRefId}`);
  console.log(`licences          ${draft.licenseQueries.map((q) => `${q.dlNum}/${q.dlState}`).join(", ")}`);
  console.log(`validation        ${issues.length === 0 ? "clean" : ""}`);
  for (const i of issues) console.log(`  ✗ ${i.field}: ${i.message} (prevents detail ${i.preventsDetail})`);
  if (issues.length > 0) {
    console.error("\nRefused before dispatch. A refusal here is free; the same refusal from PSP is not.");
    return 1;
  }

  if (!has("--order")) {
    console.log("\nDry run. Nothing was sent. Add --order to make the live request.");
    return 0;
  }

  const stop = productionGuards(env);
  if (stop.length > 0) {
    console.error(`\nREFUSING to send: ${stop.join("; ")}.`);
    return 1;
  }

  const root = path.resolve(import.meta.dirname, "../../../..");

  /**
   * Keep the body on EVERY outcome, not just the ones that parse.
   *
   * `requestRecord` throws a typed `PspError` on a validation refusal, and the raw body it read is
   * gone with it — which is exactly the body worth having when the refusal is one we do not
   * understand. Cloning here is the only place that can see it: the client owns the `fetch` call and
   * consumes the response itself.
   */
  let sent: unknown = null;
  const tee: typeof fetch = async (input, init) => {
    sent = init?.body ?? null;
    const res = await fetch(input, init);
    const copy = await res.clone().text();
    writeFileSync(evidencePath(root, key, stamp, "response.txt"), copy);
    return res;
  };

  console.log("\nPOST /Records — this is the call that bills. Not retried on failure.\n");
  try {
    const { report, raw } = await requestRecord(env, draft, { fetchImpl: tee });
    const file = evidencePath(root, key, stamp, "json");
    writeFileSync(file, JSON.stringify(raw, null, 2));
    console.log(`raw response      ${file}`);
    console.log(`outcome           ${report.outcome} (status ${report.status ?? "?"}, billed per §8.5)`);
    console.log(`authCode          ${report.authCode ? "returned" : "(none)"}`);
    console.log(`internalRefId     ${report.internalRefId ?? "(not echoed)"} ${report.internalRefId === draft.internalRefId ? "— round-tripped" : "— DOES NOT MATCH"}`);
    const asked = draft.licenseQueries.map((q) => `${q.dlNum}/${q.dlState}`);
    const got = `${report.driverLicenseNumber ?? "?"}/${report.driverLicenseState ?? "?"}`;
    console.log(`licence returned  ${got} ${asked.includes(got) ? "— one we asked for" : `— NOT ASKED FOR (asked ${asked.join(", ")})`}`);
    console.log(`inspections       ${report.inspections.length}`);
    console.log(`crashes           ${report.crashes.length}`);

    // Re-parsing the file we just wrote proves the evidence on disk is what the projection was built
    // from — the whole reason the raw body is kept.
    parsePspReport(Array.isArray(raw) ? raw[0] : raw);

    if (has("--pdf") && report.authCode) {
      // §7: the authCode dies at 120 hours, so the PDF is fetched in the same run or not at all.
      const pdf = await fetchRecordPdf(env, report.authCode, { fetchImpl: tee });
      const pdfFile = evidencePath(root, key, stamp, "pdf");
      writeFileSync(pdfFile, pdf);
      console.log(`pdf               ${pdfFile} (${pdf.length} bytes, %PDF verified)`);
    }
    return 0;
  } catch (e) {
    if (e instanceof PspError) {
      console.error(`\nPspError: ${e.message}`);
      console.error(`  request sent      ${typeof sent === "string" ? sent : "(none)"}`);
      console.error(`  raw response      ${evidencePath(root, key, stamp, "response.txt")}`);
      console.error(`  detail ${e.detail ?? "-"}  http ${e.httpStatus ?? "-"}  charged ${e.charged === null ? "UNKNOWN" : e.charged}`);
      if (e.charged === null) console.error("  Charged is unknown — settle this by hand before re-running.");
      return 1;
    }
    throw e;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

export { ROSTER, buildDraft, productionGuards };
