import { formatDisplayMonth, type DriverApplication } from "@silvicom/shared";
import { addressCells, blank, date, yesNo } from "./packetDraw.js";
import type { AnswerSheetEntry, AnswerSheetSection } from "./packetAnswerSheet.js";

/**
 * The applicant's answers the carrier's paper has no place for, on a sheet appended to the packet
 * (APPLICATION-FIX-PLAN F2: P1, P6, P7, P8).
 *
 * ── WHY THERE IS AN ADDENDUM AT ALL ──────────────────────────────────────────────────────────
 * The mismatch audit (2026-11-09) found answers the driver gave, the office could see and correct, and the
 * signed packet never printed: each employer's reason for leaving and the two §391.21(b)(10)(iv) questions,
 * the USDOT number and contact e-mail the §391.23 inquiry is sent with, whether the job was driving, the
 * dates of each address, the explanation of every stretch without work, the applicant's e-mail and the
 * narrative of their experience. The owner's rule is that the driver's form, the office's card and the
 * signed packet match (D-AM7) — so a signed document missing what the driver answered is the mismatch
 * itself, and (b)(10)'s reason for leaving and (iv)(A)/(B) are answers the regulation puts ON the
 * application.
 *
 * The owner's rule of 2026-11-11 — the online form is a prefill of the carrier's paper, and the paper
 * decides what is asked — does not remove these: every one was already asked, and the carrier's own page 11
 * heads its employment record "ATTACH SHEET IF MORE SPACE IS NEEDED". This is that sheet.
 *
 * ── EVERY ENTRY NAMES ITS PLACE ──────────────────────────────────────────────────────────────
 * `places` are the catalogue's packet destinations (`applicantFacts.ts`'s `ADDENDUM`), so the parity
 * test (`applicantFactsPacket.test.ts`) holds this sheet to the catalogue the way it holds the carrier's
 * pages: a fact the catalogue sends here that no entry prints fails, and so does an entry no fact claims.
 *
 * ⚠ An unanswered question prints "Not answered.", never a blank and never an invented "No" — the
 * §391.21 summary's sentence (AUD-11/AUD-22), for its reason: a question with nothing under it cannot be
 * told from one never asked.
 */

const NOT_ANSWERED = "Not answered.";

export interface AddendumEntry extends AnswerSheetEntry {
  /** The catalogue's places this entry prints (`addendum.employers#reason_for_leaving`, …). */
  places: readonly string[];
}

export interface AddendumSection extends AnswerSheetSection {
  entries: readonly AddendumEntry[];
}

const said = (text: string): string => (text.trim() === "" ? NOT_ANSWERED : text);
const yes = (v: boolean | null | undefined): string => said(yesNo(v));
const month = (v: string | null | undefined): string => formatDisplayMonth(v, "");
const entry = (question: string, answer: string, ...places: string[]): AddendumEntry => ({ question, answer, places });

/** The sections, in the order the carrier's pages ask the same subjects: applicant, residence, employment. */
export function addendumSections(a: DriverApplication): AddendumSection[] {
  const sections: AddendumSection[] = [];

  sections.push({
    heading: "Applicant",
    entries: [
      entry("E-mail", said(blank(a.email)), "addendum.email"),
      entry("The nature and extent of the applicant's experience", said(blank(a.experience)), "addendum.experience"),
    ],
  });

  // P6: the carrier's residency rules take street, city, state and ZIP and no dates, so each address is
  // named again here beside the months it covers — a date range with no address is not an answer.
  const addresses = a.addresses ?? [];
  if (addresses.length > 0) {
    sections.push({
      heading: "Addresses for the past three years: the dates at each",
      entries: addresses.map((addr) => {
        const from = month(addr.from);
        const to = addr.to ? month(addr.to) : from ? "present" : "";
        return entry(
          addressCells(addr).filter((c) => c.trim()).join(", ") || NOT_ANSWERED,
          from ? `${from} to ${to}` : NOT_ANSWERED,
          "addendum.addresses#from",
          "addendum.addresses#to",
        );
      }),
    });
  }

  // P1, P8: one section per employer, headed by the name and dates page 12 prints, so the reader can lay
  // the two side by side.
  if (!a.declares_no_employment) {
    for (const e of a.employers ?? []) {
      sections.push({
        heading: `${blank(e.employer_name) || "Employer not named"}, ${date(e.started_on)} to ${e.ended_on ? date(e.ended_on) : "present"}`,
        entries: [
          entry("USDOT number", said(blank(e.usdot_number)), "addendum.employers#usdot_number"),
          entry("E-mail for the previous-employer inquiry", said(blank(e.email)), "addendum.employers#email"),
          entry("Did you drive a commercial motor vehicle in this job?", yes(e.operated_cmv), "addendum.employers#operated_cmv"),
          entry("Was this employer regulated by the DOT?", yes(e.dot_regulated), "addendum.employers#dot_regulated"),
          entry("Were you subject to the Federal Motor Carrier Safety Regulations in this job?",
            yes(e.subject_to_fmcsr), "addendum.employers#subject_to_fmcsr"),
          entry("Was the job a safety-sensitive function subject to DOT drug and alcohol testing?",
            yes(e.safety_sensitive), "addendum.employers#safety_sensitive"),
          entry("Reason for leaving", said(blank(e.reason_for_leaving)), "addendum.employers#reason_for_leaving"),
        ],
      });
    }
  }

  // P7: each stretch of the period with no employer, and the applicant's account of it.
  const gaps = a.employment_gaps ?? [];
  if (gaps.length > 0) {
    sections.push({
      heading: "Time without an employer",
      entries: gaps.map((g) =>
        entry(`${date(g.from)} to ${date(g.to)}`, said(blank(g.explanation)),
          "addendum.gaps#from", "addendum.gaps#to", "addendum.gaps#explanation")),
    });
  }
  return sections;
}

/** The addendum's title and note; the overlay appends it (`packetOverlay.ts`) with the sections above. */
export const ADDENDUM_SHEET = {
  title: "APPLICATION ADDENDUM",
  note: "Answers the applicant gave that the carrier's form has no space for. Page 11: attach sheet if more space is needed.",
} as const;
