import { CMV_WINDOW_YEARS, EMPLOYMENT_WINDOW_YEARS, yearsBefore } from "../employmentCoverage.js";
import type { PspCrashRecord, PspInspectionRecord } from "./parse.js";

/**
 * Cross-matching a PSP record against the employment the applicant declared (PSP-PLAN P13 / §5b).
 *
 * ── THE RULE THAT SHAPES EVERYTHING (D-PSP5) ────────────────────────────────────────────────────
 * **This corroborates and it discovers. It can never refute.** A driver can work two years for a
 * carrier and never once be inspected — inspections are not attendance records. So for an employer
 * the applicant DID list, PSP either backs it up or says nothing at all, and "says nothing" is not a
 * weaker form of doubt. Building this as a lie-detector would manufacture accusations against
 * precisely the drivers who drive cleanly.
 *
 * The valuable direction is the inverse: an inspection under a DOT number that appears nowhere on the
 * application is a §391.21(b)(10) gap AND a §391.23(a)(2) inquiry we did not know we owed.
 *
 * ── WHAT PSP CAN AND CANNOT SEE ─────────────────────────────────────────────────────────────────
 * Inspections go back 3 years, crashes 5. So PSP corroborates all of §391.21(b)(10) and only the
 * early part of (b)(11), and says NOTHING about years 6-10. A period outside that window is reported
 * as `outside_psp_window`, never as `no_psp_activity` — the two look alike and mean opposite things.
 */

export const PSP_INSPECTION_YEARS = 3;
export const PSP_CRASH_YEARS = 5;

export interface DeclaredEmployment {
  id: string;
  employerName: string;
  usdotNumber: string | null;
  startedOn: string;
  /** null = still there. */
  endedOn: string | null;
}

/** §391.21(b)(7) — an accident the applicant declared, for the crash cross-check. */
export interface DeclaredAccident {
  occurredOn: string;
}

export type EmployerMatch =
  /** PSP activity under this DOT number, inside the declared period. */
  | "corroborated"
  /** PSP could have seen activity and saw none. Says nothing about the claim. */
  | "no_psp_activity"
  /** The period predates what PSP holds. Not evidence of anything, in either direction. */
  | "outside_psp_window";

export interface EmployerCorroboration {
  employmentId: string;
  employerName: string;
  usdotNumber: string | null;
  match: EmployerMatch;
  inspections: number;
  crashes: number;
  /**
   * Carrier names in the PSP record that resemble this employer but carry a different (or no) DOT
   * number. A HINT for a human, never a link: "SWIFT TRANSPORTATION CO" against "Swift
   * Transportation" is obvious to a person and a coin-flip to a string comparison, and a wrong link
   * writes a false employment fact into a §391.51 file (D-PSP6).
   */
  nameOnlyCandidates: string[];
}

export interface UnlistedCarrier {
  usdotNumber: string;
  carrierName: string | null;
  firstSeen: string;
  lastSeen: string;
  inspections: number;
  crashes: number;
  /** Which §391.21 list the applicant owed this employer to. */
  owedTo: "b10" | "b11" | "outside";
}

export interface UndeclaredCrash {
  reportDate: string;
  carrierName: string | null;
  /** §10.5 — FMCSA deemed it non-preventable. It still had to be DECLARED; it must not be counted. */
  notPreventable: boolean;
}

export interface PspCrossMatch {
  employers: EmployerCorroboration[];
  /** Carriers PSP saw that the application never mentioned, newest activity first. */
  unlisted: UnlistedCarrier[];
  /** §391.21(b)(7) asks for 3 years of accidents; PSP holds 5. Only the overlap is a discrepancy. */
  undeclaredCrashes: UndeclaredCrash[];
  inspectionWindowStart: string;
  crashWindowStart: string;
}

const normaliseName = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[.,'-]/g, "")
    .replace(/\b(INC|LLC|LTD|CO|CORP|COMPANY|TRUCKING|TRANSPORT|TRANSPORTATION|EXPRESS|LOGISTICS)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

const within = (date: string, from: string, to: string): boolean => date >= from && date <= to;

interface Activity {
  usdot: string | null;
  name: string | null;
  date: string;
  kind: "inspection" | "crash";
}

/**
 * `pulledOn` dates PSP's own windows; `asOf` dates the application's. They are usually the same day
 * and are separate arguments because they answer different questions — one is "what could PSP have
 * known", the other "what was the applicant required to list".
 */
export function crossMatchEmployment(input: {
  declared: readonly DeclaredEmployment[];
  declaredAccidents: readonly DeclaredAccident[];
  inspections: readonly PspInspectionRecord[];
  crashes: readonly PspCrashRecord[];
  /** OUR DOT number. Inspections run for us are not an unlisted employer (D-PSP6). */
  ownDotNumber: string | null;
  asOf: string;
  pulledOn: string;
}): PspCrossMatch {
  const inspectionWindowStart = yearsBefore(input.pulledOn, PSP_INSPECTION_YEARS);
  const crashWindowStart = yearsBefore(input.pulledOn, PSP_CRASH_YEARS);
  const b10Start = yearsBefore(input.asOf, EMPLOYMENT_WINDOW_YEARS);
  const b11Start = yearsBefore(input.asOf, CMV_WINDOW_YEARS);

  const activity: Activity[] = [
    ...input.inspections
      .filter((i) => i.inspectionDate)
      .map((i) => ({ usdot: i.usdotNumber, name: i.carrierName, date: i.inspectionDate!, kind: "inspection" as const })),
    ...input.crashes
      .filter((c) => c.reportDate)
      .map((c) => ({ usdot: c.usdotNumber, name: c.carrierName, date: c.reportDate!, kind: "crash" as const })),
  ];

  const declaredDots = new Set(
    input.declared.map((d) => d.usdotNumber).filter((n): n is string => Boolean(n)),
  );

  // ── per declared employer ─────────────────────────────────────────────────────────────────────
  const employers = input.declared.map((d): EmployerCorroboration => {
    const to = d.endedOn ?? input.asOf;
    const mine = d.usdotNumber
      ? activity.filter((a) => a.usdot === d.usdotNumber && within(a.date, d.startedOn, to))
      : [];
    const inspections = mine.filter((a) => a.kind === "inspection").length;
    const crashes = mine.filter((a) => a.kind === "crash").length;

    // Could PSP have seen anything at all in this period? Crashes reach further back than
    // inspections, so the outer window is the crash one.
    const couldHaveSeen = to >= crashWindowStart;

    const nameOnlyCandidates = d.usdotNumber
      ? []
      : [
          ...new Set(
            activity
              .filter((a) => a.name && normaliseName(a.name) === normaliseName(d.employerName))
              .map((a) => a.name!)
          ),
        ];

    return {
      employmentId: d.id,
      employerName: d.employerName,
      usdotNumber: d.usdotNumber,
      match:
        inspections + crashes > 0 ? "corroborated"
        : couldHaveSeen ? "no_psp_activity"
        : "outside_psp_window",
      inspections,
      crashes,
      nameOnlyCandidates,
    };
  });

  // ── carriers the application never mentioned ──────────────────────────────────────────────────
  const byDot = new Map<string, Activity[]>();
  for (const a of activity) {
    if (!a.usdot) continue;
    // Ours is not an unlisted employer, and a feature whose first finding is "this driver appears to
    // have worked for you" is a feature nobody trusts again.
    if (input.ownDotNumber && a.usdot === input.ownDotNumber) continue;
    if (declaredDots.has(a.usdot)) continue;
    const list = byDot.get(a.usdot);
    if (list) list.push(a);
    else byDot.set(a.usdot, [a]);
  }

  const unlisted = [...byDot.entries()]
    .map(([usdot, acts]): UnlistedCarrier => {
      const dates = acts.map((a) => a.date).sort();
      const firstSeen = dates[0]!;
      const lastSeen = dates[dates.length - 1]!;
      return {
        usdotNumber: usdot,
        carrierName: acts.find((a) => a.name)?.name ?? null,
        firstSeen,
        lastSeen,
        inspections: acts.filter((a) => a.kind === "inspection").length,
        crashes: acts.filter((a) => a.kind === "crash").length,
        // Which list they were owed to. Activity inside (b)(11)'s window is still a finding — it is
        // direct evidence of CMV operation that (b)(11) required them to list — but its ABSENCE
        // there never is, which is why only presence is reported.
        owedTo: lastSeen >= b10Start ? "b10" : lastSeen >= b11Start ? "b11" : "outside",
      };
    })
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));

  // ── §391.21(b)(7): accidents PSP holds that the applicant did not list ────────────────────────
  // Only inside the 3 years the question asks about: a crash from year four is in PSP and was never
  // required on the form, so reporting it as undeclared would be inventing an obligation.
  const accidentWindowStart = yearsBefore(input.asOf, EMPLOYMENT_WINDOW_YEARS);
  const declaredDates = new Set(input.declaredAccidents.map((a) => a.occurredOn));
  const undeclaredCrashes = input.crashes
    .filter((c) => c.reportDate && c.reportDate >= accidentWindowStart && c.reportDate <= input.asOf)
    .filter((c) => !declaredDates.has(c.reportDate!))
    .map((c) => ({
      reportDate: c.reportDate!,
      carrierName: c.carrierName,
      notPreventable: c.notPreventable,
    }));

  return { employers, unlisted, undeclaredCrashes, inspectionWindowStart, crashWindowStart };
}
