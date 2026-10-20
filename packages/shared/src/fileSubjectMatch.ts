/**
 * Whose paper is this? (UNIT-FILES-PLAN UF7b, D-UF8.) PURE: the bulk-upload reader says what a paper
 * names — VINs, plates, unit numbers, a CDL number, a name — and this decides which of OUR drivers,
 * trucks or trailers it names, or that it names none of them with certainty. It proposes; a person
 * files (D-UF8). No database, no clock: the caller passes the roster.
 *
 * ── THE ORDER IS THE PLAN'S, STRONGEST IDENTIFIER FIRST ─────────────────────────────────────────
 *   1. VIN (17 characters) — manufacturer-issued, with a check digit;
 *   2. plate (+ state, when both sides know it);
 *   3. unit number, leading zeros folded ("0654" is unit 654);
 *   4. a filename token ("654-registration.pdf") — a TIE-BREAKER between two units one identifier
 *      could not tell apart (a plate with no state on two trucks), never a match on its own: a file
 *      is named by whoever scanned it. It cannot split two units that share a number, by definition;
 *   5. a driver's CDL number, then their exact full name.
 * The first step that names anybody decides. A later step is not consulted to overrule it.
 *
 * ── ⚠ AMBIGUITY PROPOSES NOBODY ─────────────────────────────────────────────────────────────────
 * Two candidates for one identifier → no proposal, never the first or the active one. Two drivers
 * called Jose Garcia is a fact of this fleet's roster, and a medical card filed on the wrong one
 * makes the right one look qualified. FleetPal's matcher keeps the same posture for the same reason
 * (`fleetpal/unitMatch.ts`), and the VIN and unit-number spellings are its, moved here, not copied.
 *
 * ── LEADING ZEROS FOLD; NOTHING ELSE DOES ───────────────────────────────────────────────────────
 * `normaliseUnitNumber` refuses to fold anything, because a normaliser that stripped prefixes would
 * merge trailer "R532309" with tractor "532309". Folding only LEADING ZEROS cannot do that — "R0532"
 * stays "R0532" — and a scanned registration reading "0654" for unit 654 is common enough that the
 * plan asks for it. The plan also said to fold `mcleod_fleet_code`; that column is the DISPATCH fleet
 * ('VINNIEV', 'KANE', '1', migration 0450), not a unit's name, and folding it would let a paper for
 * unit 1 match every truck in fleet '1'. It is not folded (plan progress log, UF7b).
 *
 * ── SEVERAL UNITS ON ONE PAPER ──────────────────────────────────────────────────────────────────
 * A policy's schedule or a fleet registration lists units. When the strongest step names more than
 * one unit, the answer is ALL of them (`units`), with no single subject: filing writes one
 * certification per unit (D-UF6). An identifier on such a list that names nobody, or two, is
 * reported (`unresolved`) rather than dropped in silence.
 *
 * ── A SCOPED DROP ───────────────────────────────────────────────────────────────────────────────
 * A paper dropped on one row's File cell belongs to that row; the reading only says what it is. If
 * the paper's own identifiers name somebody else with certainty, the row says so (`contradicts`) —
 * a warning for the person, never a move.
 */
import type { UnitSubjectType } from "./equipmentFileCatalogue.js";

/** The subjects a paper can be filed on. */
export type FileSubjectKind = "driver" | UnitSubjectType;

export interface FileSubjectRef {
  type: FileSubjectKind;
  id: string;
}

/** Which identifier named the subject — `file_intake_items.match_basis` (0504) is this list. */
export const FILE_MATCH_BASES = ["vin", "plate", "unit_number", "filename", "cdl", "name", "scope"] as const;
export type FileMatchBasis = (typeof FILE_MATCH_BASES)[number];

export interface UnitCandidate {
  type: UnitSubjectType;
  id: string;
  unitNumber: string;
  vin: string | null;
  plate: string | null;
  plateState: string | null;
}

export interface DriverCandidate {
  id: string;
  fullName: string;
  cdlNumber: string | null;
}

export interface MatchRoster {
  units: readonly UnitCandidate[];
  drivers: readonly DriverCandidate[];
}

/** What the reader found on ONE paper. Every list may be empty. */
export interface PaperIdentifiers {
  vins: readonly string[];
  plates: readonly { number: string; state: string | null }[];
  unitNumbers: readonly string[];
  cdlNumber: string | null;
  driverName: string | null;
  /** The uploaded file's name, for step 4. */
  filename: string | null;
}

export interface SubjectProposal {
  /** One subject, or null — for "nobody with certainty", and for a paper naming several units. */
  subject: FileSubjectRef | null;
  /** Every unit a multi-unit paper names; empty otherwise. */
  units: FileSubjectRef[];
  basis: FileMatchBasis | null;
  reason: "matched" | "no_identifiers" | "no_candidate" | "ambiguous";
  /** Identifiers on a multi-unit paper that named nobody, or more than one unit. */
  unresolved: string[];
  /** A scoped drop whose paper names someone else with certainty. */
  contradicts: FileSubjectRef | null;
}

// ── spellings ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Whitespace out, uppercase — and nothing else. Moved from `fleetpal/unitMatch.ts` (F5) for the intake
 * matcher; FleetPal re-exports it, so the two readings of a VIN cannot drift.
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
 * Trimmed and uppercased, and **nothing else** — no zero-stripping, no punctuation removal. Moved from
 * `fleetpal/unitMatch.ts` with `normaliseVin`.
 *
 * Unit `"805"` and `"0805"` are not asserted to be the same truck here. They may well be, and a
 * person can say so with the manual link; a normaliser that decided it would also merge `"R532309"`
 * with `"532309"`, which are a trailer and a tractor on this fleet. `foldUnitNumber` below is the
 * intake's looser reading, which a person then confirms.
 */
export function normaliseUnitNumber(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

/** `normaliseUnitNumber` with LEADING zeros folded: "0654" → "654", "000" → "0", "R0532" unchanged. */
export const foldUnitNumber = (value: string | null | undefined): string =>
  normaliseUnitNumber(value).replace(/^0+(?=.)/, "");

/** Plates are painted with spaces and dashes the DMV does not record. */
const normalisePlate = (value: string | null | undefined): string =>
  String(value ?? "").replace(/[\s-]+/g, "").toUpperCase();

/** A CDL number as a person types it: letters and digits only. */
const normaliseCdl = (value: string | null | undefined): string =>
  String(value ?? "").replace(/[^0-9a-z]/gi, "").toUpperCase();

const normaliseName = (value: string | null | undefined): string =>
  String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();

/** "654-registration (2).pdf" → ["654", "REGISTRATION", "2"]: the stem's alphanumeric runs. */
const filenameTokens = (name: string | null): string[] =>
  String(name ?? "")
    .replace(/\.[^.]+$/, "")
    .split(/[^0-9a-z]+/i)
    .filter(Boolean)
    .map(foldUnitNumber);

// ── one identifier at a time ──────────────────────────────────────────────────────────────────────

const ref = (u: UnitCandidate): FileSubjectRef => ({ type: u.type, id: u.id });
const distinct = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** Each identifier's candidates, with the identifier as the paper wrote it. */
interface Lookup {
  label: string;
  hits: UnitCandidate[];
}

function unitLookups(ids: PaperIdentifiers, units: readonly UnitCandidate[]): { basis: FileMatchBasis; lookups: Lookup[] }[] {
  const vins = distinct(ids.vins.map(normaliseVin)).filter((v) => v.length === 17);
  const plates = ids.plates.filter((p) => normalisePlate(p.number));
  const numbers = distinct(ids.unitNumbers.map(foldUnitNumber)).filter(Boolean);
  return [
    { basis: "vin", lookups: vins.map((v) => ({ label: v, hits: units.filter((u) => normaliseVin(u.vin) === v) })) },
    {
      basis: "plate",
      lookups: plates.map((p) => {
        const state = String(p.state ?? "").trim().toUpperCase();
        return {
          label: p.state ? `${p.number} ${p.state}` : p.number,
          hits: units.filter(
            (u) =>
              normalisePlate(u.plate) === normalisePlate(p.number) &&
              // A state on both sides must agree; a state on one side only does not disqualify.
              (!state || !u.plateState || u.plateState.trim().toUpperCase() === state),
          ),
        };
      }),
    },
    { basis: "unit_number", lookups: numbers.map((n) => ({ label: n, hits: units.filter((u) => foldUnitNumber(u.unitNumber) === n) })) },
  ];
}

/** Step 4: among tied candidates, the one a filename token names — if exactly one. */
function breakTie(hits: UnitCandidate[], filename: string | null): UnitCandidate | null {
  const tokens = new Set(filenameTokens(filename));
  const named = hits.filter((u) => tokens.has(foldUnitNumber(u.unitNumber)));
  return named.length === 1 ? named[0]! : null;
}

const answer = (over: Partial<SubjectProposal>): SubjectProposal => ({
  subject: null, units: [], basis: null, reason: "no_candidate", unresolved: [], contradicts: null, ...over,
});

function matchUnits(ids: PaperIdentifiers, units: readonly UnitCandidate[]): SubjectProposal | null {
  for (const { basis, lookups } of unitLookups(ids, units)) {
    if (lookups.length === 0) continue;
    const resolved: FileSubjectRef[] = [];
    const unresolved: string[] = [];
    let tieBroken = false;
    for (const l of lookups) {
      if (l.hits.length === 1) resolved.push(ref(l.hits[0]!));
      else {
        const picked = l.hits.length > 1 ? breakTie(l.hits, ids.filename) : null;
        if (picked) {
          resolved.push(ref(picked));
          tieBroken = true;
        } else unresolved.push(l.label);
      }
    }
    // Two identifiers on one paper naming the same unit (its VIN and its plate) are one unit.
    const found = [...new Map(resolved.map((r) => [`${r.type}:${r.id}`, r])).values()];
    if (found.length === 0) {
      // An identifier with two candidates and nothing to break the tie: say so, and stop — a weaker
      // identifier must not overrule the stronger one's "it could be either".
      if (lookups.some((l) => l.hits.length > 1)) return answer({ reason: "ambiguous", basis, unresolved });
      continue;
    }
    const used: FileMatchBasis = tieBroken && found.length === 1 ? "filename" : basis;
    if (found.length === 1) return answer({ subject: found[0]!, basis: used, reason: "matched", unresolved });
    return answer({ units: found, basis, reason: "matched", unresolved });
  }
  return null;
}

function matchDriver(ids: PaperIdentifiers, drivers: readonly DriverCandidate[]): SubjectProposal | null {
  const cdl = normaliseCdl(ids.cdlNumber);
  if (cdl) {
    const hits = drivers.filter((d) => normaliseCdl(d.cdlNumber) === cdl);
    if (hits.length === 1) return answer({ subject: { type: "driver", id: hits[0]!.id }, basis: "cdl", reason: "matched" });
    if (hits.length > 1) return answer({ basis: "cdl", reason: "ambiguous", unresolved: [ids.cdlNumber!] });
  }
  const name = normaliseName(ids.driverName);
  if (name) {
    const hits = drivers.filter((d) => normaliseName(d.fullName) === name);
    if (hits.length === 1) return answer({ subject: { type: "driver", id: hits[0]!.id }, basis: "name", reason: "matched" });
    if (hits.length > 1) return answer({ basis: "name", reason: "ambiguous", unresolved: [ids.driverName!] });
  }
  return null;
}

const hasIdentifiers = (ids: PaperIdentifiers): boolean =>
  ids.vins.length + ids.plates.length + ids.unitNumbers.length > 0 || Boolean(ids.cdlNumber?.trim() || ids.driverName?.trim());

/** The paper's own answer, before any scope: unit identifiers first, then a driver's. */
function matchUnscoped(ids: PaperIdentifiers, roster: MatchRoster): SubjectProposal {
  if (!hasIdentifiers(ids)) return answer({ reason: "no_identifiers" });
  return matchUnits(ids, roster.units) ?? matchDriver(ids, roster.drivers) ?? answer({ reason: "no_candidate" });
}

/**
 * Propose a subject for one paper. `scope` is the row the paper was dropped on, when it was: the
 * subject is then fixed, and the paper's own answer only raises `contradicts`.
 */
export function proposeFileSubject(ids: PaperIdentifiers, roster: MatchRoster, scope: FileSubjectRef | null = null): SubjectProposal {
  const own = matchUnscoped(ids, roster);
  if (!scope) return own;
  const named = own.subject ? [own.subject] : own.units;
  const elsewhere = named.length > 0 && !named.some((s) => s.type === scope.type && s.id === scope.id);
  return answer({ subject: scope, basis: "scope", reason: "matched", contradicts: elsewhere ? named[0]! : null });
}
