import type { SupabaseClient } from "@supabase/supabase-js";
import type { TmsDriverInput, TmsVehicleInput, TmsTrailerInput } from "@silvicom/shared";
import { deriveFullName } from "@silvicom/shared";
import { driverPatch, vehiclePatch, trailerPatch } from "./rosterFields.js";
import { recordSyncedCredentials } from "../evidence/index.js";
import {
  makeDriverMatcher,
  makeAssetMatcher,
  vehicleUnitKey,
  trailerUnitMatchKey,
  type Candidate,
  type MatchOutcome,
} from "./rosterMatch.js";

/**
 * TMS roster ingest (MCLEOD-ROSTER-SYNC-PLAN M3/M4).
 *
 * Two modes, and the caller picks:
 *   **link**     — write the external link and NOTHING else. Establishes which Silvicom 360 row is which
 *                  McLeod record and reports everything it could not place. (M3)
 *   **identity** — additionally refresh the fields McLeod owns on rows it has CLAIMED. (M4)
 *
 * Creation and deactivation are still absent: an unmatched McLeod record is reported, never inserted
 * (M5), and no row is ever retired here (M6, which carries the retention rules and the
 * mass-deactivation guard).
 *
 * ── WHO OWNS A ROW ──────────────────────────────────────────────────────────────────────────────
 * Identity is written only where `identity_source` is 'samsara' or 'mcleod', and taking over flips it
 * to 'mcleod'. The two exclusions are the interesting part:
 *
 *   'manual' — the office typed it. This is the existing escape hatch, unchanged: editing an identity
 *              field claims a row to 'manual' via `resolveDriverUpdate`, after which no sync touches
 *              it. DQ1 exists because the Samsara sync once reverted hand-corrected names silently.
 *
 *   'efs'    — a fuel-card name auto-provisioned so a fill always had somebody to point at (0204).
 *              These carry no licence, so they can only ever be reached by the NAME fallback — which
 *              is exactly the irreversible-merge case that belongs in a review queue, not in a sync.
 *              Measured 2026-08-24: of 163 matches, 162 were by licence and 1 by name, and ALL 163
 *              landed on 'samsara' rows — not one EFS stub was touched. The exclusion therefore costs
 *              nothing today and stops the structural risk from ever arriving.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE (CODEBASE-IMPACT-ANALYSIS §5):
 *   **the sync writes a fixed allowlist of columns, never a row.**
 * Twelve services write to these three tables and several own columns that are LEARNED rather than
 * recorded — tank capacity and sensor reliability from fill history, trailer pairing from telemetry,
 * the whole idle envelope. McLeod has a static spec field for some of them and it is worse than what
 * the product computes. `LINK_COLUMNS` below is the entire write surface, and it is deliberately
 * expressed as data so that a column added to `drivers` in six months is safe by default.
 *
 * The API reads with the service role, which bypasses RLS, so every query here org-filters itself.
 */

export type RosterMode = "report" | "link" | "identity" | "create";

/**
 * Does this mode touch the database at all?
 *
 * `report` exists because the first time this pipeline meets real data, that data is **the carrier's
 * production fleet**. There is no second Silvicom 360 org to rehearse against — the only other one holds
 * seven drivers and no vehicles — so "run it and see" means running it on 264 drivers, 195 vehicles
 * and 211 trailers that people are using today.
 *
 * Report mode answers "what WOULD this do" with the same matcher, the same precedence and the same
 * ambiguity rules as the real thing, and writes nothing at all. It is how §7's match report
 * (162 / 175 / 201, computed by hand before any code existed) gets reproduced BY THE PIPELINE, which
 * is what M3's Done-when actually asks for and what no run has ever demonstrated.
 */
const WRITES: Record<RosterMode, boolean> = { report: false, link: true, identity: true, create: true };

/** Identity is written only by the two modes that own it; `report` and `link` never touch a field. */
const writesIdentity = (mode: RosterMode): boolean => mode === "identity" || mode === "create";

export interface RosterIngestResult {
  received: number;
  /** Rows whose link we wrote this run. Named `upserted` because the on-prem agent's batch reporter
   *  reads that field for every ingest endpoint; `linked` is the same number under a truer name. */
  upserted: number;
  linked: number;
  /** Already carried the right link — the steady state once the roster has settled. */
  alreadyLinked: number;
  /** External ids we could not place. The whole point of the milestone: these are the report. */
  unmatched: string[];
  /** A match key held by two or more Silvicom 360 rows. Never guessed at (see rosterMatch). */
  ambiguous: string[];
  /** McLeod drivers whose licence matches a row the RECRUITING pipeline owns (`status='applicant'`).
   *  Held out of the match pool on purpose and surfaced for a human — see rosterMatch. */
  applicants: string[];
  /** identity mode: rows whose fields were refreshed from McLeod. */
  updated: number;
  /** identity mode: matched rows left alone because the office or the EFS path owns them. */
  skippedOwned: number;
  /** create mode: rows inserted for McLeod records that matched nothing. */
  created: number;
  /** create mode: unit numbers of NEW vehicles that still need a tank capacity before they can drive
   *  fuel detection — the same signal `samsaraVehicleSync` reports, for the same reason. */
  needsCompletion: string[];
  /** drivers: certification rows filed into the evidence record this run (R1, Q2 option (a)).
   *  Expected to be large on the first sweep and near ZERO afterwards — `recordSyncedCredentials`
   *  writes only on change, so a number that stays high sweep after sweep is the bug, not the
   *  feature: it means something is making these rows look different every time. */
  credentialsFiled: number;
  /** `externalId:kind` for credentials that could not be filed. Counted, never thrown — one bad
   *  credential must not strand the rest of the roster mid-sweep. */
  credentialFailures: string[];
}

const empty = (): RosterIngestResult => ({
  received: 0,
  upserted: 0,
  linked: 0,
  alreadyLinked: 0,
  unmatched: [],
  ambiguous: [],
  applicants: [],
  updated: 0,
  skippedOwned: 0,
  created: 0,
  needsCompletion: [],
  credentialsFiled: 0,
  credentialFailures: [],
});

/** Provenances whose identity McLeod may claim. See the header for why the other two are excluded. */
const CLAIMABLE = new Set(["samsara", "mcleod"]);

/** The link half of the write surface, per entity. */
const LINK_COLUMNS = {
  drivers: { link: "mcleod_driver_id", company: "mcleod_company_id" },
  vehicles: { link: "mcleod_tractor_id", company: "mcleod_company_id" },
  trailers: { link: "mcleod_trailer_id", company: "mcleod_company_id" },
} as const;

type Entity = keyof typeof LINK_COLUMNS;

async function loadCandidates(
  admin: SupabaseClient,
  orgId: string,
  entity: Entity,
): Promise<Candidate[]> {
  const link = LINK_COLUMNS[entity].link;
  const cols =
    entity === "drivers"
      ? `id, status, identity_source, cdl_number, full_name, ${link}`
      : `id, status, identity_source, dot_annual_inspection_source, vin, unit_number, ${link}`;
  // Archived rows are excluded for drivers: 0235 made archiving the retirement act, and an archived
  // driver is not a candidate for a live employment record.
  let q = admin.from(entity).select(cols).eq("org_id", orgId);
  if (entity === "drivers") q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    status: (r.status as string | null) ?? null,
    identity_source: (r.identity_source as string | null) ?? null,
    link: (r[link] as string | null) ?? null,
    cdl_number: (r.cdl_number as string | null) ?? null,
    full_name: (r.full_name as string | null) ?? null,
    vin: (r.vin as string | null) ?? null,
    unit_number: (r.unit_number as string | null) ?? null,
    inspection_source: (r.dot_annual_inspection_source as string | null) ?? null,
  }));
}

/** Provenance by row id, so the ownership rule can be applied without a second read. */
function provenanceLookup(candidates: Candidate[]): (id: string) => string | null {
  const m = new Map(candidates.map((c) => [c.id, c.identity_source]));
  return (id) => m.get(id) ?? null;
}

/**
 * Which rows hold a certified inspection's claim on their expiry date (0286).
 *
 * Read from the SAME candidate rows as provenance, for the same reason: the ownership rules run per
 * outcome and a second query per row would be a query per vehicle.
 */
/** A driver has no annual-inspection expiry, so the rule cannot apply to one. */
const NEVER_INSPECTION_OWNED = (): boolean => false;

function inspectionOwnedLookup(candidates: Candidate[]): (id: string) => boolean {
  const owned = new Set(candidates.filter((c) => c.inspection_source === "inspection").map((c) => c.id));
  return (id) => owned.has(id);
}

/** Apply one match outcome. The ONLY write this module performs. */
async function applyOutcome(
  admin: SupabaseClient,
  orgId: string,
  entity: Entity,
  externalId: string,
  companyId: string | null | undefined,
  outcome: MatchOutcome,
  out: RosterIngestResult,
  patch: Record<string, unknown> | null,
  candidateSource: (id: string) => string | null,
  inspectionOwned: (id: string) => boolean,
  insert: Record<string, unknown> | null,
  write: boolean,
): Promise<string | null> {
  const { link, company } = LINK_COLUMNS[entity];
  switch (outcome.kind) {
    case "linked":
    case "matched": {
      const already = outcome.kind === "linked";
      if (already) out.alreadyLinked++;

      // A row the office or the EFS path owns is counted and left exactly as it is — no link refresh,
      // no field write. Reported so the operator can see the sync is deliberately standing off.
      if (patch && !CLAIMABLE.has(candidateSource(outcome.id) ?? "")) {
        out.skippedOwned++;
        return null;
      }

      // Report mode stops here: it has decided what it would do and counts it, and that is the whole
      // deliverable. Everything above this line — the match, the ownership check, the ambiguity
      // refusal — has already run, so the numbers are the ones a real sweep would produce.
      if (!write) {
        if (!already) {
          out.linked++;
          out.upserted++;
        }
        if (patch) out.updated++;
        return null;
      }

      const body: Record<string, unknown> = already ? {} : { [link]: externalId, [company]: companyId ?? null };
      if (patch) {
        Object.assign(body, patch);
        /**
         * ── THE ONE FIELD A CERTIFIED INSPECTION OWNS (0286) ────────────────────────────────────
         * McLeod carries its own `inspection_date` and `rosterFields` derives an expiry from it, so
         * without this the sweep would overwrite a date a §396.17 report put there.
         *
         * It used to be prevented by the report setting `identity_source = 'manual'`, which the
         * ownership check above answers by skipping the ENTIRE patch — so one inspection also cost
         * that row its VIN, plate, make, model, year and registration. Measured 2026-09-01: the
         * first identity sweep filled 200 trailer VINs and reported `office-owned=1`, the single
         * trailer with a certified inspection, which ended the sweep still carrying `vin = null`.
         *
         * Now only the date stands off. Everything else about the row is still McLeod's to maintain.
         */
        if (inspectionOwned(outcome.id)) delete body.dot_annual_inspection_expires_at;
        // Taking over identity IS the ownership transfer, so it is recorded on the row. Nothing else
        // in the product infers provenance from the presence of a link.
        body.identity_source = "mcleod";
      }
      if (Object.keys(body).length === 0) return null;

      const { error } = await admin
        .from(entity)
        .update(body)
        .eq("id", outcome.id)
        .eq("org_id", orgId);
      // A 23505 means another row in this org already claims this external id — the partial unique
      // index from 0239 doing its job. Report it rather than failing the batch: the operator needs to
      // see WHICH record is double-claimed, and one bad row must not strand the other 163.
      if (error) {
        out.ambiguous.push(externalId);
        return null;
      }
      if (!already) {
        out.linked++;
        out.upserted++;
      }
      if (patch) out.updated++;
      // The id is returned ONLY when a patch was actually applied. A row we stood off from, or a
      // report-mode pass, must not have credentials filed against it — the sweep's own ownership
      // rules decide whether McLeod is speaking for this driver, and the evidence write inherits
      // that decision rather than re-deciding it.
      return patch ? outcome.id : null;
    }
    case "ambiguous":
      out.ambiguous.push(externalId);
      return null;
    case "applicant":
      out.applicants.push(externalId);
      return null;
    case "unmatched":
      // Creation is the caller's decision, not this function's: in link and identity mode an unmatched
      // record is a REPORT, and only in create mode is it a row.
      if (insert) {
        // `select("id").single()` so a newly created driver can have their credentials filed in the
        // same pass — without it the first sweep would create the row and leave its CDL and medical
        // card out of the evidence record until something changed, which for a new hire is never.
        const { data: created, error } = await admin.from(entity).insert({
          org_id: orgId,
          [link]: externalId,
          [company]: companyId ?? null,
          identity_source: "mcleod",
          ...insert,
        }).select("id").single<{ id: string }>();
        // 23505 means a row already claims this identity — the 0123/0239 unique indexes doing their
        // job against a re-run or a racing sweep. Report rather than fail the batch: one bad row must
        // not strand the other 163, and the operator needs to see WHICH record collided.
        if (error) {
          out.ambiguous.push(externalId);
          return null;
        }
        out.created++;
        return created?.id ?? null;
      }
      out.unmatched.push(externalId);
      return null;
  }
}

export async function ingestDrivers(
  admin: SupabaseClient,
  orgId: string,
  rows: TmsDriverInput[],
  mode: RosterMode = "link",
): Promise<RosterIngestResult> {
  const out = empty();
  out.received = rows.length;
  const candidates = await loadCandidates(admin, orgId, "drivers");
  const sourceOf = provenanceLookup(candidates);
  const matcher = makeDriverMatcher(candidates);
  for (const r of rows) {
    // Compose here rather than trusting a display name: McLeod's `name` is the SURNAME alone, so the
    // agent sends parts and this is the one place they become a comparable name.
    const name = deriveFullName({
      first_name: r.first_name ?? null,
      middle_name: r.middle_name ?? null,
      last_name: r.last_name ?? null,
    });
    const outcome = matcher.match({ external_id: r.external_id, cdl_number: r.cdl_number, name });
    const patch = writesIdentity(mode) ? driverPatch(r) : null;
    // A driver arrives ACTIVE: the agent's query selects only `is_active = 'Y'` rows, so a record
    // reaching this point is somebody the carrier currently employs.
    //
    // The only bar to creation is having SOME name, because `full_name` is NOT NULL. Deliberately not
    // "must have a surname": a refused record is INVISIBLE — it leaves the roster silently and nobody
    // reviews a driver who was never created — whereas a partially-named one appears, carries its
    // licence for matching, and can be finished by an admin. Visible and imperfect beats absent and
    // tidy. (Theoretical against this carrier: all 164 active drivers have a surname.)
    const insert =
      mode === "create" && name ? { ...patch, full_name: name, status: "active" } : null;
    const driverId = await applyOutcome(admin, orgId, "drivers", r.external_id, r.company_id, outcome, out, patch, sourceOf, NEVER_INSPECTION_OWNED, insert, WRITES[mode]);

    /**
     * The licence and the medical card also become EVIDENCE, not just columns (D-ARC3; Q2 answered
     * option (a) on 2026-08-30). Writing them to `drivers.*` alone was the dual-source defect
     * ARCHITECTURE.md §3 calls the audit's sharpest finding: `certifications` is the only table the
     * qualification gate and `buildDqFile` read, so a roster showing a current medical card while the
     * DQ file said `missing` was the guaranteed outcome of turning this sync on.
     *
     * Through `evidence`'s interface, never `.from("certifications")` here — the owner holds the
     * write-only-on-change invariant, because `insert_certification` supersedes unconditionally and
     * this loop runs nightly against an append-only table nothing may prune.
     *
     * `driverId` is null whenever the sweep did not actually speak for this row: report mode, a row
     * the office owns, an ambiguous match. Filing is inherited from that decision, never re-made.
     */
    if (driverId) {
      const filed = await recordSyncedCredentials(admin, orgId, driverId, {
        cdlNumber: r.cdl_number,
        cdlState: r.cdl_state,
        cdlExpiresAt: r.cdl_expires_at,
        medicalExpiresAt: r.medical_card_expires_at,
      });
      out.credentialsFiled += filed.written.length;
      // Counted, not thrown. A credential that could not be filed must not strand the other 163
      // drivers mid-sweep — the same rule the 23505 branches above follow, for the same reason.
      for (const f of filed.failed) out.credentialFailures.push(`${r.external_id}:${f.kind}`);
    }
  }
  return out;
}

export async function ingestVehicles(
  admin: SupabaseClient,
  orgId: string,
  rows: TmsVehicleInput[],
  mode: RosterMode = "link",
): Promise<RosterIngestResult> {
  const out = empty();
  out.received = rows.length;
  const candidates = await loadCandidates(admin, orgId, "vehicles");
  const sourceOf = provenanceLookup(candidates);
  const inspectionOwned = inspectionOwnedLookup(candidates);
  const matcher = makeAssetMatcher(candidates, vehicleUnitKey);
  for (const r of rows) {
    const outcome = matcher.match({ external_id: r.external_id, vin: r.vin, unit_number: r.unit_number });
    const patch = writesIdentity(mode) ? vehiclePatch(r) : null;
    // `tank_capacity_gal` is NOT NULL and is LEARNED from observed fills, so a new truck is created
    // with zero and reported in `needsCompletion` — exactly what `samsaraVehicleSync` does, and for
    // exactly the same reason: a guessed capacity silently degrades every fuel anomaly on that truck.
    const unit = r.unit_number ?? r.external_id;
    const insert =
      mode === "create" ? { ...patch, unit_number: unit, tank_capacity_gal: 0, status: "active" } : null;
    const before = out.created;
    await applyOutcome(admin, orgId, "vehicles", r.external_id, r.company_id, outcome, out, patch, sourceOf, inspectionOwned, insert, WRITES[mode]);
    // Only a truck that was actually inserted needs finishing — a matched one already has its capacity.
    if (out.created > before) out.needsCompletion.push(unit);
  }
  return out;
}

export async function ingestTrailers(
  admin: SupabaseClient,
  orgId: string,
  rows: TmsTrailerInput[],
  mode: RosterMode = "link",
): Promise<RosterIngestResult> {
  const out = empty();
  out.received = rows.length;
  const candidates = await loadCandidates(admin, orgId, "trailers");
  const sourceOf = provenanceLookup(candidates);
  const inspectionOwned = inspectionOwnedLookup(candidates);
  // Unit first for trailers, VIN second: Silvicom 360 holds no trailer VINs at all today, so VIN can only
  // ever be a tiebreak until McLeod has populated them.
  const matcher = makeAssetMatcher(candidates, trailerUnitMatchKey, ["unit", "vin"]);
  for (const r of rows) {
    const outcome = matcher.match({ external_id: r.external_id, vin: r.vin, unit_number: r.unit_number });
    const patch = writesIdentity(mode) ? trailerPatch(r) : null;
    // New trailers take McLeod's bare unit number. Silvicom 360's `R` prefix is a convention applied to
    // rows that already exist; inventing it for a new one would be this sync deciding a naming policy.
    const insert =
      mode === "create" ? { ...patch, unit_number: r.unit_number ?? r.external_id, status: "active" } : null;
    await applyOutcome(admin, orgId, "trailers", r.external_id, r.company_id, outcome, out, patch, sourceOf, inspectionOwned, insert, WRITES[mode]);
  }
  return out;
}
