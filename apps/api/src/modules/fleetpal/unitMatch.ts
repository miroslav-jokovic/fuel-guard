/**
 * Which of our trucks is this FleetPal unit? (FLEETPAL-INTEGRATION-PLAN.md F5, §2.6, D-FP7.)
 *
 * A **pure** function over the vendor's unit and our roster. No database, no clock, no fetch — so
 * the cases that decide whether a cost report is right can be written as three lines of fixture
 * each: a VIN that differs only in case, a number that collides between a tractor and a trailer, a
 * unit that matches nothing.
 *
 * ── THE ORDER IS VIN, THEN NUMBER, THEN NOTHING — AND "NOTHING" IS A RESULT ────────────────────
 * VIN is a manufacturer-issued identifier with a check digit; a unit number is whatever the shop
 * typed. So VIN decides, the number is the fallback, and anything left over stays **unmatched and
 * visible** rather than being guessed at. That last part is the whole posture: a fuzzy matcher is a
 * source of wrong answers for ever, while forty-eight visible rows are an afternoon's
 * reconciliation somebody can actually finish (§2.6).
 *
 * ── ⚠ AMBIGUITY RESOLVES TO UNMATCHED, DELIBERATELY ───────────────────────────────────────────
 * When an identifier picks out more than one of our rows, this returns `unmatched` with a reason
 * rather than choosing. The alternative — take the first, or prefer the active one — is a decision
 * made by sort order, which reads as a bug only once the money is wrong. Measured 2026-09-21: our
 * roster has NO duplicate VINs and NO duplicate unit numbers across 517 vehicle and trailer rows,
 * not even between the two tables, so this branch costs nothing today and is the one that stops an
 * imported duplicate from silently re-pointing a truck's repair history tomorrow.
 *
 * ── ⚠ THE VENDOR'S SIDE *DOES* HAVE DUPLICATES, AND THAT IS NOT AMBIGUITY ─────────────────────
 * Eight VINs and eight unit numbers appear TWICE in FleetPal's own unit list (F4) — an old record
 * and its replacement, both live. Two FleetPal units resolving to one vehicle of ours is therefore
 * expected and correct: `fleetpal_units` is unique on `(org_id, fleetpal_id)` and not on
 * `vehicle_id`, so 0334 permits it. **Anything that sums cost per truck must sum across every
 * `fleetpal_units` row for that vehicle** or it reports half the repair spend for those eight.
 *
 * ── THE CATEGORY IS A HINT, NEVER THE DECISION (§2.6) ──────────────────────────────────────────
 * `Unit.vmrs_equipment_category` is the vendor's own answer to "truck or trailer", and it arrives as
 * an opaque VMRS id — resolvable only through `/v1/vmrs-equipment-categories`, whose English is
 * licensed and never stored (D-FP8). The caller resolves it to a `kind` if it can and passes null if
 * it cannot; either way it only ever breaks a TIE between a tractor and a trailer wearing the same
 * number. A unit that matches trailer 4102 by VIN is a trailer whatever its category says.
 */

/** The half of a roster row this decision needs. `listEquipmentIdentities` supplies it. */
export interface RosterCandidate {
  id: string;
  unitNumber: string;
  vin: string | null;
}

export interface Roster {
  vehicles: RosterCandidate[];
  trailers: RosterCandidate[];
}

/** What the vendor gives us to match on. A subset of `FleetpalUnit`, so fixtures stay small. */
export interface MatchableUnit {
  vin?: string | null;
  number?: string | null;
}

export type MatchReason =
  | "vin"
  | "number"
  | "no-identifiers"
  | "no-candidate"
  | "ambiguous-vin"
  | "ambiguous-number";

export interface UnitMatch {
  method: "vin" | "number" | "unmatched";
  vehicleId: string | null;
  trailerId: string | null;
  /**
   * Why. `unmatched` is four different situations — the unit carries no identifiers, nothing of
   * ours answers to them, or an identifier picks out two rows — and the reconciliation screen
   * should say which, because "add the VIN in FleetPal" and "you have two trucks with one number"
   * are different jobs for different people.
   */
  reason: MatchReason;
}

/**
 * Uppercase, trimmed, inner whitespace removed.
 *
 * Case is the one that bites: FleetPal stores VINs uppercase and validates the check digit, we
 * store whatever was typed, and `3akjhhdr...` === `3AKJHHDR...` is a truck either way. Whitespace
 * is stripped because a VIN pasted out of a spreadsheet arrives with a trailing space often enough
 * to matter.
 */
export function normaliseVin(vin: string | null | undefined): string {
  return String(vin ?? "").replace(/\s+/g, "").toUpperCase();
}

/**
 * Trimmed and uppercased, and **nothing else** — no zero-stripping, no punctuation removal.
 *
 * Unit `"805"` and `"0805"` are not asserted to be the same truck here. They may well be, and a
 * person can say so with the manual link; a normaliser that decided it would also merge `"R532309"`
 * with `"532309"`, which are a trailer and a tractor on this fleet.
 */
export function normaliseUnitNumber(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

const unmatched = (reason: MatchReason): UnitMatch => ({
  method: "unmatched",
  vehicleId: null,
  trailerId: null,
  reason,
});

interface Hit {
  side: "vehicle" | "trailer";
  id: string;
}

function findAll(roster: Roster, predicate: (c: RosterCandidate) => boolean): Hit[] {
  const hits: Hit[] = [];
  for (const v of roster.vehicles) if (predicate(v)) hits.push({ side: "vehicle", id: v.id });
  for (const t of roster.trailers) if (predicate(t)) hits.push({ side: "trailer", id: t.id });
  return hits;
}

const resolved = (method: "vin" | "number", hit: Hit): UnitMatch => ({
  method,
  vehicleId: hit.side === "vehicle" ? hit.id : null,
  trailerId: hit.side === "trailer" ? hit.id : null,
  reason: method,
});

/**
 * Resolve one FleetPal unit against the roster.
 *
 * `hint` is the vendor's equipment category, already resolved to one of our two kinds by a caller
 * that could — see the header. It breaks a tie and never makes a match on its own.
 */
export function matchFleetpalUnit(
  unit: MatchableUnit,
  roster: Roster,
  hint: "tractor" | "trailer" | null = null,
): UnitMatch {
  const vin = normaliseVin(unit.vin);
  const number = normaliseUnitNumber(unit.number);
  if (!vin && !number) return unmatched("no-identifiers");

  if (vin) {
    const hits = findAll(roster, (c) => normaliseVin(c.vin) === vin);
    if (hits.length === 1) return resolved("vin", hits[0]!);
    // Two of our rows carrying one VIN is a data problem in the ROSTER, and picking one would hide
    // it behind a repair history that looks fine. The hint is not consulted: a VIN is specific
    // enough that a tie means something is wrong, not that the kind is unclear.
    if (hits.length > 1) return unmatched("ambiguous-vin");
  }

  if (number) {
    const hits = findAll(roster, (c) => normaliseUnitNumber(c.unitNumber) === number);
    if (hits.length === 1) return resolved("number", hits[0]!);
    if (hits.length > 1) {
      // A tractor and a trailer wearing the same number is the tie the category exists to break —
      // and only when it picks out exactly one of them.
      const wanted = hint === "tractor" ? "vehicle" : hint === "trailer" ? "trailer" : null;
      const narrowed = wanted ? hits.filter((h) => h.side === wanted) : [];
      if (narrowed.length === 1) return resolved("number", narrowed[0]!);
      return unmatched("ambiguous-number");
    }
  }

  return unmatched("no-candidate");
}

/** What a reconciliation screen counts. Derived, never stored — the rows are the source. */
export interface MatchCensus {
  total: number;
  vin: number;
  number: number;
  manual: number;
  unmatched: number;
}

export function censusOf(matches: { matchMethod: UnitMatch["method"] | "manual" }[]): MatchCensus {
  const census: MatchCensus = { total: matches.length, vin: 0, number: 0, manual: 0, unmatched: 0 };
  for (const m of matches) census[m.matchMethod]++;
  return census;
}
