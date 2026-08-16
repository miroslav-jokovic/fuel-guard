/**
 * EFS card vocabulary — the code tables from Appendix A of the WEX OTR Card Management Web Service
 * Reference (v12.0, July 2024), plus the header enumerations from the Get Card / Set Card pages.
 *
 * Every value here was read off the guide, not inferred. Where the guide is silent, this file says so
 * rather than guessing — see `LIMIT_UNITS` in particular, which is the one place a wrong assumption
 * would be invisible on screen and expensive in real life.
 *
 * Page references: Info IDs p168–169, Limit IDs p169–171, header enums p35–37 (getCard) and p134–139
 * (setCard / setCardV2), time restrictions p37.
 */

// ─── Header enumerations ───────────────────────────────────────────────────────────────────────

/**
 * Card status (p35, p134).
 *
 * `Fraud` is NOT in the getCard status enum — it appears only as the `U` search parameter in
 * getCardSummaries (p44). We accept it on the way in because a card can genuinely be in it; we never
 * write it.
 *
 * `Deleted` is accepted on read and never written. `removeCard` is a hard delete in the EFS system
 * (p128) and status `Deleted` is its equivalent; `Hold` or `Inactive` is always the answer instead.
 */
export const EFS_CARD_STATUSES = ["Active", "Inactive", "Hold", "Deleted", "Fraud"] as const;
export type EfsCardStatus = (typeof EFS_CARD_STATUSES)[number];

/**
 * Compare a vendor status with one of ours, the way EFS actually sends them.
 *
 * ── The fact this exists for ────────────────────────────────────────────────────────────────────
 * The guide documents `Active` / `Inactive` / `Hold` (p35) and every fixture in this repo uses that
 * spelling. A production account returns `ACTIVE` / `INACTIVE` / `HOLD` — the same states, different
 * case. Migration 0176 already settled what to do about vendor values we did not expect: store them
 * VERBATIM and never branch on them without a default. So the fix is not to rewrite what we store; it
 * is to stop comparing stored vendor text with `===`.
 *
 * ── What `===` was actually costing ─────────────────────────────────────────────────────────────
 * Every one of these was live before this helper existed:
 *   • `status !== "Active"` read every active card as LOCKED, so the drawer offered Unlock on a card
 *     that was working.
 *   • `status === "Fraud"` missed `FRAUD`, skipping the step-up that unlocking a fraud-flagged card
 *     is supposed to demand.
 *   • Worst: after writing `status = "Hold"` the reconciler re-read `HOLD`, saw the field differ, and
 *     recorded a lock that HAD WORKED as `failed` — telling an operator the card was unchanged and
 *     inviting them to try again.
 *
 * Case is the only tolerance granted. `Hold` and `HOLD` are one state; `Hold` and `Held` are not, and
 * an unrecognised value still renders verbatim rather than being coerced into something familiar.
 */
export function efsStatusEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return a === b;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The documented spelling of a vendor status, for display lookups. Returns the value UNCHANGED when
 * it matches nothing we know — an unfamiliar state is news, and inventing a label for it hides that.
 */
export function canonicalEfsStatus(value: string | null | undefined): string | null {
  if (value == null) return null;
  return EFS_CARD_STATUSES.find((known) => efsStatusEquals(known, value)) ?? value;
}

/**
 * Spell a status the way THIS account spells it, before writing it.
 *
 * ── The confirmed vendor behaviour this encodes (H1, 2026-08-12) ────────────────────────────────
 * Phase 0 experiment E2 on the QA card: a `setCardv2` carrying `<status>HOLD</status>` — matching
 * the account's own upper-case vocabulary — LANDED in 533ms. The revert carrying `<status>Active</status>`
 * — the guide's documented spelling, but not the account's — was answered with the same void success
 * and silently NOT APPLIED, across three re-reads over ten seconds. Same session, same card, same
 * request shape; the casing was the only variable. That silently-ignored write is the original
 * `no_change` failure this whole audit started from.
 *
 * So: reads stay tolerant (`efsStatusEquals`), writes stay literal. Before dispatching a status we
 * borrow the casing of the status the account just SHOWED us — the one string we know this account's
 * validator accepts, because it produced it.
 *
 * The rule, in order:
 *   • no observed value (null / blank)      → target verbatim (guide spelling; nothing to imitate)
 *   • observed is all upper-case            → TARGET
 *   • observed is all lower-case            → target lower-cased
 *   • observed is mixed-case (`Active`)     → target verbatim — the guide's spelling IS mixed-case,
 *     and inventing any other transform (title-case? camel?) would be an assumption, which is what
 *     put us here.
 */
export function matchStatusCasing(observed: string | null | undefined, target: string): string {
  const seen = observed?.trim() ?? "";
  if (seen === "") return target;
  const hasLetters = seen.toUpperCase() !== seen.toLowerCase();
  if (!hasLetters) return target;
  if (seen === seen.toUpperCase()) return target.toUpperCase();
  if (seen === seen.toLowerCase()) return target.toLowerCase();
  return target;
}

/** Statuses this product is willing to SET. Deliberately excludes Deleted and Fraud. */
export const EFS_WRITABLE_STATUSES = ["Active", "Inactive", "Hold"] as const;
export type EfsWritableStatus = (typeof EFS_WRITABLE_STATUSES)[number];

/**
 * Statuses the LOCK endpoint may write — one, now that each of the three has its own capability.
 *
 * `Active` in the lock schema was an unlock reachable through the lock route: an approver holding
 * only the `lock` scope could re-activate a card — including one mirrored as Fraud, since the
 * fraud step-up lives on the unlock handler — and the audit trail would record it as `card.locked`.
 * Unlock stays the only path that writes `Active`, with its own scope, its own step-up, and its own
 * audit action.
 *
 * `Inactive` left this list in Phase 8.1, for the SECOND half of that same finding. Lock could write
 * it, so retiring a card was recorded as intent `lock` and audit action `card.locked`, and
 * `CardChangeLog.vue` rendered "Locked card" for a retirement — the audit row saying something other
 * than what happened, which is what made P0-3 a P0. `card_deactivate` is now the only path to
 * `Inactive`, with its own scope, its own intent and its own audit action, and migration 0199 widened
 * both CHECK constraints to admit them.
 *
 * The name is kept and the list is one value long on purpose: this is what the LOCK route may ask
 * for, and a constant that answers that question is worth more than the inline literal it would
 * otherwise become. `EFS_WRITABLE_STATUSES` is still the full set the product may ever send.
 */
export const EFS_LOCK_STATUSES = ["Hold"] as const;
export type EfsLockStatus = (typeof EFS_LOCK_STATUSES)[number];

/**
 * The one status `card_deactivate` may write, and it carries no status field to write it WITH.
 *
 * Declared for the config scanner's `emittableValues`, which is what Step 8.3 compares against the
 * account's own spellings. The capability's schema has no `status` at all — reaching any other state
 * through it is not validated-against, it is unrepresentable, which is the stronger form of the
 * guarantee P0-3 asked for.
 */
export const EFS_DEACTIVATE_STATUSES = ["Inactive"] as const;

export const EFS_CARD_STATUS_LABELS: Record<EfsCardStatus, string> = {
  Active: "Active",
  Inactive: "Inactive",
  Hold: "On hold",
  Deleted: "Deleted",
  Fraud: "Fraud hold",
};

/** Single-letter status codes used by getCardSummaries / getCardSummariesV2 search (p44–45). */
export const EFS_STATUS_SEARCH_CODES = { A: "Active", H: "Hold", U: "Fraud", I: "Inactive" } as const;

/** Hand-entered card numbers (p35). DISALLOW removes a whole class of skimming. */
export const EFS_HAND_ENTER = ["ALLOW", "DISALLOW", "POLICY"] as const;
export type EfsHandEnter = (typeof EFS_HAND_ENTER)[number];

/**
 * Whether prompts / limits / locations / time restrictions come from the card, the policy, or both
 * (p35). getCard returns CARD-level records only, even when the source is BOTH — the policy half
 * needs a separate getPolicy call (p84). "Card level always trumps policy" (p37).
 */
export const EFS_CONFIG_SOURCES = ["POLICY", "CARD", "BOTH"] as const;
export type EfsConfigSource = (typeof EFS_CONFIG_SOURCES)[number];

/** Prompt validation types (p36). DYNAMIC is valid ONLY with CNTN, PPIN and DRID. */
export const EFS_VALIDATION_TYPES = [
  "ALPHABETIC", "ALPHA_NUMERIC", "NUMERIC", "REPORT_ONLY", "EXACT_MATCH", "ACCRUAL_CHECK", "DYNAMIC",
] as const;
export type EfsValidationType = (typeof EFS_VALIDATION_TYPES)[number];

/** The three info IDs DYNAMIC may be combined with (p36, p136). */
export const EFS_DYNAMIC_INFO_IDS = ["CNTN", "PPIN", "DRID"] as const;

/** Refreshing-limit source (p141) — a different alphabet from EFS_CONFIG_SOURCES, on purpose. */
export const EFS_REFRESHING_SOURCES = { D: "POLICY", C: "CARD", B: "BOTH" } as const;

/** Payroll (SmartFunds) use flag (p35). Read-only for us in Phase 1. */
export const EFS_PAYROLL_USE_LABELS: Record<string, string> = {
  P: "Payroll only",
  B: "Payroll and normal",
  N: "Normal",
  Y: "Debit",
  L: "Debit with limits",
};

/** Time-restriction day numbering (p37). 1 = Sunday, NOT 0 = Sunday. */
export const EFS_DAY_LABELS: Record<number, string> = {
  1: "Sunday", 2: "Monday", 3: "Tuesday", 4: "Wednesday", 5: "Thursday", 6: "Friday", 7: "Saturday",
};

/** Overrides count DOWN from 1–9 uses (p194). Zero means no override is active. */
export const EFS_OVERRIDE_MIN_USES = 1;
export const EFS_OVERRIDE_MAX_USES = 9;

/** `matchValue` / `reportValue` are string(24) — "Do not send more than 24 characters" (p36). */
export const EFS_MATCH_VALUE_MAX = 24;
/** Limit values are numeric(4), 0–9999 (p36). */
export const EFS_LIMIT_MAX = 9999;
/** Policy numbers are 1–99 (p35). */
export const EFS_POLICY_MIN = 1;
export const EFS_POLICY_MAX = 99;

// ─── Info IDs (pump prompts) — p168–169 ────────────────────────────────────────────────────────

export const EFS_INFO_LABELS: Record<string, string> = {
  BDAY: "Birthday",
  BLID: "Billing ID",
  CNTN: "Control number",
  CRDR: "Card description",
  DLIC: "Driver's licence number",
  DLST: "Driver's licence state",
  DRID: "Driver ID",
  EXPT: "Expense type",
  FSTI: "First initial",
  GLCD: "GL code",
  HBRD: "Hubometer",
  HRRD: "Reefer hour reading",
  LCST: "Licence state",
  LICN: "Licence number",
  LSTN: "Last name",
  NAME: "Driver name",
  ODRD: "Odometer",
  OINV: "Original invoice",
  PONB: "Purchase order number",
  PPIN: "Personal identifier",
  RTMP: "Reefer temperature",
  SSUB: "Sub-fleet identifier",
  TLOC: "Terminal location",
  TRIP: "Trip number",
  TRLR: "Trailer number",
  UNIT: "Unit number",
};

/**
 * The prompts this product edits in Phase 1.
 *
 * Driver and unit only, and only these, because a DRID/UNIT record with EXACT_MATCH is what makes the
 * pump validate who is fuelling and in what truck — the two facts every downstream FuelGuard
 * attribution decision depends on. Everything else in the table is either a reporting field nobody
 * asked to change or, in PPIN's case, a driver-held secret with a credential-handoff problem attached.
 */
export const EFS_EDITABLE_INFO_IDS = ["DRID", "UNIT"] as const;
export type EfsEditableInfoId = (typeof EFS_EDITABLE_INFO_IDS)[number];

export const infoLabel = (infoId: string): string => EFS_INFO_LABELS[infoId] ?? infoId;

// ─── Limit IDs (per-product caps) — p169–171 ───────────────────────────────────────────────────

export const EFS_LIMIT_LABELS: Record<string, string> = {
  ADD: "Additives", AMDS: "Aviation merchandise", ANFR: "Anti-freeze", AVGS: "Aviation gas",
  BDSL: "Biodiesel", BRAK: "Brakes and wheels", CADV: "Cash advance", CLTH: "Clothing",
  CNG: "Compressed natural gas", COUP: "Coupon", DEF: "DEF (bulk)", DEFC: "DEF (container)",
  DELI: "Restaurant / deli", DSL: "Diesel", DSLM: "Mexico diesel", ELEC: "Electronics",
  EVCH: "Electric charging", FAX: "Fax", FURN: "Furnace oil", GAS: "Gasoline",
  GASM: "Mexico gas magna", GASP: "Mexico premium gas", GROC: "C-store / groceries",
  HARD: "Hardware / accessories", IDLE: "IdleAire", JET: "Jet fuel", KERO: "Kerosene",
  LABR: "Labour", LMPR: "Lumper", LNG: "Liquid natural gas", MDSL: "Tax-exempt diesel",
  MERC: "Miscellaneous merchandise", MGAS: "Tax-exempt gas", MRFR: "Marked reefer",
  NGAS: "Natural gas", OIL: "Oil", OILC: "Oil change", PART: "Parts", PHON: "Phone time",
  PNT: "Paint", PROP: "Propane", RECP: "Recap", REPR: "Repair service", REST: "Restaurant",
  RFND: "Refund", RFR: "Reefer", RFRM: "Thermo", SCAN: "Tons imaging", SCLE: "Weigh scale",
  SHWR: "Shower", SPLT: "Split / other payment", STAX: "Sales tax", TIRE: "Tyres / tyre repairs",
  TOLL: "Ambassador Bridge toll", TRAL: "Trailer", TRPP: "Trip permit",
  ULSD: "Ultra-low-sulphur diesel", WASH: "Car wash", WIFI: "Fleet WiFi", WWFL: "Washer fluid",
};

export type EfsLimitUnit = "gallons" | "units" | "dollars";

/**
 * What a limit VALUE means. This matters more than it looks: a `ULSD` limit of 100 is a hundred
 * gallons, and rendering it as "$100" tells a fleet manager their driver can buy a third of a tank
 * when in fact he can fill twice.
 *
 * The guide states the rule but does not enumerate which products it covers: "the limit value, which
 * will be gallons for fuel or DEF dispensed and dollar amounts in all other cases" (p36). So:
 *
 *   • `gallons` — liquid fuel and DEF, where "gallons" is unambiguous.
 *   • `units`   — dispensed energy that is NOT sold by the gallon (CNG and LNG in DGE/GGE, electric
 *                 charging in kWh). The guide's sentence plainly intends a dispensed quantity rather
 *                 than dollars, but it does not say the unit, so we render a neutral one instead of
 *                 asserting a wrong one. Confirm with WEX before showing a unit on these.
 *   • `dollars` — everything else, per "dollar amounts in all other cases". This is the DEFAULT, so an
 *                 unrecognised or newly-added limit ID falls here rather than silently claiming volume.
 */
const GALLON_LIMIT_IDS = new Set([
  "ULSD", "DSL", "DSLM", "BDSL", "MDSL", "GAS", "GASM", "GASP", "MGAS",
  "DEF", "DEFC", "RFR", "MRFR", "RFRM", "KERO", "PROP", "AVGS", "JET", "FURN",
]);
const UNIT_LIMIT_IDS = new Set(["CNG", "LNG", "NGAS", "EVCH"]);

export function limitUnit(limitId: string): EfsLimitUnit {
  const id = limitId.toUpperCase();
  if (GALLON_LIMIT_IDS.has(id)) return "gallons";
  if (UNIT_LIMIT_IDS.has(id)) return "units";
  return "dollars";
}

export const limitLabel = (limitId: string): string => EFS_LIMIT_LABELS[limitId] ?? limitId;

/** Render a limit value with the unit its ID implies. */
export function formatLimit(limitId: string, value: number): string {
  switch (limitUnit(limitId)) {
    case "gallons":
      return `${value} gal`;
    case "units":
      return `${value}`;
    default:
      return `$${value}`;
  }
}

/**
 * Display form of a card. NEVER render a full PAN — the same rule the web app's card-assignment
 * composable has always applied, lifted here so the API, the web app and the driver app cannot drift.
 */
export const maskPan = (last4: string): string => `•••• ${last4}`;
