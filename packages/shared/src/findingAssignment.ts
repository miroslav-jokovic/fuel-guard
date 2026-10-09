import { type AppSection, rolesThatManage } from "./auth.js";
import type { UserRole } from "./constants.js";
import { CASE_RULE_ID } from "./anomalyRules/cases.js";
import { FUEL_EXCEPTION_KINDS, FUEL_EXCEPTION_KIND_LABELS, type FuelExceptionKind } from "./fuelSpend/exceptions.js";
import { BUYING_HABIT_KINDS } from "./fuelSpend/buyingHabits.js";

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
 * not a lifecycle: no default assignee is invented here. Q-FUI15 ruled **unassigned by default**; Q-F1
 * (2026-10-06) replaced that for the fuel queue with a named owner, and the default lives in the
 * database (migration 0442: the org's fuel queue owner, assigned by trigger on insert), not here. Whoever
 * sets that owner must check `rolesAssignableIn` for every section below, as `findingsAssign.ts` does.
 *
 * ⚠ TODAY THIS CHANGES NO GATE. `fuel_exceptions` can only hold the eight kinds below, every one of
 * them `fuel`, so `requireSection("fuel")` on the ledger's writes is already exactly what this
 * derives. It becomes load-bearing the moment C7b puts a `theft_case` in the same queue — which is
 * the point of settling it now, while it is a map and not a migration.
 */

/**
 * A card-fraud incident as a finding (CF2, D-CF1: a card used where its truck is not). One kind, as the
 * anomaly feed has one: the incident table holds nothing else.
 */
export const CARD_FRAUD_KIND = "card_fraud";

/** Every kind the merged inbox holds: the ledger's eight, the anomaly feed's one, the incidents' one. */
export const FINDING_KINDS = [...FUEL_EXCEPTION_KINDS, CASE_RULE_ID, CARD_FRAUD_KIND] as const;
export type FindingKind = FuelExceptionKind | typeof CASE_RULE_ID | typeof CARD_FRAUD_KIND;

/**
 * The money kinds the fuel queue holds: every ledger kind except the buying habits (F02-F04 chunk 9b,
 * Q-F2 ruled 2026-10-06). A habit is a premium nobody can dispute, so it is a report on Fuel Costs
 * (`BUYING_HABIT_KINDS`, 9a) and not a task. Derived, so a new ledger kind joins the queue unless it is a
 * habit — and a new habit leaves it the day the producer files it.
 */
export const QUEUE_EXCEPTION_KINDS: readonly FuelExceptionKind[] = FUEL_EXCEPTION_KINDS.filter(
  (k) => !(BUYING_HABIT_KINDS as readonly string[]).includes(k),
);
/** Every kind Fuel problems lists: the queue's money kinds, the fill case, the card-fraud incident. */
export const QUEUE_FINDING_KINDS: readonly FindingKind[] = [...QUEUE_EXCEPTION_KINDS, CASE_RULE_ID, CARD_FRAUD_KIND];

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
  // Q-F11 (a), ruled 2026-10-08: fuel. What a person does about a card used where its truck is not is
  // hold or replace the card in WEX, which is the fuel manager's job; a safety manager without fuel
  // cannot act on it. Recorded in F02-F04 PLAN.md, chunk 8c.
  [CARD_FRAUD_KIND]: "fuel",
};

export const sectionOfFinding = (kind: FindingKind): AppSection => FINDING_SECTIONS[kind];

/**
 * The words a reader sees for each kind, spanning both vocabularies (C7b).
 *
 * The ledger's eight come from `FUEL_EXCEPTION_KIND_LABELS` rather than being retyped — one home for
 * a label, so a wording change on the ledger page cannot leave the inbox saying something else. The
 * ninth is the anomaly feed's single case type, and it is named "Possible theft" rather than the
 * catalogue's "Theft Risk" because this list sits beside eight billing findings: a reader scanning a
 * mixed queue needs the word that separates an accusation about a PERSON from a discrepancy about
 * money, and "risk" reads as a score.
 */
export const FINDING_KIND_LABELS: Record<FindingKind, string> = {
  ...FUEL_EXCEPTION_KIND_LABELS,
  [CASE_RULE_ID]: "Possible theft",
  [CARD_FRAUD_KIND]: "Card used away from its truck",
};

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
