import { z } from "zod";
import { isRecordId, recordId } from "../../recordId.js";
import type { PlatformLead } from "../../ads/contracts.js";
import { META_FORM_CATALOGUE } from "../../ads/metaLeadForm.js";
import type { LeadMatchSummary, LeadMatchVerdict } from "./leadMatch.js";
import { normalisePhone } from "../../smsConsentContract.js";

/**
 * A lead as recruiting stores it (`recruiting_leads`, 0553) and as `ingest_lead` (0554) receives it — the
 * projection beside the raw payload (D-RA7, D-PSP2: raw whole, projection re-derivable from it).
 *
 * The phone goes through `normalisePhone` — the one normalisation every inbound STOP already uses, and
 * the one 0554's `phone_e164` is held to — and the email is trimmed and lower-cased. A value that does not
 * survive is stored as null rather than guessed (a wrong number is the expensive kind of mistake;
 * `normalisePhone`'s header), and the raw payload still holds what the person typed.
 */

export const LEAD_STATUSES = ["new", "contacted", "qualified", "not_qualified", "converted", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
/** The statuses the queue shows by default: a person nobody has closed. */
export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = ["new", "contacted", "qualified"];

/**
 * The name under which recruiting is an `AdBriefSource` (D-AD17): a campaign made from an opening carries
 * `brief_source = "recruiting_opening"` and `brief_ref = <opening id>`, and its leads come back with both,
 * which is how a Meta lead knows its opening without the ads module knowing what an opening is.
 */
export const OPENING_BRIEF_SOURCE = "recruiting_opening";

export const leadProjectionSchema = z.object({
  channel: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  external_ref: z.string().trim().min(1).max(200).nullable(),
  source: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/).nullable(),
  campaign_ref: z.string().trim().min(1).max(200).nullable(),
  opening_id: recordId().nullable(),
  platform_created_at: z.iso.datetime({ offset: true }).nullable(),
  raw: z.unknown(),
  answers: z.record(z.string(), z.string().max(2000)),
  full_name: z.string().min(1).max(200).nullable(),
  phone_e164: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable(),
  email_lower: z.string().max(320).nullable(),
});
export type LeadProjection = z.infer<typeof leadProjectionSchema>;

const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;

/** Lower-case, trimmed, and the same shape 0553's CHECK holds — or null. */
export function normaliseEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  return v.length > 0 && v.length <= 320 && EMAIL_RE.test(v) ? v : null;
}

/** Whitespace collapsed, at most 200 characters — or null. */
export function normaliseName(raw: string | null | undefined): string | null {
  const v = (raw ?? "").replace(/\s+/g, " ").trim();
  return v.length > 0 ? v.slice(0, 200) : null;
}

/**
 * Meta's own field names for the three contact questions an Instant Form asks (`META_CONTACT_TYPES`:
 * FULL_NAME, PHONE, EMAIL). A first and last name is accepted too, because a form edited in Ads Manager
 * can split the name, and a lead whose name we dropped is a lead a recruiter cannot greet.
 */
const contactOf = (answers: Record<string, string>) => ({
  name: answers.full_name ?? [answers.first_name, answers.last_name].filter(Boolean).join(" "),
  phone: answers.phone_number ?? answers.phone ?? null,
  email: answers.email ?? null,
});

/**
 * The opening a recruiting brief names. An ads campaign freezes its brief as `<opening id>@v<version>`
 * (0537's `ads_campaigns.brief_ref`: "e.g. 'recruiting_opening' + '<id>@v<version>'"), so the id is what
 * comes before the `@`; a bare id is accepted too. Anything else names no opening — never a guess.
 */
export function openingOfBrief(briefSource: string | null, briefRef: string | null): string | null {
  if (briefSource !== OPENING_BRIEF_SOURCE || !briefRef) return null;
  const m = /^([^@]+)(?:@v[1-9]\d{0,5})?$/.exec(briefRef);
  return m && isRecordId(m[1]) ? m[1]! : null;
}

/** What `LeadSink.accept` stores for one platform lead. Pure: the caller adds nothing but the org. */
export function leadFromPlatform(lead: PlatformLead): LeadProjection {
  const c = contactOf(lead.answers);
  const opening = openingOfBrief(lead.brief_source, lead.brief_ref);
  return {
    channel: lead.provider,
    external_ref: lead.platform_lead_ref,
    source: "instant_form",
    campaign_ref: lead.campaign_id,
    opening_id: opening,
    platform_created_at: lead.created_at,
    raw: lead.raw,
    answers: lead.answers,
    full_name: normaliseName(c.name),
    phone_e164: normalisePhone(c.phone),
    email_lower: normaliseEmail(c.email),
  };
}

/**
 * A form answer read back to the catalogue's option KEY. Meta's leads read may hand back an option's key
 * or the label the person saw, in English or Spanish; every one of those is derived from
 * `META_FORM_CATALOGUE` rather than listed here, so a reworded label cannot silently stop matching.
 * Anything else is null — an answer we cannot read is `unknown` downstream, never a guess.
 */
export function catalogueAnswer(question: string, raw: string | undefined): string | null {
  const entry = META_FORM_CATALOGUE[question];
  if (!entry || raw === undefined) return null;
  const v = raw.trim().toLowerCase();
  for (const option of entry.options) {
    if (option.key.toLowerCase() === v) return option.key;
    if (Object.values(option.value).some((label) => label.trim().toLowerCase() === v)) return option.key;
  }
  return null;
}

// ── a lead a recruiter enters by hand (a phone call, a walk-in, a referral, a pasted post) ────────
/**
 * The other way in besides a platform form (D1's "created via webhook, paste and API shows once"). It has no
 * outside id, so it is never deduplicated as the SAME LEAD — only matched as the same PERSON, by phone or
 * email, which is why it needs one of them: a name alone cannot be matched to anybody (D-LS10).
 */
export const MANUAL_LEAD_CHANNELS = ["phone_call", "walk_in", "referral", "paste"] as const;
export const manualLeadSchema = z
  .object({
    channel: z.enum(MANUAL_LEAD_CHANNELS),
    full_name: z.string().trim().min(2).max(200),
    phone: z.string().trim().max(40).nullable(),
    email: z.string().trim().max(320).nullable(),
    opening_id: recordId().nullable(),
    /** What the recruiter heard or pasted; kept in the raw payload, never parsed into facts here. */
    note: z.string().max(4000).nullable(),
  })
  .refine((v) => normalisePhone(v.phone) !== null || normaliseEmail(v.email) !== null, {
    message: "A phone number or an email is needed, so the same person can be recognised.",
    path: ["phone"],
  });
export type ManualLead = z.infer<typeof manualLeadSchema>;

export function leadFromManual(input: ManualLead): LeadProjection {
  return {
    channel: input.channel,
    external_ref: null,
    source: null,
    campaign_ref: null,
    opening_id: input.opening_id,
    platform_created_at: null,
    raw: { entered: input.channel, phone: input.phone, email: input.email, note: input.note },
    answers: {},
    full_name: normaliseName(input.full_name),
    phone_e164: normalisePhone(input.phone),
    email_lower: normaliseEmail(input.email),
  };
}

/**
 * One call, text or email a person made to a lead, or took from one (`recruiting_contacts`, 0553; D-LS6: "all
 * the contacts will be done by real persons", so this is what a person writes down afterwards, never a record
 * of something the system sent). The three lists are 0553's CHECKs; the matrix `recruiting-leads.test.mjs`
 * inserts every value here, so a list that drifts from its CHECK fails there.
 *
 * `outcome` is optional because an inbound text has none. `declined` means they declined the JOB, and blocks
 * nothing: a person who asked not to be contacted goes through do-not-contact (`doNotContact.ts`' header).
 * The note may name the person, which is why it never reaches the audit log.
 */
export const LEAD_CONTACT_DIRECTIONS = ["outbound", "inbound"] as const;
export const LEAD_CONTACT_METHODS = ["call", "sms", "email", "platform_message", "in_person"] as const;
export const LEAD_CONTACT_OUTCOMES = ["reached", "voicemail", "no_answer", "wrong_number", "declined"] as const;
export const leadContactSchema = z.object({
  direction: z.enum(LEAD_CONTACT_DIRECTIONS),
  method: z.enum(LEAD_CONTACT_METHODS),
  outcome: z.enum(LEAD_CONTACT_OUTCOMES).nullable().default(null),
  note: z.string().trim().max(2000).nullable().default(null).transform((v) => v || null),
});
export type LeadContactInput = z.infer<typeof leadContactSchema>;

/**
 * A contact as the lead drawer reads it (`GET /recruitment/leads/:id/contacts`, E4a). `created_by` stays
 * behind: the drawer names the person, and the name was frozen on the row when they wrote it.
 *
 * `note_withheld` says a note exists on a purged lead and is not being served, so the drawer can say so rather
 * than show a contact that seems to have no note (`readLeadContacts` has why).
 */
export interface LeadContactRecord {
  id: string;
  direction: (typeof LEAD_CONTACT_DIRECTIONS)[number];
  method: (typeof LEAD_CONTACT_METHODS)[number];
  outcome: (typeof LEAD_CONTACT_OUTCOMES)[number] | null;
  note: string | null;
  note_withheld: boolean;
  created_by_name: string;
  contacted_at: string;
}

/**
 * One row of the recruiter's queue (`GET /recruitment/leads`; `recruiting_lead_queue`, 0554): one person per
 * row, with their later leads riding as `also`.
 */
export interface LeadQueueRow {
  id: string;
  channel: string;
  source: string | null;
  campaign_ref: string | null;
  opening_id: string | null;
  full_name: string | null;
  phone_e164: string | null;
  email_lower: string | null;
  status: LeadStatus;
  assigned_to: string | null;
  received_at: string;
  answers: Record<string, string>;
  also: Array<{ id: string; channel: string; campaign_ref: string | null; received_at: string }>;
  drivers: Array<{ id: string; status: string; archived: boolean }>;
  verdicts: LeadMatchVerdict[];
  summary: LeadMatchSummary | null;
  /**
   * The number is held from contact (`doNotContact.ts`): the person asked, on this lead or any other, or
   * texted STOP. Read from the number's own record, so a re-submission shows it as the first row did.
   */
  do_not_contact: boolean;
}

export interface LeadQueuePage {
  leads: LeadQueueRow[];
  /** The cursor for the next page, or null when this page was the last. */
  next: { before_at: string; before_id: string } | null;
}

/**
 * One lead by its id (`GET /recruitment/leads/:id`, E4b), whatever its status, which is what a notification or
 * a person's other lead links to. It is not a queue row: `also` here is every other lead of the person, earlier
 * ones and closed ones included (`recruiting_lead_matches`), and `purged_at` says the details were deleted.
 */
export interface LeadRecord extends Omit<LeadQueueRow, "also"> {
  also: Array<{ id: string; channel: string; status: LeadStatus; received_at: string }>;
  purged_at: string | null;
}
