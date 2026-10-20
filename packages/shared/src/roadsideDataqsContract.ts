import { z } from "zod";
import { recordId } from "./recordId.js";
import { isCalendarDay, shiftDay, type CalendarDay } from "./calendarDay.js";
import { formatDisplayDate } from "./displayDate.js";
import { COURT_OUTCOME_TEXT, type RoadsideCitationDispositionDto, type RoadsideCitationDto } from "./roadsideCitationContract.js";

/**
 * A DataQs request for a ticket the court decided in the driver's favour (INSPECTION-CHALLENGE-PLAN IC4, R-ADJ2;
 * table `dataqs_cases`, 0495). DataQs has no API: we draft, a person attests and files it in DataQs themselves,
 * and records the RDR number DataQs gives back. Never filed automatically (D-IC7).
 *
 * ── THE DRAFT IS A TEMPLATE, NOT A MODEL ─────────────────────────────────────────────────────────
 * The request type is fixed by the case ("Inspection—Citation with Associated Violation", RDRTypeDefinitions.pdf)
 * and its content by FMCSA's job aid (AdjudicatedCitations2025.pdf): the report, the ticket, the court and its
 * outcome. Every sentence below is one of those facts, so the draft is a deterministic template over them. An
 * AI-drafted narrative is IC7's, over cases that need an argument; this one needs only the record.
 */

export const DATAQS_URL = "https://dataqs.fmcsa.dot.gov/";
export const DATAQS_RDR_TYPES = ["inspection_citation_with_associated_violation"] as const;
export type DataqsRdrType = (typeof DATAQS_RDR_TYPES)[number];
/** DataQs's own name for the request type, as its form lists it. */
export const DATAQS_RDR_TYPE_TEXT: Record<DataqsRdrType, string> = {
  inspection_citation_with_associated_violation: "Inspection—Citation with Associated Violation",
};

/**
 * DataQs's certification, word for word (DataQs_Users_Guide_and_Best_Practices_Manual.pdf). The filer reads it
 * before approving here, because they will click past the same words in DataQs.
 */
export const DATAQS_ATTESTATION =
  "Any intentionally false or misleading statement, representation, or document that you provide in support of this DataQs request may subject you to prosecution for a violation of Federal law punishable by a fine of not more than $10,000.00 or imprisonment of not more than 5 years, or both (18 USC 1001). By clicking submit, you certify that the statements and information you are submitting in support of this request are, to the best of your knowledge, true, accurate, and complete.";

/** The inspection's facts a request names, read once per inspection (`GET /:id/citations`). */
export interface DataqsFilingFacts {
  carrierName: string;
  usdotNumber: string | null;
  reportState: string | null;
  reportNumber: string | null;
  inspectionDate: CalendarDay | null;
}

/** `GET /api/roadside-inspections/:id/citations` — the inspection's tickets, its court papers, and what a request names. */
export interface RoadsideInspectionCitationsDto {
  tickets: RoadsideCitationDto[];
  /** The court result papers filed on the inspection, oldest first — a disposition names the one it was read from. */
  courtPapers: { id: string; filedAt: string }[];
  filing: DataqsFilingFacts;
}

type Ticket = Pick<RoadsideCitationDto, "citationNumber" | "code" | "description">;

/**
 * The job aid's required fields, in its order, for the person to carry into DataQs's form. A field we do not
 * hold says so rather than being left out, so the person sees what they must find themselves.
 */
export function dataqsFields(f: DataqsFilingFacts, t: Ticket, d: RoadsideCitationDispositionDto): { label: string; value: string }[] {
  const unknown = "Not on our record — read it from the report";
  return [
    { label: "Request type", value: DATAQS_RDR_TYPE_TEXT.inspection_citation_with_associated_violation },
    { label: "Report state", value: f.reportState ?? unknown },
    { label: "Report number", value: f.reportNumber ?? unknown },
    { label: "Inspection date", value: f.inspectionDate ? formatDisplayDate(f.inspectionDate) : unknown },
    { label: "Citation (ticket) number", value: t.citationNumber },
    { label: "Citation state", value: f.reportState ?? unknown },
    { label: "Carrier", value: f.usdotNumber ? `${f.carrierName}, USDOT ${f.usdotNumber}` : f.carrierName },
    { label: "Court", value: d.courtName },
    { label: "Court outcome", value: `${COURT_OUTCOME_TEXT[d.outcomeCode]}${d.amendedCharge ? ` (${d.amendedCharge})` : ""}, decided ${formatDisplayDate(d.decidedOn)}` },
    { label: "Federal violation", value: [t.code, t.description].filter(Boolean).join(" — ") || unknown },
  ];
}

/** The explanation the request carries: each sentence one fact from the report, the ticket or the court's paper. */
export function dataqsNarrative(f: DataqsFilingFacts, t: Ticket, d: RoadsideCitationDispositionDto): string {
  const where = [f.reportState && `in ${f.reportState}`, f.inspectionDate && `on ${formatDisplayDate(f.inspectionDate)}`].filter(Boolean).join(" ");
  const report = f.reportNumber ? `inspection report ${f.reportNumber}` : "this inspection";
  const violation = [t.code, t.description].filter(Boolean).join(", ");
  const court =
    d.outcomeCode === 3
      ? `On ${formatDisplayDate(d.decidedOn)} the ${d.courtName} found the driver not guilty or dismissed the citation.`
      : `On ${formatDisplayDate(d.decidedOn)} the ${d.courtName} convicted the driver of a different charge${d.amendedCharge ? `, ${d.amendedCharge}` : ""}, not the charge cited.`;
  const ask =
    d.outcomeCode === 3
      ? "We ask that the inspection record the citation as not guilty or dismissed, so the associated violation is removed as FMCSA's policy on adjudicated citations provides."
      : "We ask that the inspection record the citation as convicted of a different charge, so the associated violation is given a severity weight of 1 as FMCSA's policy on adjudicated citations provides.";
  return [
    `${f.carrierName}${f.usdotNumber ? ` (USDOT ${f.usdotNumber})` : ""} asks for a correction to ${report}${where ? `, conducted ${where}` : ""}.`,
    `The driver was issued citation ${t.citationNumber}${violation ? ` for the violation ${violation}` : ""}.`,
    court,
    "The court's disposition is attached.",
    ask,
  ].join(" ");
}

/**
 * `POST /api/roadside-inspections/:id/citations/dataqs` — a person approves the request for filing: over the
 * disposition and the driver decision the page showed (D-IC7), with the narrative as they attest to it, and
 * having read `DATAQS_ATTESTATION`.
 */
export const roadsideDataqsApproveSchema = z.object({
  violationId: recordId(),
  dispositionId: recordId(),
  attributionId: recordId(),
  narrative: z.string().trim().min(1, "The request needs its explanation.").max(4000),
  attested: z.literal(true, { message: "Read and accept the certification first." }),
});
export type RoadsideDataqsApprove = z.infer<typeof roadsideDataqsApproveSchema>;

/** `POST /api/roadside-inspections/:id/citations/dataqs/filed` — DataQs's RDR number for an approved request. */
export const roadsideDataqsFiledSchema = z.object({
  violationId: recordId(),
  caseId: recordId(),
  rdrNumber: z.string().trim().min(1, "Enter the RDR number DataQs gave the request.").max(40),
  filedOn: z.string().refine((d) => isCalendarDay(d) && shiftDay(d, 0) === d, "Give the day it was filed as YYYY-MM-DD."),
});
export type RoadsideDataqsFiled = z.infer<typeof roadsideDataqsFiledSchema>;
