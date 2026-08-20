import "dotenv/config";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DISCLOSURES, SCREENING_PREREQUISITES, liveAuthorization } from "@fuelguard/shared";
import { loadEnv, type Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { ROSTER } from "./pspUatProbe.js";

/**
 * Seed the QA org with drivers a PSP order can actually be placed against, through the app.
 *
 * `psp:uat` stops at the vendor edge and proves the request, the parser and the round-trip. What it
 * cannot exercise is the half the operator sees: the four gates, the step-up, the confirmation
 * screen, the ledger row, and the PDF landing in `documents` with a `qualification_records` row
 * citing it. That needs a real driver and real authorizations, and this puts them there.
 *
 * ── WHY THIS IS PINNED TO ONE ORG, AND REFUSES EVERY OTHER ─────────────────────────────────────
 * The only Supabase this repo is configured against is PRODUCTION. `FuelGuard EFS QA` is a separate
 * org created for the EFS work, holds no real drivers, and has a null `dot_number` — so tenant
 * isolation keeps everything here out of Silvicom Inc's real DQ evidence, and even a mistaken
 * production run could not silently borrow their USDOT number. Seeding anywhere else would put
 * fabricated consent into a real carrier's file, and `documents` and `qualification_records` are
 * append-only: there is no undo. The org id is a literal below and nothing can override it.
 *
 * ── THE SIGNATURES ARE FABRICATED, AND THEY SAY SO ─────────────────────────────────────────────
 * A `driver_authorizations` row is the record of a person consenting to a background check. These
 * rows record nobody: they are seeded for synthetic FMCSA test drivers who do not exist. The
 * instrument itself is composed from `DISCLOSURES`, exactly as `routes/recruitment/authorizations.ts`
 * composes it — a seed that hand-wrote the disclosure text would drift from the real one and prove
 * nothing about the real path. But `signed_name` carries a `(QA SEED)` marker so no row here can
 * ever be read as a real signature, in the UI or in an export.
 *
 * It also refuses to run unless `PSP_ENVIRONMENT=uat`. Fabricated consent has no business existing
 * in an environment pointed at the account that bills and pulls real people's records.
 *
 *   pnpm --filter @fuelguard/api seed:psp-qa              # report only, writes nothing
 *   pnpm --filter @fuelguard/api seed:psp-qa --apply      # create the drivers and authorizations
 *   pnpm --filter @fuelguard/api seed:psp-qa --drivers litton,davidson --apply
 */

/** `FuelGuard EFS QA`. A literal, because the whole safety argument rests on it being this org. */
const QA_ORG_ID = "07fe4058-cc72-4a69-b3e9-29b4cf1c6a44";
const QA_ORG_NAME = "FuelGuard EFS QA";

/** Rich enough to exercise the screens: crashes, a long inspection list, and a short one. */
const DEFAULT_DRIVERS = ["litton", "davidson", "davis"];

const SEED_MARKER = "(QA SEED)";

interface SeedResult {
  driver: string;
  driverId: string | null;
  action: "created" | "updated" | "unchanged";
  authorizations: string[];
}

function refusals(env: Env, orgId: string): string[] {
  const stop: string[] = [];
  if (orgId !== QA_ORG_ID) stop.push(`org ${orgId} is not ${QA_ORG_NAME}`);
  if (env.PSP_ENVIRONMENT !== "uat") {
    stop.push(`PSP_ENVIRONMENT is "${env.PSP_ENVIRONMENT}" — fabricated consent may only exist in uat`);
  }
  return stop;
}

/** Confirm the org id really is the QA org before writing a row to it. Names can be edited; ids cannot. */
async function assertQaOrg(admin: SupabaseClient): Promise<string> {
  const { data, error } = await admin
    .from("organizations")
    .select("id, name, dot_number")
    .eq("id", QA_ORG_ID)
    .maybeSingle();
  if (error || !data) throw new Error(`Could not read org ${QA_ORG_ID}: ${error?.message ?? "not found"}`);
  if (data.name !== QA_ORG_NAME) {
    throw new Error(`Org ${QA_ORG_ID} is named "${data.name}", not "${QA_ORG_NAME}". Refusing.`);
  }
  // A DOT number here would reach `resolveCarrierIdentity` in production mode. It is null today and
  // this is the check that notices if that ever stops being true.
  if (data.dot_number) {
    throw new Error(`${QA_ORG_NAME} has acquired dot_number ${data.dot_number}. Refusing to seed.`);
  }
  return data.name as string;
}

async function upsertDriver(
  admin: SupabaseClient,
  key: string,
  apply: boolean,
): Promise<{ id: string | null; action: SeedResult["action"] }> {
  const d = ROSTER[key];
  if (!d) throw new Error(`Unknown driver "${key}" — see psp:uat --list`);
  // The dashboard path builds ONE licence from `cdl_number`/`cdl_state`, so a two-licence driver is
  // seeded with their first. Gary Thomas's second licence has no product path at all today.
  const licence = d.licences[0]!;
  const fields = {
    full_name: `${d.firstName} ${d.lastName}`,
    first_name: d.firstName,
    last_name: d.lastName,
    date_of_birth: d.dob,
    cdl_number: licence.dlNum,
    cdl_state: licence.dlState,
    status: "active",
    identity_source: "manual",
  };

  const { data: existing } = await admin
    .from("drivers")
    .select("id, date_of_birth, cdl_number, cdl_state")
    .eq("org_id", QA_ORG_ID)
    .eq("cdl_number", licence.dlNum)
    .maybeSingle();

  if (existing) {
    const same = existing.date_of_birth === d.dob && existing.cdl_state === licence.dlState;
    if (same) return { id: existing.id as string, action: "unchanged" };
    if (!apply) return { id: existing.id as string, action: "updated" };
    // An UPDATE, never `.upsert()` with a partial payload: Postgres checks NOT NULL before conflict
    // arbitration, so a partial upsert on a table with required columns fails on the insert path.
    const { error } = await admin.from("drivers").update(fields).eq("id", existing.id).eq("org_id", QA_ORG_ID);
    if (error) throw new Error(`Updating ${key}: ${error.message}`);
    return { id: existing.id as string, action: "updated" };
  }

  if (!apply) return { id: null, action: "created" };
  const { data, error } = await admin
    .from("drivers")
    .insert({ org_id: QA_ORG_ID, ...fields })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Creating ${key}: ${error?.message ?? "no row"}`);
  return { id: data.id as string, action: "created" };
}

/**
 * Record the authorizations a PSP order requires, and only the ones that are missing.
 *
 * `SCREENING_PREREQUISITES.psp_record` is the source of which — `psp` AND `fcra_disclosure` — so this
 * cannot drift from what `checkPspGates` demands. Liveness is a fold over the rows (revocation is a
 * later row, never a mutation), so an existing live grant is left exactly as it is: appending a
 * second one would be recording a signature nobody gave twice.
 */
async function ensureAuthorizations(
  admin: SupabaseClient,
  driverId: string,
  signedName: string,
  apply: boolean,
): Promise<string[]> {
  const { data: rows } = await admin
    .from("driver_authorizations")
    .select("id, purpose, accepted_at, revokes")
    .eq("org_id", QA_ORG_ID)
    .eq("driver_id", driverId);

  const held = (rows ?? []) as { id: string; purpose: string; accepted_at: string; revokes: string | null }[];
  const needed = SCREENING_PREREQUISITES.psp_record ?? [];
  const missing = needed.filter((p) => liveAuthorization(held, p) === null);
  if (!apply || missing.length === 0) return missing;

  for (const purpose of missing) {
    const doc = DISCLOSURES[purpose];
    const { error } = await admin.from("driver_authorizations").insert({
      org_id: QA_ORG_ID,
      driver_id: driverId,
      purpose,
      // Composed here exactly as routes/recruitment/authorizations.ts composes it. Never hand-written.
      disclosure_version: doc.version,
      disclosure_text: doc.body,
      intent_statement: doc.intent,
      method: "esign",
      signed_name: `${signedName} ${SEED_MARKER}`,
      esign_consent_at: new Date().toISOString(),
      // No `recorded_by`: no person recorded this, and naming one would be the same lie as the
      // signature. No `accepted_ip` / `accepted_user_agent` either — there was no browser.
      recorded_by: null,
    });
    if (error) throw new Error(`Recording ${purpose} for ${driverId}: ${error.message}`);
  }
  return missing;
}

async function main(argv: string[]): Promise<number> {
  const apply = argv.includes("--apply");
  const flag = argv.indexOf("--drivers");
  const keys = flag === -1 ? DEFAULT_DRIVERS : (argv[flag + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const env = loadEnv();
  const stop = refusals(env, QA_ORG_ID);
  if (stop.length > 0) {
    console.error(`REFUSING: ${stop.join("; ")}.`);
    return 1;
  }

  const admin = getSupabaseAdmin(env);
  const orgName = await assertQaOrg(admin);
  console.log(`org               ${orgName} (${QA_ORG_ID})`);
  console.log(`environment       ${env.PSP_ENVIRONMENT}`);
  console.log(`mode              ${apply ? "APPLY — writing" : "dry run — writing nothing"}\n`);

  const results: SeedResult[] = [];
  for (const key of keys) {
    const { id, action } = await upsertDriver(admin, key, apply);
    const d = ROSTER[key]!;
    const authorizations = id
      ? await ensureAuthorizations(admin, id, `${d.firstName} ${d.lastName}`, apply)
      : [...(SCREENING_PREREQUISITES.psp_record ?? [])];
    results.push({ driver: key, driverId: id, action, authorizations });
  }

  for (const r of results) {
    const d = ROSTER[r.driver]!;
    const auth = r.authorizations.length === 0 ? "already held" : `${apply ? "recorded" : "would record"} ${r.authorizations.join(" + ")}`;
    console.log(`${r.driver.padEnd(9)} ${r.action.padEnd(9)} ${(r.driverId ?? "(new)").padEnd(38)} ${auth}`);
    console.log(`${"".padEnd(9)} ${d.licences[0]!.dlNum}/${d.licences[0]!.dlState}  dob ${d.dob}  — ${d.exercises}`);
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to write.");
    return 0;
  }
  console.log("\nSeeded. Order from the driver's screening panel; the step-up is a real password prompt.");
  return 0;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    },
  );
}

export { QA_ORG_ID, refusals, SEED_MARKER };
