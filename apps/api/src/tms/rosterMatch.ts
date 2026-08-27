import { driverMatchKey, trailerUnitMatchKey } from "@fuelguard/shared";

/**
 * Matching a TMS roster row to an existing Silvicom 360 record — pure, so the precedence can be tested
 * without a database and without SQL Server.
 *
 * The precedences below are not guesses; each was measured against the carrier's data on 2026-08-24
 * (MCLEOD-ROSTER-SYNC-PLAN §7):
 *
 *   drivers  link → CDL → name.  The licence carries it: 162 of McLeod's 164 active drivers match a
 *            Silvicom 360 active driver on licence alone, and both sides hold a distinct one for every
 *            active driver. Phone — the key the Samsara sync leans on — is not available at all;
 *            McLeod has no phone number for any of its 1,463 driver rows.
 *   vehicles link → VIN → unit.  Both keys select the same 175 of 190, so they corroborate rather
 *            than complement, and either alone would do. VIN is preferred because a unit number can
 *            be reassigned to a different truck and a VIN cannot.
 *   trailers link → normalised unit → VIN.  VIN is last because Silvicom 360 holds none today.
 *
 * AMBIGUITY IS NEVER RESOLVED BY GUESSING. A key held by two or more existing rows matches nothing —
 * the same rule `samsaraDriverSync` applies to names, for the same reason: merging two different
 * people is unrecoverable, and leaving one unmatched costs a line in a report.
 */

export interface Candidate {
  id: string;
  status: string | null;
  /** The provenance already on the row. Only 'manual' changes behaviour (it is office-owned). */
  identity_source: string | null;
  link: string | null;
  cdl_number?: string | null;
  full_name?: string | null;
  vin?: string | null;
  unit_number?: string | null;
}

export type MatchOutcome =
  | { kind: "linked"; id: string; by: "link" }
  | { kind: "matched"; id: string; by: "cdl" | "name" | "vin" | "unit" }
  | { kind: "ambiguous"; by: string }
  | { kind: "applicant"; id: string }
  | { kind: "unmatched" };

/** Licence numbers are compared case- and punctuation-insensitively; McLeod's are bare alphanumerics
 *  (8–13 chars, verified) but Silvicom 360's may have been typed with spaces or hyphens. */
export const cdlKey = (v: string | null | undefined): string =>
  (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export const vinKey = (v: string | null | undefined): string => (v ?? "").trim().toUpperCase();

/** Build a lookup where any key claimed by 2+ rows maps to null — i.e. "known to be ambiguous". */
function index<T>(rows: T[], key: (r: T) => string): Map<string, T | null> {
  const m = new Map<string, T | null>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    m.set(k, m.has(k) ? null : r);
  }
  return m;
}

export interface DriverMatcher {
  match(input: { external_id: string; cdl_number?: string | null; name: string }): MatchOutcome;
}

export function makeDriverMatcher(candidates: Candidate[]): DriverMatcher {
  // `status = 'applicant'` belongs to the recruiting pipeline, which owns that row's lifecycle and
  // protects it with MD010 at merge time. It is held OUT of the match pool and reported separately:
  // linking it would let a later milestone write an employment status over an in-flight hire, and
  // 0213's lifecycle trigger exempts the service role, so nothing below us would object.
  const applicants = candidates.filter((c) => c.status === "applicant");
  const pool = candidates.filter((c) => c.status !== "applicant");

  const byLink = index(pool, (c) => c.link ?? "");
  const byCdl = index(pool, (c) => cdlKey(c.cdl_number));
  const byName = index(pool, (c) => driverMatchKey(c.full_name ?? ""));
  const applicantByCdl = index(applicants, (c) => cdlKey(c.cdl_number));

  return {
    match({ external_id, cdl_number, name }) {
      const link = byLink.get(external_id);
      if (link) return { kind: "linked", id: link.id, by: "link" };
      if (link === null) return { kind: "ambiguous", by: "link" };

      const ck = cdlKey(cdl_number);
      if (ck) {
        const hit = byCdl.get(ck);
        if (hit) return { kind: "matched", id: hit.id, by: "cdl" };
        if (hit === null) return { kind: "ambiguous", by: "cdl" };
        const app = applicantByCdl.get(ck);
        if (app) return { kind: "applicant", id: app.id };
      }

      const nk = driverMatchKey(name);
      if (nk) {
        const hit = byName.get(nk);
        if (hit) return { kind: "matched", id: hit.id, by: "name" };
        if (hit === null) return { kind: "ambiguous", by: "name" };
      }
      return { kind: "unmatched" };
    },
  };
}

export interface AssetMatcher {
  match(input: { external_id: string; vin?: string | null; unit_number?: string | null }): MatchOutcome;
}

/**
 * Vehicles and trailers differ only in how a unit number is compared, so they share one matcher.
 *
 * `unitKey` is where the trailer prefix lives: Silvicom 360 writes `R532159` for the reefer McLeod calls
 * `532159`, and normalising lifted the trailer match from 157 of 235 to 201. The stored unit_number is
 * never rewritten — renaming ~46 trailers is a decision for a human, not a side effect of a sync
 * (D-MR11) — so the normalisation exists here, at the comparison, and nowhere else.
 */
export function makeAssetMatcher(
  candidates: Candidate[],
  unitKey: (u: string | null | undefined) => string,
  order: readonly ("vin" | "unit")[] = ["vin", "unit"],
): AssetMatcher {
  const byLink = index(candidates, (c) => c.link ?? "");
  const byVin = index(candidates, (c) => vinKey(c.vin));
  const byUnit = index(candidates, (c) => unitKey(c.unit_number));

  return {
    match({ external_id, vin, unit_number }) {
      const link = byLink.get(external_id);
      if (link) return { kind: "linked", id: link.id, by: "link" };
      if (link === null) return { kind: "ambiguous", by: "link" };

      for (const by of order) {
        const k = by === "vin" ? vinKey(vin) : unitKey(unit_number);
        if (!k) continue;
        const hit = by === "vin" ? byVin.get(k) : byUnit.get(k);
        if (hit) return { kind: "matched", id: hit.id, by };
        if (hit === null) return { kind: "ambiguous", by };
      }
      return { kind: "unmatched" };
    },
  };
}

export const vehicleUnitKey = (u: string | null | undefined): string => (u ?? "").trim().toUpperCase();
export { trailerUnitMatchKey };
