import type { SupabaseClient } from "@supabase/supabase-js";
import type { PacketMarkKind } from "@silvicom/shared";
import type { IntakeError } from "./applicationIntake.js";

/**
 * Which adopted mark each signed DOCUMENT carries (APPLICATION-FLOW-V2-PLAN.md D-AW15, C3s2a).
 *
 * ── ONE ADOPTION PER KIND PER DOCUMENT, AND WHY IT IS A RULE ──────────────────────────────────
 * A driver adopts once (screen 13) and may make a new signature later — at the packet, "This is your
 * signature — use it", or make another — which supersedes the old row (0376). Every mark records the
 * adoption it applied. What must never happen is ONE document signed half with each: the renderers draw
 * one picture per kind per document (`signatureMarkBytes`), and a permission set, a packet or a handbook
 * in two hands reads as two people's. So:
 *   - a mark is refused when its document already carries marks of that kind made with ANOTHER adoption
 *     (`adoption_changed_mid_document`) — the page takes the driver back to the one they started with;
 *   - a new adoption is refused while a document is part-signed with the live one (`adoption_in_use`) —
 *     between documents, a new signature is fine, and each document goes on printing its own.
 *
 * ⚠ **The three tables are named literally**, never in a loop: `check-table-access.mjs` reads table
 * names off the source, and a `.from(<expr>)` is invisible to every table gate.
 */

export type MarkedDocument = "permissions" | "packet" | "handbook";

export const ADOPTION_CHANGED_MID_DOCUMENT: IntakeError = {
  code: "adoption_changed_mid_document",
  message: "Your signature changed partway through this document. Carry on with the one you started it with.",
};

/**
 * The name on the request is not the name the driver adopted (D-AW15). The page signs with the adopted
 * name, so this is a page that adopted again and could not save it; it takes the driver back to adopt.
 */
export const ADOPTION_NAME_MISMATCH: IntakeError = {
  code: "adoption_name_mismatch",
  message: "Your signature changed and the new one did not save. Make it again, then sign.",
};

export const ADOPTION_IN_USE: IntakeError = {
  code: "adoption_in_use",
  message: "You are partway through signing with this, so it cannot be changed until that document is finished.",
};

/** The adoption ids this document's marks of this kind carry, in the order they were made. */
async function adoptionIdsOn(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  document: MarkedDocument,
  kind: PacketMarkKind,
): Promise<string[]> {
  // ⚠ The service role bypasses RLS: every read carries its own org filter.
  const rows = async (q: PromiseLike<{ data: unknown }>) =>
    (((await q).data ?? []) as Array<{ adoption_id: string | null }>).flatMap((r) => (r.adoption_id ? [r.adoption_id] : []));
  if (document === "packet") {
    return rows(
      admin.from("application_packet_marks").select("adoption_id").eq("org_id", orgId)
        .eq("invitation_id", invitationId).eq("mark", kind).order("signed_at", { ascending: true }),
    );
  }
  // The permissions and the handbook are signed, never initialled.
  if (kind !== "signature") return [];
  if (document === "permissions") {
    return rows(
      admin.from("driver_authorizations").select("adoption_id").eq("org_id", orgId)
        .eq("invitation_id", invitationId).is("revokes", null).order("accepted_at", { ascending: true }),
    );
  }
  return rows(
    admin.from("handbook_marks").select("adoption_id").eq("org_id", orgId)
      .eq("invitation_id", invitationId).eq("party", "driver").order("signed_at", { ascending: true }),
  );
}

/** The adoption a document's marks of this kind name — the picture it prints — or null (legacy, A8b). */
export async function documentAdoptionId(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  document: MarkedDocument,
  kind: PacketMarkKind,
): Promise<string | null> {
  return (await adoptionIdsOn(admin, orgId, invitationId, document, kind))[0] ?? null;
}

/**
 * The adoption a mark made NOW applies, or the refusal. Null when the link has no live adoption of the
 * kind: the mark is made with its typed name alone, as A8b says a failed picture must allow.
 */
export async function adoptionForMark(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  document: MarkedDocument,
  kind: PacketMarkKind,
): Promise<{ id: string; typedText: string } | null | IntakeError> {
  const { data } = await admin
    .from("signature_adoptions")
    .select("id, typed_text")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .eq("kind", kind)
    .is("superseded_by", null)
    .maybeSingle();
  const live = data as { id: string; typed_text: string } | null;
  if (!live) return null;
  const started = await documentAdoptionId(admin, orgId, invitationId, document, kind);
  if (started && started !== live.id) return ADOPTION_CHANGED_MID_DOCUMENT;
  return { id: live.id, typedText: live.typed_text };
}

/**
 * Whether a new adoption of this kind would split a document: one still open for signing already
 * carries marks made with the live one. A document is open until its own act closes it — the sixth
 * permission (`releases_completed_at`), the certification that files the packet (`submitted_at`), the
 * countersignature that files the handbook (`handbook_filed_at`).
 */
export async function adoptionSplitsADocument(
  admin: SupabaseClient,
  invitation: {
    id: string;
    org_id: string;
    releases_completed_at: string | null;
    submitted_at: string | null;
    handbook_filed_at?: string | null;
  },
  liveId: string,
  kind: PacketMarkKind,
): Promise<boolean> {
  const open: MarkedDocument[] = [
    ...(invitation.releases_completed_at ? [] : (["permissions"] as const)),
    ...(invitation.submitted_at ? [] : (["packet"] as const)),
    ...(invitation.handbook_filed_at ? [] : (["handbook"] as const)),
  ];
  for (const document of open) {
    const ids = await adoptionIdsOn(admin, invitation.org_id, invitation.id, document, kind);
    if (ids.includes(liveId)) return true;
  }
  return false;
}
