import {
  EFS_CARD_STATUS_LABELS,
  type EfsCardStatus,
  canonicalEfsStatus,
} from "@fuelguard/shared";

/**
 * Pure presentation logic for the fuel-card pages.
 *
 * Extracted from the `.vue` files so the rules that are easy to get wrong — and expensive when wrong —
 * are unit-testable without mounting anything. Two of them matter more than the rest:
 *
 *   • A limit VALUE means gallons for fuel and dollars otherwise (guide p36). Rendering a 100-gallon
 *     ULSD cap as "$100" tells a fleet manager their driver can buy a third of a tank when he can in
 *     fact fill twice.
 *   • "Card level always trumps policy" (p37), and getCardv2 does not return the policy half at all.
 *     A policy rule that is NOT in force must still be visible, and visibly not in force — otherwise
 *     the operator sees it in the WEX portal, doesn't see it here, and stops trusting the page.
 */

// ─── Status ────────────────────────────────────────────────────────────────────────────────────

/**
 * `Hold` is warning rather than danger on purpose: it is the reversible, intended state after
 * somebody locks a card, not a fault. `Fraud` and `Deleted` are the ones that should stop a reader.
 */
export function cardStatusTone(status: string | null): string {
  // Through canonicalEfsStatus, because a production account reports ACTIVE/INACTIVE/HOLD while the
  // guide documents Active/Inactive/Hold. Switching on the raw text gave every card a neutral badge.
  switch (canonicalEfsStatus(status)) {
    case "Active": return "success";
    case "Hold": return "warning";
    case "Inactive": return "neutral";
    case "Fraud": return "danger";
    case "Deleted": return "danger";
    default: return "neutral";
  }
}

/** A status EFS reports that we have no label for is shown verbatim, never blanked. */
export const cardStatusLabel = (status: string | null): string =>
  status ? (EFS_CARD_STATUS_LABELS[canonicalEfsStatus(status) as EfsCardStatus] ?? status) : "Unknown";

// ─── Freshness ─────────────────────────────────────────────────────────────────────────────────

export interface Freshness {
  text: string;
  /** True past the staleness threshold — the page shows this in a caution tone with a next action. */
  stale: boolean;
}

/**
 * When the mirror stops being "recently checked".
 *
 * A DEFAULT, not the rule. The server knows the sweep cadence (`EFS_CARD_SYNC_HOURS`, 24 by design)
 * and sends it as `staleAfterMinutes`; this is only what to assume before that arrives.
 */
const DEFAULT_STALE_AFTER_MINUTES = 26 * 60;

/**
 * How long ago, in words. The ONE age formatter on this surface.
 *
 * Extracted so `freshness()` and `overrideState()` cannot drift apart: the card page would otherwise
 * say "Checked 9 hours ago" in one line and "read 9 hrs ago" in the next, from two implementations
 * that round differently. Returns null for a timestamp that is missing or unparseable — the caller
 * decides what "we have no clock for this" reads as, because it is a different sentence in each.
 */
export function relativeAge(at: string | null | undefined, now: Date = new Date()): string | null {
  if (!at) return null;
  const ms = now.getTime() - new Date(at).getTime();
  if (Number.isNaN(ms)) return null;
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Whole minutes between `at` and `now`, or null when there is no usable timestamp. */
const ageMinutes = (at: string | null | undefined, now: Date): number | null => {
  if (!at) return null;
  const ms = now.getTime() - new Date(at).getTime();
  return Number.isNaN(ms) ? null : Math.max(0, Math.floor(ms / 60_000));
};

/**
 * How old the mirror row is, in words.
 *
 * ── Why the threshold comes from the server ─────────────────────────────────────────────────────
 * The mirror is swept DAILY on purpose: card configuration changes when a human changes it, and
 * polling a shared, rate-paced service account for data that has not moved is exactly what the guide
 * warns can get an account suspended (p11).
 *
 * The first version of this called anything over SIXTY MINUTES stale — so for roughly twenty-three
 * hours out of every twenty-four, a correctly-working page shouted "Last checked over 3 hours ago.
 * Refresh to see current settings." in caution type. That is not a staleness warning, it is the
 * normal state of the system rendered as an alarm, and the cost is that the one time it matters
 * nobody reads it.
 *
 * So: "stale" now means OLDER THAN A SWEEP — the API sends its own cadence plus a grace margin.
 * Inside that window the line is a plain fact with no call to action; past it, something really has
 * not run and the page says so.
 */
export function freshness(
  syncedAt: string | null,
  now: Date = new Date(),
  staleAfterMinutes: number = DEFAULT_STALE_AFTER_MINUTES,
): Freshness {
  const minutes = ageMinutes(syncedAt, now);
  const age = relativeAge(syncedAt, now);
  if (minutes === null || age === null) return { text: "Never checked.", stale: true };
  const stale = minutes >= staleAfterMinutes;
  // Past the cadence the sentence earns a next action. Inside it, it is just how old the row is.
  const suffix = stale ? " Refresh to see current settings." : "";
  // `just now` is never stale by construction; keeping the branch explicit avoids a "Checked just
  // now. Refresh to see current settings." from a threshold somebody sets to zero.
  return minutes < 1 ? { text: "Checked just now.", stale: false } : { text: `Checked ${age}.${suffix}`, stale };
}

/**
 * Order two card rows by one column.
 *
 * PURE and here rather than in the page because of one rule that is easy to get wrong and impossible
 * to notice: BLANKS SORT LAST IN BOTH DIRECTIONS. A card with no driver is not "the smallest driver";
 * it is a card with no driver. Sorting them to the top of an ascending list buries every card that
 * HAS a driver under a wall of dashes, which is the opposite of what somebody clicking "Driver" wants.
 *
 * Numbers compare numerically, text uses a numeric-aware collator so unit 9 precedes unit 10.
 */
export function compareCardValues(
  a: string | number | null,
  b: string | number | null,
  dir: "asc" | "desc",
): number {
  const x = a ?? "";
  const y = b ?? "";
  if (x === "" && y !== "") return 1;
  if (y === "" && x !== "") return -1;
  if (x === "" && y === "") return 0;
  const raw = typeof x === "number" && typeof y === "number"
    ? x - y
    : String(x).localeCompare(String(y), undefined, { numeric: true });
  return raw * (dir === "asc" ? 1 : -1);
}

/**
 * Whether a card is attached to anybody. 0 sorts first, 1 sorts last.
 *
 * "Unassigned" means EFS reports no driver, no driver id and no unit for it — nothing that says who
 * or what uses this card. Those are spare stock: real, worth being able to find, and not what an
 * operator opens this page to look at. Interleaved by card number they push the working fleet down
 * the list, so the default order sinks them and everything else keeps its natural order above.
 *
 * Deliberately NOT based on the `fuel_cards` link. That link is FuelGuard's own attribution guess and
 * is null for 17 of this account's cards purely because two physical cards share a last four — which
 * says nothing about whether a driver is using them.
 */
export function cardAssignmentRank(card: {
  driverName: string | null;
  driverIdPrompt: string | null;
  unitPrompt: string | null;
}): 0 | 1 {
  const has = (v: string | null): boolean => (v ?? "").trim() !== "";
  return has(card.driverName) || has(card.driverIdPrompt) || has(card.unitPrompt) ? 0 : 1;
}

// ─── Account-wide overrides (B3) ───────────────────────────────────────────────────────────────

/**
 * Where an active exception applies, in words.
 *
 * The single-location id is checked FIRST, deliberately. The two scope fields are mutually exclusive
 * by recipe (p194), but a card configured in the WEX portal can carry both at once — and this
 * codebase has already concluded (see overrideGrantEdits) that when they conflict, the location id
 * is what the pump actually honours: the driver is declined everywhere but that one truck stop.
 * Claiming "any location" on such a card would repeat the exact lie that function exists to prevent.
 */
export function overrideScopeLabel(allLocations: boolean | null, locationId: string | null): string {
  if (locationId) return `Location #${locationId}`;
  if (allLocations) return "Any location";
  // Uses remain but neither scope field is armed — a state EFS can report and we will not guess at.
  return "Scope not reported";
}

/**
 * An override state, WITH the age of the read it came from (Step 7.8).
 *
 * ── The incident this shape exists for (`docs/22` H4) ───────────────────────────────────────────
 * Production card ••••7550 / unit 651 showed *"Override: 1 use left"* for NINE HOURS after EFS had
 * retired it. The exception was consumed 38 minutes after the sync that recorded it, and nothing
 * re-read the card until somebody refreshed by hand. The badge was not wrong when it was written; it
 * was wrong when it was read, and nothing on the screen said which of those it was.
 *
 * ── Why this field and not `syncedAt` ───────────────────────────────────────────────────────────
 * The override state is split across two clocks, and only one of them is honest about it:
 *   • `override_uses` is written by BOTH mirror passes, so it tracks `synced_at`.
 *   • `override_all_locations` and `location_override_id` — the SCOPE, i.e. whether this is a free
 *     tank anywhere or one at a single truck stop — have no writer but the detail pass.
 * So the statement "N uses left, at X" is only ever as fresh as `detailSyncedAt`, and that clock is
 * never newer than `syncedAt`, which makes reading it the conservative direction. Step 7.5's
 * `budget > fleetSize` invariant is what keeps the two clocks within a sweep of each other; without
 * it this would report a count as days old when it was hours old.
 *
 * ── Why a stale count must not be asserted at all ───────────────────────────────────────────────
 * A stale `status` is tolerable — the card page is not the authority on whether a card is locked,
 * and locking is idempotent. A stale override count is not: it is the number that says whether a
 * driver can take another free tank, it decrements without us, and it is the one field on this card
 * whose staleness has a dollar value. Past a full sync cycle the honest answer is "we do not know".
 *
 * ── This carries no count of its own, deliberately ──────────────────────────────────────────────
 * `known` is a verdict ABOUT the count, not a second copy of it. Returning a nullable `uses` beside
 * the caller's own `overrideUses` would leave two numbers for the same fact and a rule about when
 * they may disagree — and every surface would eventually pick the wrong one. One flag, one number,
 * one place it lives.
 */
export interface OverrideFreshness {
  /** False when the count must not be asserted: never read, or older than a sync cycle. */
  known: boolean;
  /** "read 9 hours ago" / "never read from EFS". Always present, always shown beside the state. */
  ageText: string;
  stale: boolean;
  neverRead: boolean;
}

export function overrideFreshness(
  card: { detailSyncedAt?: string | null },
  now: Date = new Date(),
  staleAfterMinutes: number = DEFAULT_STALE_AFTER_MINUTES,
): OverrideFreshness {
  const minutes = ageMinutes(card.detailSyncedAt, now);
  const age = relativeAge(card.detailSyncedAt, now);
  if (minutes === null || age === null) {
    // The roster has seen this card; nothing has read it. Distinct from stale, and it is also the
    // state Step 7.5's `card_never_read` refuses a write against.
    return { known: false, ageText: "never read from EFS", stale: true, neverRead: true };
  }
  const stale = minutes >= staleAfterMinutes;
  return { known: !stale, ageText: `read ${age}`, stale, neverRead: false };
}

export interface ActiveOverrideRow {
  id: string;
  maskedRef: string;
  driverName: string | null;
  unitPrompt: string | null;
  status: string;
  uses: number;
  scopeLabel: string;
  /** Step 7.8 — how old the read behind this row is. See OverrideFreshness. */
  freshness: OverrideFreshness;
}

/**
 * Every card on the account that currently carries a fuel exception — the account-wide answer to
 * "who can buy outside their limits right now" (audit B3).
 *
 * `overrideUses > 0` is the gate because that is the vendor's own semantics: the count is decremented
 * per use and 0 means no exception left (p194). A card with a leftover scope field but zero uses is
 * configuration residue, not an active exception, and listing it here would teach operators to
 * distrust the panel. Sorted by card order — the same order as the inventory below it, so a reader
 * can find the row again.
 */
export function activeOverrides(
  rows: readonly {
    id: string; maskedRef: string; driverName: string | null; unitPrompt: string | null;
    status: string; overrideUses: number | null; overrideAllLocations: boolean | null;
    locationOverrideId: string | null; last4: string; detailSyncedAt?: string | null;
  }[],
  now: Date = new Date(),
  staleAfterMinutes: number = DEFAULT_STALE_AFTER_MINUTES,
): ActiveOverrideRow[] {
  return rows
    .filter((r) => (r.overrideUses ?? 0) > 0)
    .sort((a, b) => compareCardValues(a.last4, b.last4, "asc"))
    .map((r) => ({
      id: r.id,
      maskedRef: r.maskedRef,
      driverName: r.driverName,
      unitPrompt: r.unitPrompt,
      status: r.status,
      /** The LAST KNOWN count. Only assert it where `freshness.known` — see OverrideFreshness. */
      uses: r.overrideUses ?? 0,
      scopeLabel: overrideScopeLabel(r.overrideAllLocations, r.locationOverrideId),
      // A STALE row is annotated, never dropped (Step 7.8). This panel answers "who can currently buy
      // outside their limits", and "we last read this two days ago" is not the same answer as "no".
      // Filtering stale rows out would make the panel quietest exactly when the mirror is worst.
      freshness: overrideFreshness(r, now, staleAfterMinutes),
    }));
}

/**
 * The effective-configuration renderers live in `cardEffectiveRows.ts` (split at the 500-line budget
 * by Step 7.4) and are re-exported here so every existing import keeps resolving.
 */
export {
  autoRollClause,
  limitRows,
  locationRows,
  payrollRows,
  promptRows,
  sourceSentence,
  timeRows,
  type EffectiveDisplayRow,
  type Merged,
  type PayrollFlags,
  type RawInfo,
  type RawLimit,
  type RawTime,
} from "./cardEffectiveRows.js";

export { availability, type AvailabilityNotice } from "./cardAvailability.js";

// ─── Phase B: what an outcome MEANS ────────────────────────────────────────────────────────────

export interface OutcomeNotice {
  kind: "success" | "warning" | "error";
  title: string;
  message?: string;
}

/**
 * Turn a recorded outcome into what the operator is told.
 *
 * The API answers 200 for every RECORDED outcome, including the ones that did not work — the request
 * succeeded, we asked EFS and wrote down the answer. So "did the card change?" is read from `status`,
 * never from the HTTP code, and three of the four answers are not "it worked":
 *
 *   succeeded      → say so plainly.
 *   drift_detected → it worked AND something else moved. Not an error; a thing to go and look at.
 *   failed         → EFS refused. Quote the vendor's own words; they carry the reference WEX asks for.
 *   sent           → WE DO NOT KNOW. The one outcome that must never be dressed up as either.
 */
export function outcomeNotice(
  outcome: { status: string; driftFields?: string[]; faultMessage?: string | null; idempotent?: boolean },
  doneLabel: string,
): OutcomeNotice {
  // A replay of an already-settled key (audit P1-2): the API did nothing new and returned the prior
  // outcome. Say so, rather than claim a fresh success or failure — the operator clicked twice and
  // deserves to know the second click matched the first.
  if (outcome.idempotent) {
    return {
      kind: outcome.status === "succeeded" ? "success" : "warning",
      title: "Already done",
      message: "This matches an earlier attempt — nothing new was sent.",
    };
  }
  switch (outcome.status) {
    case "succeeded":
      return { kind: "success", title: doneLabel };
    case "drift_detected":
      return {
        kind: "warning",
        title: `${doneLabel} — with other changes`,
        message:
          "Something else on this card changed at the same time" +
          ((outcome.driftFields?.length ?? 0) > 0
            ? ` (${outcome.driftFields!.map((f) => f.replace(/^\//, "")).join(", ")}).`
            : ".") +
          " EFS is the source of truth and the card page now shows what it reports.",
      };
    case "sent":
      return {
        kind: "warning",
        title: "Sent, but not confirmed",
        message:
          "The change was sent to EFS and we could not confirm what happened. Check the card in the WEX portal before trying again — retrying could apply it twice.",
      };
    case "failed":
      return {
        kind: "error",
        title: "EFS refused the change",
        message: outcome.faultMessage ?? "The card was not changed.",
      };
    default:
      // An UNRECOGNISED status. Never assert "not changed" — that is a claim the client cannot make
      // about a status it does not understand. Point at the history, which has the truth.
      return {
        kind: "warning",
        title: "Unexpected result",
        message: "The card may or may not have changed — check this card's change history.",
      };
  }
}
