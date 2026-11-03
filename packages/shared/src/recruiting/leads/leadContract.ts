import { z } from "zod";
import { isRecordId, recordId } from "../../recordId.js";
import type { PlatformLead } from "../../ads/contracts.js";
import { META_FORM_CATALOGUE } from "../../ads/metaLeadForm.js";
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

/** What `LeadSink.accept` stores for one platform lead. Pure: the caller adds nothing but the org. */
export function leadFromPlatform(lead: PlatformLead): LeadProjection {
  const c = contactOf(lead.answers);
  const opening =
    lead.brief_source === OPENING_BRIEF_SOURCE && lead.brief_ref && isRecordId(lead.brief_ref) ? lead.brief_ref : null;
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
