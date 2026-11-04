import { META_FORM_CATALOGUE } from "../../ads/metaLeadForm.js";
import { catalogueAnswer, type LEAD_CONTACT_METHODS, type LEAD_CONTACT_OUTCOMES, type LeadStatus } from "./leadContract.js";
import type { EvidenceLevel, LeadMatchVerdict, LeadRequirement, Verdict, YearsRange } from "./leadMatch.js";

/**
 * The words the leads screen shows (E4b). Pure and here, not in the page, so the labels sit beside the lists
 * they name and a value added to a list fails the type check until it has a label.
 */

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New", contacted: "Contacted", qualified: "Qualified", not_qualified: "Not qualified", converted: "Applicant", lost: "Lost",
};

const CHANNEL_LABELS: Record<string, string> = {
  meta: "Meta ad", phone_call: "Phone call", walk_in: "Walk-in", referral: "Referral", paste: "Pasted post",
};
/** A channel is an open list in the database (0553), so one with no label yet still reads as words. */
export const leadChannelLabel = (channel: string): string => CHANNEL_LABELS[channel] ?? channel.replace(/_/g, " ");

export const LEAD_CONTACT_METHOD_LABELS: Record<(typeof LEAD_CONTACT_METHODS)[number], string> = {
  call: "Call", sms: "Text", email: "Email", platform_message: "Platform message", in_person: "In person",
};
export const LEAD_CONTACT_OUTCOME_LABELS: Record<(typeof LEAD_CONTACT_OUTCOMES)[number], string> = {
  reached: "Reached", voicemail: "Voicemail", no_answer: "No answer", wrong_number: "Wrong number", declined: "Declined the job",
};

export const LEAD_REQUIREMENT_LABELS: Record<LeadRequirement, string> = {
  age: "Minimum age", class_a: "Class A CDL", class_a_experience: "Class A experience", hazmat: "Hazmat endorsement",
  dui: "DUI history", preventable_accident: "Preventable accidents", clearinghouse: "Clearinghouse", drug_alcohol: "Drug and alcohol history",
};
export const LEAD_VERDICT_LABELS: Record<Verdict, string> = { meets: "Meets", does_not_meet: "Does not meet", unknown: "Not known yet" };
export const LEAD_EVIDENCE_LABELS: Record<EvidenceLevel, string> = { self_reported: "Their own answer", document: "From a document", verified: "Verified" };

const years = (n: number): string => `${n} ${n === 1 ? "year" : "years"}`;

function rangeText(r: YearsRange): string {
  if (r.upper === null) return `more than ${years(r.lower)}`;
  return r.lower === 0 ? `less than ${years(r.upper)}` : `${r.lower} to ${years(r.upper)}`;
}

const NOT_ON_A_FORM = "A form can't answer this. It's checked once they apply.";

/** Why a verdict is what it is, as one sentence, from the facts `leadMatch` stored in `detail`. */
export function leadVerdictWhy(v: LeadMatchVerdict): string {
  const d = v.detail;
  const min = typeof d.min_years === "number" ? years(d.min_years) : null;
  switch (v.requirement) {
    case "age":
      if (typeof d.age === "number") return `They are ${d.age}. The minimum is ${min}.`;
      return `Their age isn't on file, so ask on the call. The minimum is ${min}.`;
    case "class_a":
      if (v.verdict === "unknown") return "They haven't said, so ask on the call.";
      return v.verdict === "meets" ? "They said they hold one." : "They said they don't hold one.";
    case "hazmat":
      if (v.verdict === "unknown") return "They haven't said, so ask on the call.";
      return v.verdict === "meets" ? "They said they have it." : "They said they don't have it.";
    case "class_a_experience": {
      const stated = d.stated as YearsRange | undefined;
      if (!stated) return `They haven't said, so ask on the call. The requirement is ${min}.`;
      const said = `They said ${rangeText(stated)}. The requirement is ${min}`;
      return d.needs === "verification" ? `${said}, and it counts once an employer or the MVR confirms it.` : `${said}.`;
    }
    case "dui":
      return `Ask on the call. None in any vehicle for ${years(Number(d.any_vehicle_years))}, and never in a commercial vehicle.`;
    case "preventable_accident":
      return `Ask on the call. None in the last ${years(Number(d.years))}.`;
    case "clearinghouse":
    case "drug_alcohol":
      return NOT_ON_A_FORM;
  }
}

/** Contact answers are shown as the lead's own name, phone and email; the rest of a form is listed. */
const CONTACT_KEYS = new Set(["full_name", "first_name", "last_name", "phone", "phone_number", "email"]);

/** A form's answers in English, whichever language the person answered in; a key outside the catalogue reads as sent. */
export function leadAnswerRows(answers: Record<string, string>): Array<{ key: string; question: string; answer: string }> {
  return Object.entries(answers)
    .filter(([key]) => !CONTACT_KEYS.has(key))
    .map(([key, raw]) => {
      const entry = META_FORM_CATALOGUE[key];
      const option = entry?.options.find((o) => o.key === catalogueAnswer(key, raw));
      return { key, question: entry?.label.en ?? key.replace(/_/g, " "), answer: option?.value.en ?? raw };
    });
}
