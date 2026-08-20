import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMPLOYER_INQUIRIES,
  composeInquiry,
  inquiryWindow,
  isDraftInquiry,
  type InquiryAttempt,
  type InquiryOutcome,
  type InquiryOutcomeUpdate,
} from "@fuelguard/shared";

/**
 * Recording a §391.23 previous-employer inquiry (EMPLOYER-INQUIRY-PLAN E3).
 *
 * ── THE SERVICE COMPOSES THE LETTER; THE REQUEST SAYS ONLY WHO AND HOW ─────────────────────────
 * §391.23(c)(2) requires a record of what was asked and of what address it went to, and §391.23(i)
 * gives the driver the right to review what came back. Both need the exact words to survive, so the
 * wording comes from `EMPLOYER_INQUIRIES` and is stored verbatim on the row — the rule
 * `driver_authorizations` follows for disclosures, applied to the other half of the conversation.
 *
 * ── AN ATTEMPT IS NOT A FAILED SEND ────────────────────────────────────────────────────────────
 * §391.23(c)(1) accepts "documentation of good faith efforts" in place of a reply, so a second
 * letter and a logged phone call are evidence, not retries. Each is its own row, and nothing here
 * updates an earlier one.
 *
 * Every query org-filters itself: the service role bypasses RLS.
 */

export type InquiryError = { code: string; message: string };
export const isInquiryError = (v: object): v is InquiryError => "code" in v;

const EMPLOYMENT_COLS =
  "id, driver_id, employer_name, employer_address_line1, employer_city, employer_state, employer_email, started_on, ended_on, dot_regulated, subject_to_fmcsr, safety_sensitive";

interface EmploymentRow {
  id: string;
  driver_id: string;
  employer_name: string;
  employer_address_line1: string | null;
  employer_city: string | null;
  employer_state: string | null;
  employer_email: string | null;
  started_on: string;
  ended_on: string | null;
  dot_regulated: boolean;
  subject_to_fmcsr: boolean | null;
  safety_sensitive: boolean | null;
}

/** The address as one line, for the §391.23(c)(2) record. Absent parts are simply absent — a record
 *  that pads a missing street with the city would be describing somewhere nobody wrote to. */
const addressOf = (e: EmploymentRow): string | null => {
  const parts = [e.employer_address_line1, e.employer_city, e.employer_state].filter(
    (p): p is string => Boolean(p?.trim()),
  );
  return parts.length > 0 ? parts.join(", ") : null;
};

async function loadContext(
  admin: SupabaseClient,
  orgId: string,
  employmentId: string,
): Promise<{ employment: EmploymentRow; driverName: string; carrier: string } | InquiryError> {
  const { data: employment } = await admin
    .from("driver_employment_history")
    .select(EMPLOYMENT_COLS)
    .eq("id", employmentId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!employment) return { code: "not_found", message: "That employer is not on this driver's file." };
  const row = employment as EmploymentRow;

  const [{ data: driver }, { data: org }] = await Promise.all([
    admin.from("drivers").select("full_name").eq("id", row.driver_id).eq("org_id", orgId).maybeSingle(),
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
  ]);
  return {
    employment: row,
    driverName: (driver as { full_name?: string } | null)?.full_name ?? "the applicant",
    carrier: (org as { name?: string } | null)?.name ?? "The carrier",
  };
}

/** The letter this employer would receive, without recording anything. Free to ask. */
export async function previewInquiry(
  admin: SupabaseClient,
  orgId: string,
  employmentId: string,
  kind: InquiryAttempt["kind"] = "safety_performance",
): Promise<{ title: string; version: string; citation: string; body: string; draft: boolean; sendTo: string | null } | InquiryError> {
  const ctx = await loadContext(admin, orgId, employmentId);
  if (isInquiryError(ctx)) return ctx;
  const doc = EMPLOYER_INQUIRIES[kind];
  return {
    title: doc.title,
    version: doc.version,
    citation: doc.citation,
    body: composeInquiry(doc, {
      driver: ctx.driverName,
      carrier: ctx.carrier,
      window: inquiryWindow(ctx.employment.started_on, ctx.employment.ended_on),
    }),
    draft: isDraftInquiry(doc),
    sendTo: ctx.employment.employer_email ?? addressOf(ctx.employment),
  };
}

/**
 * Record one contact attempt.
 *
 * Refuses a `drug_alcohol` inquiry while its wording is draft (§40.25(a)(1) rests on a consent whose
 * text is not settled), and refuses an employer who owes no inquiry at all: §391.23(a)(2) reaches
 * DOT-regulated employers, and writing to a warehouse for a driver's safety performance history
 * would be asking a question the regulation does not put to them.
 */
export async function recordInquiryAttempt(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  body: InquiryAttempt,
): Promise<{ id: string } | InquiryError> {
  const ctx = await loadContext(admin, orgId, body.employment_id);
  if (isInquiryError(ctx)) return ctx;

  const doc = EMPLOYER_INQUIRIES[body.kind];
  if (isDraftInquiry(doc)) {
    return {
      code: "wording_not_final",
      message: "That request's wording is still a draft, so it cannot be sent or recorded yet.",
    };
  }
  if (body.kind === "safety_performance" && !ctx.employment.dot_regulated) {
    return {
      code: "not_dot_regulated",
      message: "§391.23(a)(2) reaches DOT-regulated employers. This one is not marked as one.",
    };
  }

  const { data, error } = await admin
    .from("employer_inquiries")
    .insert({
      org_id: orgId,
      driver_id: ctx.employment.driver_id,
      employment_id: ctx.employment.id,
      kind: body.kind,
      // Frozen at the moment of contact: an employment row is editable, and somebody correcting a
      // typo next year must not silently rewrite where we wrote to this year.
      employer_name: ctx.employment.employer_name,
      employer_address: addressOf(ctx.employment),
      method: body.method,
      sent_to: body.sent_to,
      contacted_on: body.contacted_on,
      wording_version: doc.version,
      body_sent: composeInquiry(doc, {
        driver: ctx.driverName,
        carrier: ctx.carrier,
        window: inquiryWindow(ctx.employment.started_on, ctx.employment.ended_on),
      }),
      outcome: "awaiting",
      outcome_note: body.note ?? null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !data) return { code: "insert_failed", message: error?.message ?? "Could not record the inquiry." };

  await syncInquiryStatus(admin, orgId, ctx.employment.id);
  return { id: (data as { id: string }).id };
}

/** Every attempt for one driver, newest first — the §391.23(c)(2) record as an auditor reads it. */
export async function listInquiries(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<{ rows: unknown[] }> {
  const { data } = await admin
    .from("employer_inquiries")
    .select(
      "id, employment_id, kind, employer_name, employer_address, method, sent_to, contacted_on, wording_version, outcome, outcome_on, outcome_note, document_id, created_at",
    )
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .order("contacted_on", { ascending: false });
  return { rows: data ?? [] };
}

/**
 * `driver_employment_history.inquiry_status` is DERIVED from the attempts, never typed.
 *
 * A status somebody sets separately from the act it describes is a status that goes stale — the
 * reason `applicantPipeline` computes its stage rather than storing one. The mapping is deliberately
 * blunt: any answered attempt means answered; a documented non-response is an ANSWER too
 * (§391.23(c)(1)); anything else outstanding means sent.
 */
export async function syncInquiryStatus(
  admin: SupabaseClient,
  orgId: string,
  employmentId: string,
): Promise<void> {
  const { data } = await admin
    .from("employer_inquiries")
    .select("outcome, outcome_on, contacted_on")
    .eq("org_id", orgId)
    .eq("employment_id", employmentId)
    .eq("kind", "safety_performance");
  const rows = (data ?? []) as Array<{ outcome: InquiryOutcome; outcome_on: string | null; contacted_on: string }>;
  if (rows.length === 0) return;

  const answered = rows.find((r) => r.outcome === "responded");
  const documented = rows.find((r) => r.outcome === "no_response");
  const status = answered ? "responded" : documented ? "no_response" : "sent";
  const sentOn = rows.map((r) => r.contacted_on).sort()[0] ?? null;
  const respondedOn = (answered ?? documented)?.outcome_on ?? null;

  await admin
    .from("driver_employment_history")
    .update({
      inquiry_status: status,
      // The FIRST attempt is when we asked; a third letter does not move the date we started trying.
      inquiry_sent_on: sentOn,
      inquiry_response_on: respondedOn,
      updated_at: new Date().toISOString(),
    })
    .eq("id", employmentId)
    .eq("org_id", orgId);
}

/**
 * What came back, or that nothing did.
 *
 * A `no_response` is not a failure to record — §391.23(c)(1) accepts documented good-faith efforts in
 * place of a reply, so this is the moment the file becomes complete without one. The trigger in 0223
 * refuses any edit to what was SENT, so this can only ever add the outcome.
 */
export async function recordInquiryOutcome(
  admin: SupabaseClient,
  orgId: string,
  inquiryId: string,
  body: InquiryOutcomeUpdate,
): Promise<{ id: string; employmentId: string } | InquiryError> {
  const { data: existing } = await admin
    .from("employer_inquiries")
    .select("id, employment_id")
    .eq("id", inquiryId)
    .eq("org_id", orgId)
    .maybeSingle();
  const row = existing as { id: string; employment_id: string } | null;
  if (!row) return { code: "not_found", message: "That inquiry is not on file." };

  const { error } = await admin
    .from("employer_inquiries")
    .update({ outcome: body.outcome, outcome_on: body.outcome_on, outcome_note: body.note ?? null })
    .eq("id", inquiryId)
    .eq("org_id", orgId);
  if (error) return { code: "update_failed", message: error.message };

  await syncInquiryStatus(admin, orgId, row.employment_id);
  return { id: row.id, employmentId: row.employment_id };
}
