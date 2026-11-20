import { tenstreetSays, type TenstreetSays, type TsNode } from "./tenstreetProjection.js";

/**
 * What the lead drawer shows under "From Tenstreet" (TENSTREET-INTAKE-PLAN TS5), read from the LATEST processed post
 * of the applicant — not the lead's frozen first `raw` — because Tenstreet re-sends the whole application as it
 * changes (D-TS8: a later post is the same lead). Pure: the api unseals and parses (`tenstreetXml.ts` has already
 * removed the SSN and the EEO block before the post was kept) and this picks what an office reader needs.
 *
 * ── WHAT IS SHOWN ────────────────────────────────────────────────────────────────────────────────
 *   · Tenstreet's own status, worklist and recruiter — shown, never obeyed (D-TS8)
 *   · licences: class, CDL, current, state, endorsements — never the licence NUMBER (the office does not need it
 *     to call, and the application, not a lead, is where it is collected and protected)
 *   · employers: name and dates as sent (the guide's MM/DD/YYYY, no zone, kept as text: not reinterpreted)
 *   · how many accidents and moving violations were listed (null = the post did not ask)
 *   · the driving-record answers, labelled with the guide's own questions (R1, rev 11/2014, p.3–4)
 *   · Tags (`CustomDataElements`), the carrier's custom questions with their own question text, and document
 *     NAMES only (F7: no files are fetched)
 *
 * ── WHAT IS NOT SHOWN, AND WHY ───────────────────────────────────────────────────────────────────
 *   · `CriminalRecords` (conviction, felony, misdemeanour, pending charges, deferred prosecution) and the
 *     `ConvictedDrugs` driving-record answer — whose question is about possessing or selling a drug, a criminal
 *     conviction, not a driving one. Illinois' Job Opportunities for Qualified Applicants Act bars an employer from
 *     asking about criminal history on its application, and whether the 49 CFR 391.21 exception reaches these is
 *     the counsel question already open (Q-TS11, recorded in the plan). Until it is ruled, the drawer says that
 *     Tenstreet sent such answers, and shows none of them. The sealed post keeps them for the year the guide asks.
 *   · Address history, date of birth, notes — as the lead itself (tenstreetProjection.ts).
 */

const kid = (n: TsNode | undefined, name: string): TsNode | undefined => n?.children.find((c) => c.name === name);
const kids = (n: TsNode | undefined, name: string): TsNode[] => n?.children.filter((c) => c.name === name) ?? [];
const txt = (n: TsNode | undefined, max = 200): string | null => {
  const v = (n?.text ?? "").trim();
  return v.length > 0 ? v.slice(0, max) : null;
};
const yn = (n: TsNode | undefined): boolean | null => {
  const v = (txt(n) ?? "").toLowerCase();
  return v === "y" || v === "yes" ? true : v === "n" || v === "no" ? false : null;
};

/** The guide's driving-record questions, in its words (R1 p.3–4). A type the guide does not name is shown by its own name. */
export const TENSTREET_MVR_QUESTIONS: Record<string, string> = {
  Suspension: "Has any licence, permit or privilege ever been denied, suspended or revoked?",
  DuringSuspension: "Convicted of driving while suspended or revoked, or without a valid licence, or charges pending?",
  ConvictedAlcoholSubstance: "Convicted of an alcohol or controlled-substance offence while driving, or charges pending?",
  ConvictedReckless: "Convicted of reckless or careless driving, or charges pending?",
  PositiveTest: "Tested positive or refused a pre-employment DOT drug or alcohol test in the past three years?",
};

/** Driving-record types withheld with the criminal block (see the header). */
export const TENSTREET_WITHHELD_MVR_TYPES: ReadonlySet<string> = new Set(["ConvictedDrugs"]);

const LIST_MAX = 30;

export interface TenstreetDrawerView {
  says: TenstreetSays;
  licences: Array<{ class: string | null; cdl: boolean | null; current: boolean | null; state: string | null; endorsements: string[] }>;
  employers: Array<{ name: string | null; start: string | null; end: string | null }>;
  /** Null when the post carried no `Accidents` / `Violations` block (not asked), else how many were listed. */
  accidents: number | null;
  violations: number | null;
  mvr: Array<{ type: string; question: string; answer: boolean | null }>;
  tags: Array<{ prompt: string; value: string | null }>;
  custom: Array<{ question: string; answer: string | null }>;
  documents: Array<{ name: string; category: string | null; created: string | null }>;
  /** Tenstreet sent criminal-history answers, which are not shown (Q-TS11). */
  criminalWithheld: boolean;
}

export function tenstreetDrawerView(root: TsNode): TenstreetDrawerView {
  const app = kid(root, "ApplicationData");
  const licences = kids(kid(app, "Licenses"), "License").slice(0, LIST_MAX).map((l) => ({
    class: txt(kid(l, "LicenseClass"), 4),
    cdl: yn(kid(l, "CommercialDriversLicense")),
    current: yn(kid(l, "CurrentLicense")),
    state: txt(kid(l, "Region"), 3),
    endorsements: kids(kid(l, "Endorsements"), "Endorsement").map((e) => txt(e, 40)).filter((e): e is string => e !== null),
  }));
  const employers = kids(kid(app, "Employers"), "Employer").slice(0, LIST_MAX).map((e) => ({
    name: txt(kid(e, "EmployerName")),
    start: txt(kid(e, "StartDate"), 20),
    end: txt(kid(e, "EndDate"), 20),
  }));
  const accidentsNode = kid(app, "Accidents");
  const violationsNode = kid(app, "Violations");
  // A `Violation` row whose own answer is "n" says there were none; it is not one.
  const violations = kids(violationsNode, "Violation").filter((v) => yn(kid(v, "DriverHaveViolation")) !== false).length;
  const mvrRecords = kids(kid(app, "MotorVehicleRecords"), "MotorVehicleRecord");
  const mvr = mvrRecords
    .map((r) => ({ type: (r.attrs.Type ?? "").trim(), a: (r.attrs.Answer ?? "").trim().toLowerCase() }))
    .filter((r) => /^[A-Za-z]{1,60}$/.test(r.type) && !TENSTREET_WITHHELD_MVR_TYPES.has(r.type))
    .map((r) => ({ type: r.type, question: TENSTREET_MVR_QUESTIONS[r.type] ?? r.type, answer: r.a === "y" ? true : r.a === "n" ? false : null }));
  const tags = kids(kid(app, "CustomDataElements"), "CustomDataElement").slice(0, LIST_MAX)
    .map((t) => ({ prompt: txt(kid(t, "CustomDataPrompt")), value: txt(kid(t, "CustomDataValue"), 500) }))
    .filter((t): t is { prompt: string; value: string | null } => t.prompt !== null);
  const custom = kids(kid(app, "CustomQuestions"), "CustomQuestion").slice(0, LIST_MAX)
    .map((q) => ({ question: txt(kid(q, "Question"), 300) ?? txt(kid(q, "QuestionId")), answer: txt(kid(q, "Answer"), 2000) }))
    .filter((q): q is { question: string; answer: string | null } => q.question !== null);
  const documents = kids(kid(root, "Documents"), "Document").slice(0, LIST_MAX)
    .map((d) => ({ name: txt(kid(d, "Filename")), category: txt(kid(d, "FileCategoryName")), created: txt(kid(d, "DateCreated"), 20) }))
    .filter((d): d is { name: string; category: string | null; created: string | null } => d.name !== null);
  const criminalWithheld =
    kids(kid(app, "CriminalRecords"), "CriminalRecord").length > 0 || mvrRecords.some((r) => TENSTREET_WITHHELD_MVR_TYPES.has((r.attrs.Type ?? "").trim()));
  return {
    says: tenstreetSays(root),
    licences,
    employers,
    accidents: accidentsNode ? kids(accidentsNode, "Accident").length : null,
    violations: violationsNode ? violations : null,
    mvr,
    tags,
    custom,
    documents,
    criminalWithheld,
  };
}

/** The drawer's answer: the view of the latest processed post, and when that post arrived. */
export interface TenstreetLeadPost {
  /** When we received the post this is read from — the "as of" the drawer prints. */
  receivedAt: string;
  view: TenstreetDrawerView;
}
