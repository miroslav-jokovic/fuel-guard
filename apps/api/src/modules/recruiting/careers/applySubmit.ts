import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLY_HONEYPOT_FIELD,
  APPLY_PAGE_CHANNEL,
  APPLY_PAGE_SOURCE,
  SMS_APPLY_PAGE_CONSENT,
  composeSmsConsent,
  normaliseEmail,
  normaliseName,
  normalisePhone,
  type ApplyChecks,
  type ApplySmsOutcome,
  type ApplySubmit,
  type LeadProjection,
} from "@silvicom/shared";
import type { Env } from "../../../env.js";
import type { ConfiguredRecipients } from "../leads/leadNotify.js";
import { acceptLeadProjection } from "../leads/leadSink.js";
import { phoneLookupFor } from "../leads/phoneLookup.js";
import { suppressedPhones } from "../smsSuppressions.js";
import { busyCounts, checksOf, readFormToken, verifyTurnstile, type FetchLike } from "./applyChecks.js";
import type { PublicCareersPage, PublishedOpening } from "./publicCareers.js";

/**
 * One apply-page submission becomes a lead (APPLY-PAGE-PLAN AP2). In order:
 *
 *  1. The checks (D-AP5): the form token (which form, served when), Turnstile, the honeypot, how busy the address
 *     and the number are. Each FLAGS; none refuses.
 *  2. The texting box's outcome is decided BEFORE the store, because the lead's `raw` never changes after it (0553's
 *     guard): ticked on a flagged submission → `held_flagged`; ticked for a number that texted STOP here →
 *     `held_stopped`; otherwise ticked → `recorded`.
 *  3. The lead goes through the LeadSink's own road (`acceptLeadProjection`) with channel `apply_page` and the served
 *     form's id as its `external_ref`, so the same form sent twice is one lead. A flagged one is `quiet`.
 *  4. The consent row (D-AP4), when the outcome is `recorded` and the lead has none yet — so a retry after a failure
 *     between 3 and 4 heals it, and a second send of the same form adds nothing.
 *
 * What is stored on `raw`, and nothing else: the page and opening, the answers as sent, the checks, the address and
 * browser (the consent's proof, and the address count's key), and the box's outcome. Never an SSN, EEO answer, licence
 * number or criminal answer: the contract has no field for any of them.
 */

export interface ApplyDeps {
  admin: SupabaseClient;
  env: Env;
  configured: ConfiguredRecipients;
  carrier: string;
  now: Date;
  client: { ip: string | null; userAgent: string | null };
  pageUrl: string;
  fetchImpl?: FetchLike;
}

export interface ApplyResult {
  stored: "new" | "duplicate";
  leadId: string;
  checks: ApplyChecks;
  sms: ApplySmsOutcome;
}

export async function submitApplication(
  deps: ApplyDeps,
  page: PublicCareersPage,
  opening: PublishedOpening,
  input: ApplySubmit,
): Promise<ApplyResult> {
  const { admin, env, now } = deps;
  const orgId = page.orgId;
  const phone = input.phone ? normalisePhone(input.phone) : null;
  const email = input.email ? normaliseEmail(input.email) : null;

  // ── 1. the checks ──
  const form = readFormToken(env, orgId, opening.id, input.formToken, now);
  const [turnstile, busy] = await Promise.all([
    verifyTurnstile(env, input.turnstileToken, deps.client.ip, form.ref, deps.fetchImpl),
    busyCounts(admin, orgId, deps.client.ip, phone, now),
  ]);
  const checks = checksOf({
    turnstile: turnstile.outcome,
    turnstile_errors: turnstile.errors,
    honeypot: input[APPLY_HONEYPOT_FIELD].trim() === "" ? "empty" : "filled",
    fill: form.fill,
    fill_ms: form.fill_ms,
    ...busy,
  });
  const flagged = checks.flags.length > 0;

  // ── 2. the box ──
  let sms: ApplySmsOutcome = "not_ticked";
  if (input.smsOptIn && phone) {
    if (flagged) sms = "held_flagged";
    else if ((await suppressedPhones(admin, orgId, [phone])).has(phone)) sms = "held_stopped";
    else sms = "recorded";
  }

  // ── 3. the lead ──
  const projection: LeadProjection = {
    channel: APPLY_PAGE_CHANNEL,
    external_ref: form.ref,
    source: APPLY_PAGE_SOURCE,
    campaign_ref: null,
    opening_id: opening.id,
    platform_created_at: now.toISOString(),
    raw: {
      page: { url: deps.pageUrl, handle: page.handle, opening_id: opening.id, opening_title: opening.title },
      form: { full_name: input.fullName, phone: input.phone, email: input.email, answers: input.answers },
      checks,
      client: { ip: deps.client.ip, user_agent: deps.client.userAgent?.slice(0, 400) ?? null },
      sms: { ticked: input.smsOptIn, outcome: sms, consent_version: input.smsOptIn ? SMS_APPLY_PAGE_CONSENT.version : null },
    },
    answers: input.answers,
    full_name: normaliseName(input.fullName),
    phone_e164: phone,
    email_lower: email,
  };
  const r = await acceptLeadProjection(admin, deps.configured, () => now, flagged ? null : phoneLookupFor(env), orgId, projection, { quiet: flagged });

  // ── 4. the consent ──
  // On a duplicate the FIRST submission's stored raw is the record: a form sent again cannot widen what the first one
  // agreed to (a flagged first send stays held), and it is what a retry after a failed consent write heals from.
  const first = r.stored === "new" ? { outcome: sms, phone } : await storedBox(admin, orgId, r.ref);
  if (first.outcome === "recorded" && first.phone) await ensureConsent(admin, orgId, r.ref, first.phone, deps);
  return { stored: r.stored, leadId: r.ref, checks, sms: first.outcome };
}

/** The first submission's box, as its lead stored it. A purged lead's raw is `{}` and its phone null: nothing survives. */
async function storedBox(admin: SupabaseClient, orgId: string, leadId: string): Promise<{ outcome: ApplySmsOutcome; phone: string | null }> {
  const { data, error } = await admin.from("recruiting_leads").select("raw, phone_e164").eq("org_id", orgId).eq("id", leadId).maybeSingle();
  if (error) throw new Error(`recruiting_leads: ${error.message}`);
  const row = data as { raw: { sms?: { outcome?: ApplySmsOutcome } } | null; phone_e164: string | null } | null;
  return { outcome: row?.raw?.sms?.outcome ?? "not_ticked", phone: row?.phone_e164 ?? null };
}

async function ensureConsent(admin: SupabaseClient, orgId: string, leadId: string, phone: string, deps: ApplyDeps): Promise<void> {
  const { data: existing, error: readError } = await admin
    .from("sms_consents").select("id").eq("org_id", orgId).eq("lead_id", leadId).limit(1);
  if (readError) throw new Error(`sms_consents: ${readError.message}`);
  if ((existing ?? []).length > 0) return;
  const doc = composeSmsConsent(SMS_APPLY_PAGE_CONSENT, deps.carrier);
  const { error } = await admin.from("sms_consents").insert({
    org_id: orgId,
    lead_id: leadId,
    phone,
    consent_text: doc.body,
    consent_version: doc.version,
    intent_statement: doc.intent,
    source: "lead_form",
    granted_at: deps.now.toISOString(),
    granted_ip: deps.client.ip,
    granted_user_agent: deps.client.userAgent?.slice(0, 400) ?? null,
  });
  if (error) throw new Error(`sms_consents: ${error.message}`);
}
