import { z } from "zod";

/**
 * What the phone provider says about a lead's number (ADS-LEAD-INTAKE-PLAN LQ8; Q-AD62 (a)). The reader is
 * recruiting's (`phoneLookup.ts`, over Telnyx Number Lookup); this file is the projection, the fold from the
 * provider's words to ours, and the staleness rule — pure, so the web and the matrix read the same thing.
 *
 * ── TELNYX'S SHAPE (developers.telnyx.com/docs/identity/number-lookup, read 2026-11-10) ───────────
 * `GET /v2/number_lookup/{e164}?type=carrier`, `Authorization: Bearer`. Answer: `{ data: { record_type:
 * "number_lookup", phone_number, national_format, country_code, valid_number: boolean, carrier: {
 * mobile_country_code, mobile_network_code, name, normalized_carrier, type, error_code } } }`. Documented
 * `carrier.type` values: `mobile`, `fixed line`, `voip`, `toll free`, "and more"; `carrier.error_code` is null
 * on success. Only `type=carrier` is asked — never `caller-name` / `caller-identity`, which return a person's
 * name and address we have no use for and would have to protect.
 *
 * ── FOUR WORDS, AND WHY "unknown" IS ONE OF THEM ────────────────────────────────────────────────
 * The queue and the quality alert need a word a recruiter acts on: a landline cannot be texted, a VoIP line is
 * the one most often behind a wrong number, a mobile is the normal case. Anything Telnyx says that is not one
 * of those — "toll free", "pager", an empty answer, an `error_code` — is `unknown`, with Telnyx's own word kept
 * in `raw`. A number Telnyx calls invalid is `unknown` too, with `valid = false` beside it.
 */

export const PHONE_LINE_TYPES = ["mobile", "landline", "voip", "unknown"] as const;
export type PhoneLineType = (typeof PHONE_LINE_TYPES)[number];

export const PHONE_LOOKUP_PROVIDERS = ["telnyx", "simulator"] as const;
export type PhoneLookupProvider = (typeof PHONE_LOOKUP_PROVIDERS)[number];

/** A lookup older than this is done again when the number turns up on a new lead (ports happen). */
export const PHONE_LOOKUP_STALE_DAYS = 180;

/** The office words. */
export const PHONE_LINE_TYPE_LABELS: Record<PhoneLineType, string> = {
  mobile: "Mobile", landline: "Landline", voip: "Internet line", unknown: "Line type unknown",
};

export const telnyxLookupSchema = z.object({
  data: z.object({
    phone_number: z.string().optional(),
    valid_number: z.boolean().optional(),
    carrier: z.object({
      name: z.string().nullable().optional(),
      normalized_carrier: z.string().nullable().optional(),
      type: z.string().nullable().optional(),
      error_code: z.union([z.string(), z.number()]).nullable().optional(),
    }).nullable().optional(),
  }),
});
export type TelnyxLookup = z.infer<typeof telnyxLookupSchema>;

export interface PhoneLookupProjection {
  line_type: PhoneLineType;
  carrier: string | null;
  valid: boolean | null;
}

/** Telnyx's `carrier.type` → our four words. Exported so the matrix and the fake hold the same fold. */
export function foldLineType(telnyxType: string | null | undefined): PhoneLineType {
  const t = (telnyxType ?? "").trim().toLowerCase();
  if (t === "mobile") return "mobile";
  if (t === "fixed line" || t === "landline" || t === "fixed") return "landline";
  if (t === "voip") return "voip";
  return "unknown";
}

export function projectTelnyxLookup(body: TelnyxLookup): PhoneLookupProjection {
  const c = body.data.carrier ?? null;
  const valid = body.data.valid_number ?? null;
  const errored = c?.error_code !== null && c?.error_code !== undefined;
  return {
    line_type: valid === false || errored ? "unknown" : foldLineType(c?.type),
    carrier: ((c?.normalized_carrier || c?.name) ?? "").trim().slice(0, 120) || null,
    valid,
  };
}

/** Whether a stored lookup is old enough to do again. Pure: the caller passes both instants. */
export function lookupIsStale(lookedUpAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(lookedUpAt) > PHONE_LOOKUP_STALE_DAYS * 86_400_000;
}
