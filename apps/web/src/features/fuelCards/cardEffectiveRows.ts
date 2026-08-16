import {
  type EffectiveOrigin,
  formatLimit,
  infoLabel,
  limitLabel,
} from "@fuelguard/shared";

/**
 * One row of "what the pump will actually enforce", for every kind of rule a card carries.
 *
 * Split out of `cardControlModel.ts` when Step 7.4 took that file past the 500-line budget — split,
 * not waived, for the reason `efsCardLinking.ts` gives: a waiver pins the file at its current length
 * and makes the next addition somebody else's problem. The seam is real. Everything here turns a
 * PARSED vendor record into a row a table can draw; what stays behind is about the card as a whole —
 * its status, its freshness, its ordering, and what an outcome means.
 *
 * `cardControlModel.ts` re-exports all of it, so every existing import still resolves.
 *
 * ── The two rules that drive every renderer here ────────────────────────────────────────────────
 *   • A limit VALUE means gallons for fuel and dollars otherwise (guide p36). Rendering a 100-gallon
 *     ULSD cap as "$100" tells a fleet manager their driver can buy a third of a tank when he can in
 *     fact fill twice.
 *   • "Card level always trumps policy" (p37), and getCardv2 does not return the policy half at all.
 *     A policy rule that is NOT in force must still be visible, and visibly not in force.
 */

export interface EffectiveDisplayRow {
  key: string;
  label: string;
  detail: string;
  origin: EffectiveOrigin;
  originLabel: string;
  originTone: string;
  /** False when the row is shown for context but the pump will not apply it. */
  enforced: boolean;
}

const ORIGIN_LABEL: Record<EffectiveOrigin, string> = {
  card: "Card",
  policy: "Policy",
  "policy-overridden": "Overridden by card",
  "policy-ignored": "Not applied",
};

const ORIGIN_TONE: Record<EffectiveOrigin, string> = {
  card: "brand",
  policy: "info",
  "policy-overridden": "neutral",
  "policy-ignored": "neutral",
};

const describeOrigin = (origin: EffectiveOrigin) => ({
  origin,
  originLabel: ORIGIN_LABEL[origin],
  originTone: ORIGIN_TONE[origin],
  enforced: origin === "card" || origin === "policy",
});

export interface RawInfo { infoId: string; validationType: string | null; matchValue: string | null; reportValue: string | null }
export interface RawLimit {
  limitId: string;
  limit: number;
  hours: number | null;
  minHours: number | null;
  /**
   * Step 7.4. The API has always sent these — `getCardv2` v2 returns them and the merge passes the
   * raw record through — and this type omitted them, so nothing could render them. The reason v2 is
   * used at all is that v1 lacks them (see `getCardV2`'s docblock), which makes dropping them here
   * the more embarrassing half of the same story.
   */
  autoRollMap?: number | null;
  autoRollMax?: number | null;
}
export interface RawTime { day: number; beginTime: string | null; endTime: string | null }
export interface Merged<T> { value: T; origin: EffectiveOrigin }

export function promptRows(rows: readonly Merged<RawInfo>[]): EffectiveDisplayRow[] {
  return rows.map((row, index) => ({
    key: `${row.value.infoId}-${row.origin}-${index}`,
    label: infoLabel(row.value.infoId),
    // EXACT_MATCH is the one that makes the pump VALIDATE the entry rather than just record it —
    // the difference between a prompt that stops the wrong driver and one that only reports him.
    detail: row.value.validationType === "EXACT_MATCH"
      ? `Must match ${row.value.matchValue || "—"}`
      : row.value.validationType === "REPORT_ONLY"
        ? `Recorded only${row.value.reportValue ? `: ${row.value.reportValue}` : ""}`
        : (row.value.validationType ?? "—"),
    ...describeOrigin(row.origin),
  }));
}

/**
 * The auto-roll clause (Step 7.4), and the one number on this page that means its opposite.
 *
 * **`autoRollMax = 0` means NO DAILY MAXIMUM — not "unlimited", and not "zero allowed".** Rendering
 * it as a number is the trap: "Daily max 0" reads as a card that can buy nothing, which is the
 * safest-sounding wrong answer and the one an operator would act on by raising a limit that was
 * never set. Guide p138.
 *
 * `autoRollMap` is the per-fill amount the limit rolls forward by; a null on either is EFS not
 * reporting the field, which is different again from a zero and is left unsaid rather than guessed.
 */
export function autoRollClause(limit: RawLimit): string {
  const parts: string[] = [];
  if (limit.autoRollMap != null) parts.push(`auto-roll ${limit.autoRollMap}`);
  if (limit.autoRollMax === 0) parts.push("no daily maximum");
  else if (limit.autoRollMax != null) parts.push(`daily max ${limit.autoRollMax}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

export function limitRows(rows: readonly Merged<RawLimit>[]): EffectiveDisplayRow[] {
  return rows.map((row, index) => {
    const window = row.value.hours ? ` per ${row.value.hours}h` : "";
    const gap = row.value.minHours ? `, ${row.value.minHours}h between uses` : "";
    return {
      key: `${row.value.limitId}-${row.origin}-${index}`,
      label: limitLabel(row.value.limitId),
      // formatLimit carries the unit the limit ID implies. See the note at the top of this file.
      detail: `${formatLimit(row.value.limitId, row.value.limit)}${window}${gap}${autoRollClause(row.value)}`,
      ...describeOrigin(row.origin),
    };
  });
}

/**
 * Where this card may and may not fuel (Step 7.4).
 *
 * Both halves have been parsed since Phase 1 and reached no surface. They are NOT symmetrical and
 * the labels have to say so: `locationGroups` is an allowlist of groups, `locations` is a
 * **blocklist** — "a list of locations that this card is BLOCKED from using" (p36). A single
 * "Locations" table listing both would be read as one meaning and be wrong for half its rows.
 */
/**
 * How many blocked locations to draw before summarising the rest.
 *
 * ⚠ MEASURED, not guessed. The 2026-08-16 production inventory found **7,948 blocked locations on
 * policy 1** (`docs/22` H14). The first version of this function rendered one row per entry with no
 * cap, so a card carrying that blocklist would have put eight thousand rows into a `DataTable` on
 * the card page. A blocklist is a set an operator checks membership of, never a list they read, so
 * the rows past this point cost a hung browser and buy nothing.
 */
const MAX_BLOCKED_ROWS = 25;

export function locationRows(
  groups: readonly string[],
  blocked: readonly string[],
): EffectiveDisplayRow[] {
  const shown = blocked.slice(0, MAX_BLOCKED_ROWS);
  const hidden = blocked.length - shown.length;
  return [
    ...groups.map((id, i) => ({
      key: `grp-${id}-${i}`,
      label: `Location group ${id}`,
      detail: "This card may fuel at locations in this group.",
      ...describeOrigin("card" as EffectiveOrigin),
    })),
    ...shown.map((id, i) => ({
      key: `blk-${id}-${i}`,
      label: `Location #${id}`,
      detail: "BLOCKED — this card is refused here.",
      ...describeOrigin("card" as EffectiveOrigin),
    })),
    // Never a silent truncation: the count is the fact worth having, and a table that quietly showed
    // 25 of 7,948 would read as "this card is blocked from 25 places".
    ...(hidden > 0
      ? [{
          key: "blk-more",
          label: `+ ${hidden.toLocaleString()} more blocked locations`,
          detail: `${blocked.length.toLocaleString()} in total. Too many to list — check a specific location in the WEX portal.`,
          ...describeOrigin("card" as EffectiveOrigin),
        }]
      : []),
  ];
}

/** The five ways to take money off a fuel card that are not fuel (Step 7.3 parsed them; 7.4 shows them). */
export interface PayrollFlags {
  status: string | null; use: string | null; atm: string | null;
  check: string | null; ach: string | null; wire: string | null; debit: string | null;
}

/**
 * Payroll capability rows.
 *
 * Only what EFS actually reported: a null is "EFS said nothing about this", which is not the same as
 * "not allowed" and must not render as a denial. That distinction is the whole reason these are
 * strings rather than booleans — `wsCardSchema` types them the way the WSDL does.
 */
export function payrollRows(flags: PayrollFlags): EffectiveDisplayRow[] {
  const LABELS: [keyof PayrollFlags, string][] = [
    ["status", "Payroll status"], ["use", "Payroll use"], ["atm", "ATM cash"],
    ["check", "Check"], ["ach", "ACH transfer"], ["wire", "Wire transfer"], ["debit", "Debit"],
  ];
  return LABELS
    .filter(([key]) => flags[key] != null && String(flags[key]).trim() !== "")
    .map(([key, label], index) => ({
      key: `payroll-${key}-${index}`,
      label,
      detail: String(flags[key]),
      ...describeOrigin("card" as EffectiveOrigin),
    }));
}

const DAY_NAMES = ["", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Only the time-of-day part of a restriction applies; the date reads 1970-01-01 (p37). */
const clockTime = (value: string | null): string => {
  if (!value) return "—";
  const match = /T(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : value;
};

export function timeRows(rows: readonly Merged<RawTime>[]): EffectiveDisplayRow[] {
  return rows.map((row, index) => ({
    key: `${row.value.day}-${row.origin}-${index}`,
    // 1 = Sunday, not 0 = Sunday (p37). Off by one here mislabels every restriction on the card.
    label: DAY_NAMES[row.value.day] ?? `Day ${row.value.day}`,
    detail: `Blocked ${clockTime(row.value.beginTime)} to ${clockTime(row.value.endTime)}`,
    ...describeOrigin(row.origin),
  }));
}

/** One plain sentence above each table, so the source mode is never something to infer from badges. */
export function sourceSentence(noun: string, source: string | null, policyNumber: number | null): string {
  const policy = policyNumber ? `policy ${policyNumber}` : "the policy";
  switch (source) {
    case "CARD": return `${noun} come from the card only.`;
    case "POLICY": return `${noun} come from ${policy}.`;
    case "BOTH": return `${noun} come from both the card and ${policy}. Card settings win where they overlap.`;
    default: return `${noun} source is not reported by EFS.`;
  }
}

