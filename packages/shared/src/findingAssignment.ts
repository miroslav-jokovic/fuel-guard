import { type AppSection, rolesThatManage } from "./auth.js";
import type { UserRole } from "./constants.js";
import { CASE_RULE_ID } from "./anomalyRules/cases.js";
import { FUEL_EXCEPTION_KINDS, type FuelExceptionKind } from "./fuelSpend/exceptions.js";

/**
 * Who may close a finding, and who may be assigned one (Q-FUI4 and Q-FUI15, both ruled 2026-09-06).
 *
 * ── WHY THE SECTION COMES FROM THE FINDING AND NOT FROM THE PAGE ──────────────────────────────
 * Q-FUI4's recorded fallback was `rolesThatManage("fuel")` writes, for everything. That predates
 * Q-FUI1, which ruled that the merged inbox holds BOTH sources and that **each finding kind carries
 * its own section** — and the two cannot both be true. `safety_manager` holds `safety: "manage"` and
 * `fuel: "view"`, so a uniform fuel gate would take the theft queue away from the person who works it
 * on `/anomalies` today. A narrowing taken in passing is exactly what T2 refused to do to the four
 * routes in Q-FUI12; this is the same refusal, applied before the narrowing rather than after.
 *
 * So the gate is derived from the finding: `rolesThatManage(sectionOfFinding(kind))`. Nothing here is
 * a list of roles. Change `SECTION_ACCESS` and this moves with it, which is the property a hand-written
 * list beside a derived matrix does not have (CLAUDE.md, "no workarounds" — deriving beats restating).
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────────────────────
 * It is not C7a. C7a maps the QUEUE AXIS and the two close models onto one read contract; this maps
 * kind → section, which is one fact C7a will consume and which two rulings needed first. And it is
 * not a lifecycle: no default assignee is invented here, because the ruling was **unassigned by
 * default** — a finding is claimed, and aging is what makes an unclaimed one visible rather than a
 * name written on it at creation that nobody agreed to.
 *
 * ⚠ TODAY THIS CHANGES NO GATE. `fuel_exceptions` can only hold the eight kinds below, every one of
 * them `fuel`, so `requireSection("fuel")` on the ledger's writes is already exactly what this
 * derives. It becomes load-bearing the moment C7b puts a `theft_case` in the same queue — which is
 * the point of settling it now, while it is a map and not a migration.
 */

/** Every kind the merged inbox will hold: the ledger's eight, plus the anomaly feed's one case type. */
export const FINDING_KINDS = [...FUEL_EXCEPTION_KINDS, CASE_RULE_ID] as const;
export type FindingKind = FuelExceptionKind | typeof CASE_RULE_ID;

/**
 * The section a finding belongs to — TOTAL over `FindingKind`, so a new kind cannot be added without
 * a compiler error here deciding who owns it. That is deliberate: a kind with no section would fall
 * to whatever the page's gate happened to be, which is the failure this whole map exists to prevent.
 */
export const FINDING_SECTIONS: Record<FindingKind, AppSection> = {
  // The vendor-statement and policy findings are money: fuel spend is the section that owns them.
  recon_missing_in_system: "fuel",
  recon_missing_on_report: "fuel",
  recon_amount: "fuel",
  recon_gallons: "fuel",
  contract_variance: "fuel",
  off_network_premium: "fuel",
  avoided_state_premium: "fuel",
  avoided_brand_premium: "fuel",
  // A theft case is an accusation about a person, not a variance about money. It is worked by the
  // safety manager on `/anomalies` today and stays theirs when the surfaces merge (Q-FUI1).
  [CASE_RULE_ID]: "safety",
};

export const sectionOfFinding = (kind: FindingKind): AppSection => FINDING_SECTIONS[kind];

/**
 * The sections the inbox actually holds findings for, DERIVED from the map above rather than listed.
 *
 * It is the closed set an `?section=` parameter is validated against, so that endpoint cannot be used
 * to enumerate the members of a section no finding belongs to — and adding a kind extends it without
 * anybody remembering to.
 */
export const FINDING_ASSIGNABLE_SECTIONS: readonly AppSection[] = [
  ...new Set(Object.values(FINDING_SECTIONS)),
];

/** Who may close, assign or otherwise write this finding. Derived; never a list. */
export const rolesThatManageFinding = (kind: FindingKind): UserRole[] =>
  rolesThatManage(sectionOfFinding(kind));

/**
 * Who may be OFFERED as the assignee of a finding in this section (Q-FUI15).
 *
 * The picker's candidate list is the same set as the write gate, and that identity is the whole
 * design: offering somebody who could not then close it is a menu that produces a stuck finding. The
 * ruling chose this over a general org directory precisely because it is narrower — a driver has
 * `none` on every section and so appears in no list, without anybody hand-writing "not drivers".
 */
export const rolesAssignableIn = (section: AppSection): UserRole[] => rolesThatManage(section);
