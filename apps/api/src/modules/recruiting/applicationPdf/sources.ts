import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICATION_CAPTURES_BUCKET,
  APPLICATION_CAPTURE_MARK_SLOT,
  DOCUMENTS_BUCKET,
  type ApplicationCaptureSlot,
  type PacketMarkKind,
} from "@silvicom/shared";
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
 * The drawn mark this session gave for one KIND of place, if it gave one (A8b, D-APP8, Q-HUI14).
 *
 * ── ⚠ WHY THERE IS A KIND PARAMETER AT ALL ────────────────────────────────────────────────────
 * The carrier's packet asks for two marks, not one: nineteen signature lines and three captioned
 * `Initials`, and D-PKT6 has always said the second is *"a SECOND adopted mark and not an
 * abbreviation of the first"*. Until Q-HUI14's writer half this function read one slot by name, so
 * the initials could only ever print as typed `HelveticaOblique` while the signature beside them was
 * the driver's own hand. ⚠ **The kind maps to a slot through `APPLICATION_CAPTURE_MARK_SLOT` rather
 * than through a string spelled here**, so this file, the renderer and the browser all join the two
 * vocabularies in the same one place — see that constant for what a second copy would cost.
 *
 * ⚠ **The default is `"signature"`, and it is a default rather than a required argument on purpose.**
 * Every caller that existed before this change wanted the signature and still does; making them all
 * say so would have put the word `signature` in six call sites to express the thing that had not
 * changed, and a diff in which every line moved is a diff in which the one new read is invisible.
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
 * exception away from keeping the two mark rows; it is named in that step for exactly this reason.
 * ⚠ Since Q-HUI14 there are TWO of them to keep or prune, and they must be treated alike — a rule
 * that kept the signature and pruned the initials would make a re-render come out half in one hand.
 *
 * ── ⚠ AND SINCE C3s1 A SECOND SOURCE: THE ADOPTION (D-AW15) ───────────────────────────────────
 * Screen 13 registers the driver's marks as `signature_adoptions` rows, never pruned, and the
 * permissions are signed with them. The packet still makes its own marks until C3s2 — it offers the
 * adoption as carried over, but a driver may draw afresh there, which stages a capture. So the picture a
 * document draws is **the one made most recently at or before its instant**, whichever table holds it:
 * the permissions (instant: filing) print the adoption and never a packet drawing made after; a packet
 * drawn afresh prints its own drawing; a packet that carried the adoption over prints the adoption; a
 * legacy link has captures alone and prints exactly what it printed before. C3s2 replaces this with
 * each mark's own `adoption_id`, which is the exact answer; this is the right one while only the
 * permissions record it. ⚠ The adoption read is the latest adopted at or before the instant, which is
 * the one live at it: an adoption is only ever superseded by a later one.
 */
export async function signatureMarkBytes(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string | null,
  kind: PacketMarkKind = "signature",
  /**
   * Draw nothing for a picture staged AFTER this instant. Since C0b a filed invitation can stage a
   * `signature_mark` for its handbook (`handbookSelfAdoption.ts`, A-1); a document whose signatures were
   * all given before filing — the permissions — must not come out wearing a picture made later (G-13).
   */
  stagedBefore: string | null = null,
): Promise<Buffer | null> {
  const slot = APPLICATION_CAPTURE_MARK_SLOT[kind];
  try {
    return await readSignatureMark(admin, orgId, invitationId, kind, stagedBefore);
  } catch (e) {
    // The whole of D-APP8, as a catch block. Whatever went wrong reading an ornament, the
    // §391.51(b)(1) document still has to be producible — and on the recruiter's download path there
    // is no caller above this one that would forgive a throw.
    // ⚠ The SLOT is logged, because with two marks "could not read the mark" no longer says which.
    console.warn("[application] could not read the drawn signature mark", {
      slot,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** One place a mark's picture may be read from, and when it was made. */
interface MarkSource {
  madeAt: number;
  read: () => Promise<Buffer | null>;
}

async function readSignatureMark(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string | null,
  kind: PacketMarkKind,
  stagedBefore: string | null,
): Promise<Buffer | null> {
  if (!invitationId) return null;
  const sources = [
    await capturedMark(admin, orgId, invitationId, APPLICATION_CAPTURE_MARK_SLOT[kind], stagedBefore),
    await adoptedMark(admin, orgId, invitationId, kind, stagedBefore),
  ].filter((s): s is MarkSource => s !== null);
  // Newest first; an older picture is read only when the newer one's bytes are gone.
  for (const source of sources.sort((a, b) => b.madeAt - a.madeAt)) {
    const bytes = await source.read();
    if (bytes) return bytes;
  }
  return null;
}

async function adoptedMark(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  kind: PacketMarkKind,
  stagedBefore: string | null,
): Promise<MarkSource | null> {
  let query = admin
    .from("signature_adoptions")
    .select("storage_path, adopted_at")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .eq("kind", kind);
  if (stagedBefore) query = query.lte("adopted_at", stagedBefore);
  const { data } = await query.order("adopted_at", { ascending: false }).limit(1);
  const row = (data ?? [])[0] as { storage_path: string; adopted_at: string } | undefined;
  if (!row) return null;
  return {
    madeAt: Date.parse(row.adopted_at),
    read: async () => {
      const { data: blob } = await admin.storage.from(DOCUMENTS_BUCKET).download(row.storage_path);
      return blob ? Buffer.from(await blob.arrayBuffer()) : null;
    },
  };
}

async function capturedMark(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  slot: ApplicationCaptureSlot,
  stagedBefore: string | null,
): Promise<MarkSource | null> {
  const { data: staged } = await admin
    .from("application_captures")
    .select("id, storage_path, captured_at")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .eq("slot", slot)
    .maybeSingle();
  const capture = staged as { id: string; storage_path: string; captured_at?: string } | null;
  if (!capture) return null;
  if (stagedBefore && capture.captured_at && Date.parse(capture.captured_at) > Date.parse(stagedBefore)) return null;
  return {
    // A row without a date sorts as the oldest: it cannot claim to be newer than an adoption.
    madeAt: capture.captured_at ? Date.parse(capture.captured_at) : 0,
    read: () => filedOrStagedBytes(admin, orgId, capture),
  };
}

async function filedOrStagedBytes(
  admin: SupabaseClient,
  orgId: string,
  capture: { id: string; storage_path: string },
): Promise<Buffer | null> {
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
