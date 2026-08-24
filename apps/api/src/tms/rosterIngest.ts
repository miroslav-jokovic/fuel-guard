import type { SupabaseClient } from "@supabase/supabase-js";
import type { TmsDriverInput, TmsVehicleInput, TmsTrailerInput } from "@fuelguard/shared";
import { deriveFullName } from "@fuelguard/shared";
import {
  makeDriverMatcher,
  makeAssetMatcher,
  vehicleUnitKey,
  trailerUnitMatchKey,
  type Candidate,
  type MatchOutcome,
} from "./rosterMatch.js";

/**
 * TMS roster ingest — LINK ONLY (MCLEOD-ROSTER-SYNC-PLAN M3).
 *
 * This writes the external link and NOTHING else. Not a name, not a licence, not a status. M4 turns on
 * identity writes and M5 turns on creation; until then the sync's whole job is to establish which
 * FuelGuard row corresponds to which McLeod record, and to report everything it could not place.
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
  /** A match key held by two or more FuelGuard rows. Never guessed at (see rosterMatch). */
  ambiguous: string[];
  /** McLeod drivers whose licence matches a row the RECRUITING pipeline owns (`status='applicant'`).
   *  Held out of the match pool on purpose and surfaced for a human — see rosterMatch. */
  applicants: string[];
}

const empty = (): RosterIngestResult => ({
  received: 0,
  upserted: 0,
  linked: 0,
  alreadyLinked: 0,
  unmatched: [],
  ambiguous: [],
  applicants: [],
});

/** The complete write surface of this module, per entity. Nothing else is ever set. */
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
      : `id, status, identity_source, vin, unit_number, ${link}`;
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
  }));
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
): Promise<void> {
  const { link, company } = LINK_COLUMNS[entity];
  switch (outcome.kind) {
    case "linked":
      out.alreadyLinked++;
      return;
    case "matched": {
      const { error } = await admin
        .from(entity)
        .update({ [link]: externalId, [company]: companyId ?? null })
        .eq("id", outcome.id)
        .eq("org_id", orgId);
      // A 23505 means another row in this org already claims this external id — the partial unique
      // index from 0239 doing its job. Report it rather than failing the batch: the operator needs to
      // see WHICH record is double-claimed, and one bad row must not strand the other 163.
      if (error) {
        out.ambiguous.push(externalId);
        return;
      }
      out.linked++;
      out.upserted++;
      return;
    }
    case "ambiguous":
      out.ambiguous.push(externalId);
      return;
    case "applicant":
      out.applicants.push(externalId);
      return;
    case "unmatched":
      out.unmatched.push(externalId);
      return;
  }
}

export async function ingestDrivers(
  admin: SupabaseClient,
  orgId: string,
  rows: TmsDriverInput[],
): Promise<RosterIngestResult> {
  const out = empty();
  out.received = rows.length;
  const matcher = makeDriverMatcher(await loadCandidates(admin, orgId, "drivers"));
  for (const r of rows) {
    // Compose here rather than trusting a display name: McLeod's `name` is the SURNAME alone, so the
    // agent sends parts and this is the one place they become a comparable name.
    const name = deriveFullName({
      first_name: r.first_name ?? null,
      middle_name: r.middle_name ?? null,
      last_name: r.last_name ?? null,
    });
    const outcome = matcher.match({ external_id: r.external_id, cdl_number: r.cdl_number, name });
    await applyOutcome(admin, orgId, "drivers", r.external_id, r.company_id, outcome, out);
  }
  return out;
}

export async function ingestVehicles(
  admin: SupabaseClient,
  orgId: string,
  rows: TmsVehicleInput[],
): Promise<RosterIngestResult> {
  const out = empty();
  out.received = rows.length;
  const matcher = makeAssetMatcher(await loadCandidates(admin, orgId, "vehicles"), vehicleUnitKey);
  for (const r of rows) {
    const outcome = matcher.match({ external_id: r.external_id, vin: r.vin, unit_number: r.unit_number });
    await applyOutcome(admin, orgId, "vehicles", r.external_id, r.company_id, outcome, out);
  }
  return out;
}

export async function ingestTrailers(
  admin: SupabaseClient,
  orgId: string,
  rows: TmsTrailerInput[],
): Promise<RosterIngestResult> {
  const out = empty();
  out.received = rows.length;
  // Unit first for trailers, VIN second: FuelGuard holds no trailer VINs at all today, so VIN can only
  // ever be a tiebreak until McLeod has populated them.
  const matcher = makeAssetMatcher(
    await loadCandidates(admin, orgId, "trailers"),
    trailerUnitMatchKey,
    ["unit", "vin"],
  );
  for (const r of rows) {
    const outcome = matcher.match({ external_id: r.external_id, vin: r.vin, unit_number: r.unit_number });
    await applyOutcome(admin, orgId, "trailers", r.external_id, r.company_id, outcome, out);
  }
  return out;
}
