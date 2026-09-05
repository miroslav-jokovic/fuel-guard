/**
 * A fuel card as the inventory list holds it, and what narrows that list (FUEL-P2, D-FUI15).
 *
 * ── WHY THE SHAPE MOVED HERE ────────────────────────────────────────────────────────────────────
 * It was written twice — `toSummary`'s return in `modules/efs/routes/read.ts` and `EfsCardRow` in
 * `features/fuelCards/useEfsCards.ts` — the API's answer and the browser's transcription of it, kept
 * in step by hand. P2 adds a third reader (the export), and a third hand-kept copy of a
 * twenty-field shape is not a thing to add. `packages/shared` is the only home for a contract two
 * apps share (CLAUDE.md); this is that contract.
 *
 * ── AND WHY THE FILTERS DID ─────────────────────────────────────────────────────────────────────
 * The Cards page filters CLIENT-side, over the whole list, because it loads the whole list. Seven of
 * its facets — driver, unit, policy, exception, vehicle link, sync health — exist only as predicates
 * inside a `computed` in the page, so an export that honoured them would have had to state them a
 * second time in a second language. That is the drift `fuelSpendReport.ts` carries a scar about, and
 * the export would be the copy that goes stale, because nobody looks at an export when they change a
 * filter.
 *
 * So `matchesCardFilters` is the one definition, and the export applies it to the same summary rows
 * the page does. No SQL twin: the export reads the cards the way the list route reads them (status
 * and free text server-side) and then applies THIS function, so there is exactly one implementation
 * of what a facet means.
 */

/** One card, as the list endpoint sends it. Optional fields are what an older API may omit. */
export interface EfsCardSummary {
  id: string;
  last4: string;
  maskedRef: string;
  status: string;
  policyNumber: number | null;
  driverIdPrompt: string | null;
  unitPrompt: string | null;
  driverName: string | null;
  overrideUses: number | null;
  /**
   * Both halves of an active exception, not just the count: "2 uses left" and "2 uses left at ONE
   * truck stop" are different facts.
   */
  overrideAllLocations: boolean | null;
  locationOverrideId: string | null;
  lastUsedDate: string | null;
  fuelCardId: string | null;
  /** Step 7.7 linking evidence. Absent on an older API, which is why these are optional. */
  linkStatus?: "linked" | "ambiguous" | "unconfirmed" | "no_candidate" | "unidentifiable" | null;
  linkMethod?: string | null;
  linkCandidates?: number;
  syncedAt: string;
  /**
   * The DETAIL pass's clock (Step 7.8). `syncedAt` moves every sweep because the roster pass touches
   * every row; this moves only when the card's document was re-read, and it is what the override
   * state hangs off. Null = the roster has seen this card and nothing has ever read it.
   */
  detailSyncedAt?: string | null;
  /** Set when EFS stopped listing the card (audit P2). The row is kept; the history is the point. */
  absentSince?: string | null;
  syncError: string | null;
  /** Which mirror pass failed (Step 7.5 / migration 0198). `roster` and `detail` fail differently. */
  syncErrorSource?: "roster" | "detail" | null;
  syncErrorAt?: string | null;
}

/**
 * The Cards list's own facets — everything the page narrows on BEYOND status and free text, which the
 * list endpoint already applies in the database.
 *
 * Every field is the raw string the URL carries, because that is what both callers hold: the page
 * reads them off `useQueryState`, and the export reads them off its query string.
 */
export interface EfsCardFilters {
  /** Exact `driverName`. */
  driver?: string;
  /** Exact `unitPrompt`. */
  unit?: string;
  /** `policyNumber`, as text — the menu is built from the values on screen. */
  policy?: string;
  /** `active` = an exception with uses left; `none` = no exception. */
  override?: string;
  /** `linked` = the card resolves to a fleet fuel card; `unlinked` = it does not. */
  linked?: string;
  /** `errors` = the mirror's last sweep failed for this card; `ok` = it did not. */
  health?: string;
}

/**
 * Does this card belong in the filtered list?
 *
 * An absent or empty facet does not narrow — the same reading every filter in this product gives an
 * absent parameter, and the reason each check is `if (f.x && …)` rather than a comparison against a
 * default.
 */
export function matchesCardFilters(row: EfsCardSummary, f: EfsCardFilters): boolean {
  if (f.driver && row.driverName !== f.driver) return false;
  if (f.unit && row.unitPrompt !== f.unit) return false;
  if (f.policy && String(row.policyNumber ?? "") !== f.policy) return false;
  // An active exception is the thing an auditor scans this page for — "who can currently buy fuel
  // outside their limits" is one click, not a sort down a 199-row list.
  if (f.override === "active" && (row.overrideUses ?? 0) <= 0) return false;
  if (f.override === "none" && (row.overrideUses ?? 0) > 0) return false;
  if (f.linked === "linked" && !row.fuelCardId) return false;
  if (f.linked === "unlinked" && row.fuelCardId) return false;
  // 140 of this fleet's 199 cards carried a sync error at one point and nothing on screen said so.
  if (f.health === "errors" && !row.syncError) return false;
  if (f.health === "ok" && row.syncError) return false;
  return true;
}
