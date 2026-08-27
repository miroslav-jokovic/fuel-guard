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

/**
 * Upper bound for an ACCRUAL_CHECK accrual value.
 *
 * The vendor gives no explicit ceiling: `WSCardInfo.value` is `int` in the WSDL, "String" on the
 * guide's card pages (p36, p135, p138) and "int(24)" on setPolicy (p146). Production's own ODRD
 * records carry `maximum: 1800` alongside the ACCRUAL_CHECK, so the account is working in the low
 * thousands of miles. 9,999,999 is the widest value that still fits every one of those declarations
 * and still refuses a fat-fingered nine-digit entry — chosen as a sanity bound on what WE send, in
 * the same spirit as `EFS_LIMIT_MAX`, not as a claim about what EFS accepts.
 */
export const EFS_PROMPT_ACCRUAL_MAX = 9_999_999;

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
/**
 * `hours` and `minHours` are both `int (3)` on the guide's limits table (p36) — so 0–999.
 *
 * Read from the FIELD TABLE, not from p194's recipe, which only ever shows `hours: 1`. 999 hours is
 * about six weeks; the account's own records run to 168 (a week), so this bounds a typo rather than
 * a legitimate window. Same spirit as `EFS_LIMIT_MAX`: a bound on what WE send.
 */
export const EFS_LIMIT_HOURS_MAX = 999;
/**
 * How many products one override may open at once.
 *
 * Not a vendor number — the guide states no ceiling and `WSCardv2.limits` is unbounded. It is a
 * blast-radius bound: an override REPLACES the card's limits (p194), so a ten-product override is
 * already a rewrite of the card's whole fuel policy, and anything larger is more likely a loop than
 * an operator. The WEX portal's "Save and Add Another" is the flow this bounds.
 */
export const EFS_OVERRIDE_MAX_LIMITS = 10;
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
 * The FALLBACK editable set — what this product may edit when it has never asked the account.
 *
 * Driver and unit only, because a DRID/UNIT record with EXACT_MATCH is what makes the pump validate
 * who is fuelling and in what truck — the two facts every downstream Silvicom 360 attribution decision
 * depends on. Until Phase 9 this was the WHOLE editable set, hardcoded; `resolveEditableInfoIds`
 * now widens it to what the account actually offers, and falls back to this pair when it cannot.
 *
 * Deliberately NOT widened to the resolved set: a fallback that guesses generously is worse than one
 * that guesses narrowly, because the failure it covers is "we could not read the account".
 */
export const EFS_EDITABLE_INFO_IDS = ["DRID", "UNIT"] as const;
export type EfsEditableInfoId = (typeof EFS_EDITABLE_INFO_IDS)[number];

/**
 * Prompt IDs this product refuses to edit even when the account offers them.
 *
 * PPIN is the driver's Personal Identifier — a credential the driver holds, not a fleet attribute.
 * Three separate reasons, any one of which is sufficient:
 *
 *   1. Editing it is ISSUING a credential, which is a different act from configuring a card and
 *      belongs to whoever owns driver identity, not to a fleet-card screen.
 *   2. `matchValue` carries it in clear on the request, in `mirror.last_response_xml_redacted`, and
 *      in the audit diff. `redactCardXml` masks digit runs of TEN OR MORE and `<cardNumber>`
 *      elements; a 4-6 digit PIN passes through every one of those rules untouched.
 *   3. It was already excluded before Phase 9, for reason 1, and Phase 9 widening the set by
 *      intersection would have re-admitted it silently as a side effect rather than as a decision.
 *
 * Miki's call, 2026-08-16, on being shown that the runtime set resolves to 25 including this one.
 * Reversing it is a product decision AND a redaction change — reason 2 does not go away on its own.
 *
 * Consequence worth stating: PPIN is one of the three IDs `DYNAMIC` may pair with
 * (`EFS_DYNAMIC_INFO_IDS`), so in this product DYNAMIC is reachable on CNTN and DRID only. That is a
 * narrowing of the vendor's rule, not a mistranscription of it.
 */
export const EFS_UNEDITABLE_INFO_IDS = ["PPIN"] as const;

/**
 * The prompt IDs this product may edit on THIS account, resolved at runtime.
 *
 * ── Why a constant could not stay ────────────────────────────────────────────────────────────────
 * `EFS_EDITABLE_INFO_IDS` is a list this codebase chose. `getPromptTypes` is the list the ACCOUNT
 * owns, and it is 40 IDs on production and 41 on QA — against a hardcoded 2. Everything between the
 * two was unreachable through this product while being perfectly configurable in the WEX portal.
 *
 * ── Why the intersection, rather than everything the account offers ──────────────────────────────
 * The accounts return codes the vendor's own documentation does not define: 15 on production and 16
 * on QA (`DSCD`, `DMLC`, `LSNB`, `CUNB`, `VHTP`, `PDLN`, `CLCD`, `VHNB`, `CVNM`, `LCCD`, `PLDS`,
 * `SPLN`, `SLDS`, `CVNB`, `CARR`, and `VEHN` on QA alone). The guide's Info IDs table (p168-169) has
 * exactly 26 entries and `EFS_INFO_LABELS` transcribes it one-for-one. Offering an operator a prompt
 * whose meaning is documented NOWHERE — not in the guide, not in the WSDL — is offering them a
 * switch with no label, on a surface where a wrong prompt stops a pump.
 *
 * So the resolved set is what the account offers AND the vendor documents AND we have not denied.
 * Measured 2026-08-16 against both real accounts, that is 24 — the same 24 on each, same casing.
 *
 * ── Casing is the account's, not ours ────────────────────────────────────────────────────────────
 * Returned IDs are matched case-INSENSITIVELY but emitted in the spelling `EFS_INFO_LABELS` holds,
 * because that is the spelling the guide's table uses and the one an operator will see next to the
 * label. This account has already produced a `status` in an undocumented casing (`docs/25` §3), so
 * the tolerance is earned rather than defensive.
 *
 * @param promptTypes what `getPromptTypes` returned for this org, or null/empty if never read.
 */
export const resolveEditableInfoIds = (
  promptTypes: readonly string[] | null | undefined,
): readonly string[] => {
  // Guards the `.map` below against null, and nothing more. An EMPTY array deliberately falls
  // through to the single fallback at the bottom rather than being special-cased here: an account
  // that offers nothing and an account whose every offer is unnameable are the same situation, and
  // two returns for one decision is a branch no test can tell apart. It was written both ways, and
  // deleting `|| promptTypes.length === 0` changed no assertion — so it is gone rather than pinned.
  if (!promptTypes) return [...EFS_EDITABLE_INFO_IDS];

  const denied = new Set<string>(EFS_UNEDITABLE_INFO_IDS);
  const offered = new Set(promptTypes.map((id) => id.trim().toUpperCase()).filter(Boolean));

  // Iterating the LABELS rather than the account's list makes the output order and spelling ours and
  // stable, so a vendor reordering its response cannot reorder a confirmation dialog.
  const resolved = Object.keys(EFS_INFO_LABELS)
    .filter((id) => offered.has(id) && !denied.has(id));

  // An account that offers nothing we can name is indistinguishable, for the operator, from an
  // account we never read — and the honest answer to both is the fallback, not an empty editor.
  return resolved.length > 0 ? resolved : [...EFS_EDITABLE_INFO_IDS];
};

export const infoLabel = (infoId: string): string => EFS_INFO_LABELS[infoId] ?? infoId;

// ─── Limit IDs (per-product caps) — p169–171 ───────────────────────────────────────────────────
// Moved WHOLE to `efsLimitCatalog.ts` for the file-size budget, and deliberately NOT re-exported
// from here. A hand-written re-export list is a second place to remember: it was written that way
// first, four helpers added to the catalog afterwards were missing from it, and `pnpm typecheck`
// did not notice — the web app typechecks against `packages/shared/dist` and RUNS against `src`, so
// the failure surfaced only as `limitOptionIndex is not a function` at test time. `index.ts` exports
// both modules; nothing needs a bridge here.


/**
 * Display form of a card. NEVER render a full PAN — the same rule the web app's card-assignment
 * composable has always applied, lifted here so the API, the web app and the driver app cannot drift.
 */
export const maskPan = (last4: string): string => `•••• ${last4}`;
