import type { SupabaseClient } from "@supabase/supabase-js";
import {
  verificationCallSummary,
  wallClockInZone,
  type EmployerVerificationCall,
  type EmployerVerificationCallInput,
  type EmployerVerificationList,
  type VerifiableEmployer,
  type VerificationOutcome,
  type VerificationQuestion,
} from "@silvicom/shared";
import { readLiveInvitation } from "./applicantChecklist.js";
import { carrierZone, instantOf } from "./carrierClock.js";

/**
 * The office's phone calls to previous employers, before filing — D-AW8, AW12
 * (APPLICATION-FLOW-V2-PLAN §6.5, C2b3). `employerVerificationContract.ts` has why a call is its own
 * record and how filing turns it into §391.23's.
 *
 * ── THE EMPLOYER IS THE DRAFT'S, BY KEY ───────────────────────────────────────────────────────
 * A call names the draft entry's stable `key` (AW1), and the employer's NAME is read from the draft
 * here, never taken from the request: filing matches the call to the employment row by that key, so a
 * call under a key the draft does not hold would be a §391.23 record about nobody. An entry typed
 * before keys were minted has none and cannot take a call until the applicant's form saves it again
 * (`fromDraftPayload` mints one) — the drawer says so on the row.
 *
 * ── BEFORE FILING ONLY ────────────────────────────────────────────────────────────────────────
 * After filing the employment rows exist and the calls on file ARE inquiries. A call made then goes
 * through the inquiry queue, whose record names an employment row; recorded here it would never be
 * copied, since `submit_driver_application` runs once.
 *
 * ⚠ Append-only (0376, EV010): a wrong call is corrected by recording the right one, and both are
 * copied at filing. The service role bypasses RLS: every query carries its own `.eq("org_id", …)`,
 * asserted by `expectOrgScoped` in the route test.
 */

export type EmployerCallError = {
  code: "no_invitation" | "already_filed" | "employer_not_on_application" | "write_failed";
  message: string;
};

export const isEmployerCallError = (v: object): v is EmployerCallError => "code" in v;

const CALL_COLS =
  "id, employer_key, employer_name, outcomes, corrections, answered_by, called_at, copied_inquiry_id";

interface CallRow {
  id: string;
  employer_key: string;
  employer_name: string;
  outcomes: Record<VerificationQuestion, VerificationOutcome>;
  corrections: Partial<Record<VerificationQuestion, string>> | null;
  answered_by: string;
  called_at: string;
  copied_inquiry_id: string | null;
}

const toCall = (r: CallRow): EmployerVerificationCall => ({
  id: r.id,
  employerKey: r.employer_key,
  employerName: r.employer_name,
  outcomes: r.outcomes,
  corrections: r.corrections,
  answeredBy: r.answered_by,
  calledAt: r.called_at,
  copiedInquiryId: r.copied_inquiry_id,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const textOf = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/**
 * The draft's employers, by path — the draft is unvalidated by design (D-APP2), so every field is read
 * defensively and an entry without a name is not an employer anybody can ring.
 */
async function draftEmployers(admin: SupabaseClient, orgId: string, invitationId: string): Promise<VerifiableEmployer[]> {
  const { data } = await admin
    .from("application_drafts")
    .select("employers:payload->employers")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  const list = (data as { employers?: unknown } | null)?.employers;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw): VerifiableEmployer[] => {
    if (!raw || typeof raw !== "object") return [];
    const e = raw as Record<string, unknown>;
    const name = textOf(e.employer_name);
    if (!name) return [];
    return [{
      key: typeof e.key === "string" && UUID.test(e.key) ? e.key.toLowerCase() : null,
      name,
      startedOn: textOf(e.started_on),
      endedOn: textOf(e.ended_on),
      phone: textOf(e.phone),
      dotRegulated: typeof e.dot_regulated === "boolean" ? e.dot_regulated : null,
    }];
  });
}

export async function listEmployerCalls(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<EmployerVerificationList | EmployerCallError> {
  const invitation = await readLiveInvitation(admin, orgId, driverId);
  const timeZone = await carrierZone(admin, orgId);
  if (!invitation) return { employers: [], calls: [], filed: false, timeZone };
  const [employers, { data, error }] = await Promise.all([
    draftEmployers(admin, orgId, invitation.id),
    admin
      .from("employer_verification_calls")
      .select(CALL_COLS)
      .eq("org_id", orgId)
      .eq("invitation_id", invitation.id)
      .order("called_at", { ascending: false }),
  ]);
  if (error) return { code: "write_failed", message: "The calls could not be read." };
  return {
    employers,
    calls: ((data ?? []) as CallRow[]).map(toCall),
    filed: Boolean(invitation.submitted_at),
    timeZone,
  };
}

export async function recordEmployerCall(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  driverId: string,
  body: EmployerVerificationCallInput,
): Promise<{ call: EmployerVerificationCall; invitationId: string } | EmployerCallError> {
  const invitation = await readLiveInvitation(admin, orgId, driverId);
  if (!invitation) return { code: "no_invitation", message: "This applicant has no live invitation." };
  if (invitation.submitted_at) {
    return {
      code: "already_filed",
      message: "The application is filed, so this employer is on the inquiry list now — record the call there.",
    };
  }
  const key = body.employer_key.toLowerCase();
  const employer = (await draftEmployers(admin, orgId, invitation.id)).find((e) => e.key === key);
  if (!employer) {
    return { code: "employer_not_on_application", message: "That employer is not on this application." };
  }

  const zone = await carrierZone(admin, orgId);
  // Only a corrected answer's words are kept — the contract refuses any other, and this is the shape
  // the filing copies into the inquiry's `response`.
  const corrections = Object.fromEntries(
    Object.entries(body.corrections ?? {}).filter(([q]) => body.outcomes[q as VerificationQuestion] === "corrected"),
  );
  const { data, error } = await admin
    .from("employer_verification_calls")
    .insert({
      org_id: orgId,
      invitation_id: invitation.id,
      employer_key: key,
      employer_name: employer.name,
      outcomes: body.outcomes,
      corrections: Object.keys(corrections).length > 0 ? corrections : null,
      called_by: userId,
      answered_by: body.answered_by,
      called_at: instantOf(body.called_at, zone),
    })
    .select(CALL_COLS)
    .single();
  if (error || !data) return { code: "write_failed", message: "The call could not be recorded." };
  return { call: toCall(data as CallRow), invitationId: invitation.id };
}

/**
 * The summaries `submit_driver_application` files as each copied call's `body_sent` (0376, DA043),
 * keyed by call id — every call on the invitation not yet copied. Rendered from the STORED row, in the
 * carrier's zone, so the filed wording is a function of what was recorded and nothing a client sent.
 *
 * Empty when there is nothing to copy, which is how the caller knows it may keep the old call shape.
 */
export async function uncopiedCallSummaries(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<Record<string, string>> {
  const { data } = await admin
    .from("employer_verification_calls")
    .select(CALL_COLS)
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .is("copied_inquiry_id", null);
  const rows = (data ?? []) as CallRow[];
  if (rows.length === 0) return {};
  const timeZone = await carrierZone(admin, orgId);
  return Object.fromEntries(rows.map((r) => {
    const wc = wallClockInZone(new Date(r.called_at), timeZone);
    const pad = (n: number) => String(n).padStart(2, "0");
    const calledAtLocal = `${wc.year}-${pad(wc.month)}-${pad(wc.day)} ${pad(wc.hour)}:${pad(wc.minute)}`;
    return [r.id, verificationCallSummary({
      employerName: r.employer_name,
      answeredBy: r.answered_by,
      calledAtLocal,
      timeZone,
      outcomes: r.outcomes,
      corrections: r.corrections,
    })];
  }));
}
