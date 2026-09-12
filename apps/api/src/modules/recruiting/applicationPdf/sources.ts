import type { SupabaseClient } from "@supabase/supabase-js";
import { APPLICATION_CAPTURES_BUCKET, DOCUMENTS_BUCKET } from "@silvicom/shared";
import type { ApplicationPdfInput } from "./render.js";

/**
 * Everything the rendered application is DRAWN FROM, read in one place (A6, F6).
 *
 * ── WHY IT IS ITS OWN MODULE NOW ──────────────────────────────────────────────────────────────
 * Two callers, one document. `file.ts` renders the certified application and files it; `preview.ts`
 * renders the same document from the draft, for an office that needs to read it before anybody has
 * signed. They differ in exactly two things — which payload, and whether there is a certification —
 * and everything else (the carrier, the instruments signed so far, the 7001(c) consent, the drawn
 * mark) is the same three queries. A second copy of them would be the thing this repository calls a
 * workaround with a delay fuse: the preview would drift from the filing one column at a time.
 *
 * ⚠ Every query here org-filters itself. The API reads with the service role, which BYPASSES RLS, so
 * these `.eq("org_id", …)` calls are the only thing between two carriers' applicants.
 */

export async function carrierOf(
  admin: SupabaseClient,
  orgId: string,
): Promise<ApplicationPdfInput["carrier"]> {
  const { data } = await admin
    .from("organizations")
    .select("name, legal_address")
    .eq("id", orgId)
    .maybeSingle();
  return {
    name: (data as { name?: string } | null)?.name ?? "the carrier",
    address: (data as { legal_address?: string | null } | null)?.legal_address ?? null,
  };
}

/**
 * The instruments THIS session collected, in the order they were signed.
 *
 * Keyed on the invitation (A5): a rehire's older signatures belong to their own application, not to
 * this document.
 *
 * ⚠ Eight columns, not five (X7). `record_driver_release` has written `method`, `accepted_ip` and
 * `accepted_user_agent` since 0215/0228 and this query left all three behind, so the filed document
 * could show WHAT was signed and never HOW — which is the whole of the question a challenged
 * signature raises.
 */
export async function authorizationsFor(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string | null,
): Promise<ApplicationPdfInput["authorizations"]> {
  const { data } = await admin
    .from("driver_authorizations")
    .select(
      "purpose, disclosure_version, disclosure_text, intent_statement, signed_name, accepted_at, "
      + "method, accepted_ip, accepted_user_agent",
    )
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId ?? "")
    .is("revokes", null)
    .order("accepted_at", { ascending: true });
  return (data ?? []) as unknown as ApplicationPdfInput["authorizations"];
}

export async function esignConsentFor(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string | null,
): Promise<ApplicationPdfInput["esignConsent"]> {
  const { data } = await admin
    .from("esign_consents")
    .select("disclosure_version, disclosure_text, intent_statement, consented_at, applicant_ip, applicant_user_agent")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId ?? "")
    .maybeSingle();
  return (data ?? null) as unknown as ApplicationPdfInput["esignConsent"];
}

/**
 * The drawn signature mark this session gave, if it gave one (A8b, D-APP8).
 *
 * ── HOW IT IS FOUND, WHICH IS NOT OBVIOUS ─────────────────────────────────────────────────────
 * The mark promotes into `documents` as kind `other`, which is indistinguishable from a promoted
 * `ssn_card` — so `documents` alone cannot answer "which of these is the signature". The index is the
 * staged row: `application_captures` names the slot, and A8a's identity property does the rest —
 * `documents.id` IS the capture id, so one lookup by slot gives the id of the filed copy.
 *
 * ── AND WHY THERE IS A FALLBACK ───────────────────────────────────────────────────────────────
 * This runs in two situations that differ. Immediately after submit the promoted copy exists in
 * `compliance-docs`, which is where it should be read from — permanent, append-only, on the same side
 * of the evidence line as the document being drawn. Before a submission only the staged object
 * exists. Both are tried, in that order.
 *
 * ⚠ EVERY FAILURE RETURNS NULL, INCLUDING "A11 PRUNED THE STAGING ROW". Once the retention rule lands,
 * a re-render years later will find no `application_captures` row and will draw the document with the
 * typed name alone — which is what D-APP8 says the signature of record has been the whole time. The
 * PDF filed on the day still carries the mark. If that is judged too lossy, A11's rule is one
 * exception away from keeping `signature_mark` rows; it is named in that step for exactly this reason.
 */
export async function signatureMarkBytes(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string | null,
): Promise<Buffer | null> {
  try {
    return await readSignatureMark(admin, orgId, invitationId);
  } catch (e) {
    // The whole of D-APP8, as a catch block. Whatever went wrong reading an ornament, the
    // §391.51(b)(1) document still has to be producible — and on the recruiter's download path there
    // is no caller above this one that would forgive a throw.
    console.warn("[application] could not read the drawn signature mark", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

async function readSignatureMark(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string | null,
): Promise<Buffer | null> {
  if (!invitationId) return null;
  const { data: staged } = await admin
    .from("application_captures")
    .select("id, storage_path")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .eq("slot", "signature_mark")
    .maybeSingle();
  const capture = staged as { id: string; storage_path: string } | null;
  if (!capture) return null;

  const { data: filed } = await admin
    .from("documents")
    .select("storage_path")
    .eq("org_id", orgId)
    .eq("id", capture.id)
    .maybeSingle();
  const promoted = (filed as { storage_path?: string } | null)?.storage_path ?? null;

  const from: Array<[string, string]> = promoted
    ? [[DOCUMENTS_BUCKET, promoted]]
    : [[APPLICATION_CAPTURES_BUCKET, capture.storage_path]];
  for (const [bucket, path] of from) {
    const { data: blob } = await admin.storage.from(bucket).download(path);
    if (blob) return Buffer.from(await blob.arrayBuffer());
  }
  return null;
}
