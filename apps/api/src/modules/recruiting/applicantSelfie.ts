import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICATION_CAPTURES_BUCKET,
  type SelfieCheck,
  type SelfieVerdict,
} from "@silvicom/shared";
import { readLiveInvitation } from "./applicantChecklist.js";

/**
 * The office sets the applicant's selfie beside their licence photo and says whether it is the same
 * person (AW6, APPLICATION-FLOW-V2-PLAN §6.7, D-AW10 phase 1, Q-AW5 (a)).
 *
 * ── A PERSON COMPARES; NOTHING HERE MEASURES A FACE ───────────────────────────────────────────
 * The owner ruled (a) on 2026-09-27: no automated match. 740 ILCS 14/10 excludes photographs from
 * "biometric identifier", and a scan of face geometry taken FROM a photograph is what courts have held
 * covered — so this file serves two pictures to a human and stores the human's words, and must never
 * grow a step that derives anything from the pixels. Phase 2 (a vendor) waits for counsel.
 *
 * ── BOTH PICTURES FROM STAGING, AND FOR HOW LONG ──────────────────────────────────────────────
 * The selfie is never promoted (`NEVER_PROMOTED_CAPTURE_SLOTS`), so it is only ever in the staging
 * bucket. The licence's front is read from the same place rather than from its promoted `documents` row:
 * one query, one bucket, and the comparison is only useful while the selfie still exists, which is
 * the same `application_captures` retention. The URLs live five minutes — long enough to look, and a
 * face on an unauthenticated URL should not outlive the drawer that asked for it.
 *
 * ⚠ The service role bypasses RLS: every query carries its own `.eq("org_id", …)`, asserted by
 * `expectOrgScoped` in the route test.
 */

const URL_TTL_SECONDS = 300;

export type SelfieError = {
  code: "no_invitation" | "no_selfie" | "write_failed";
  message: string;
};

export const isSelfieError = (v: object): v is SelfieError => "code" in v && "message" in v;

interface PhotoRow {
  slot: "selfie" | "cdl_front";
  storage_path: string;
  captured_at: string;
}

async function photos(admin: SupabaseClient, orgId: string, invitationId: string): Promise<PhotoRow[]> {
  const { data } = await admin
    .from("application_captures")
    .select("slot, storage_path, captured_at")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .in("slot", ["selfie", "cdl_front"]);
  return (data ?? []) as PhotoRow[];
}

export async function readSelfieCheck(admin: SupabaseClient, orgId: string, driverId: string): Promise<SelfieCheck> {
  const invitation = await readLiveInvitation(admin, orgId, driverId);
  if (!invitation) return { partOneDone: false, selfie: null, licenceFront: null, verdict: null };

  const [rows, { data: intake }] = await Promise.all([
    photos(admin, orgId, invitation.id),
    admin
      .from("application_intakes")
      .select("selfie_verdict, selfie_verdict_at")
      .eq("org_id", orgId)
      .eq("invitation_id", invitation.id)
      .maybeSingle(),
  ]);

  const signed = new Map<string, string>();
  if (rows.length > 0) {
    const { data: urls } = await admin.storage
      .from(APPLICATION_CAPTURES_BUCKET)
      .createSignedUrls(rows.map((r) => r.storage_path), URL_TTL_SECONDS);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }
  const photo = (slot: PhotoRow["slot"]): SelfieCheck["selfie"] => {
    const row = rows.find((r) => r.slot === slot);
    const url = row ? signed.get(row.storage_path) : undefined;
    return row && url ? { url, capturedAt: row.captured_at } : null;
  };

  const reading = intake as { selfie_verdict: SelfieVerdict | null; selfie_verdict_at: string | null } | null;
  return {
    partOneDone: invitation.intake_completed_at !== null,
    selfie: photo("selfie"),
    licenceFront: photo("cdl_front"),
    verdict: reading?.selfie_verdict && reading.selfie_verdict_at
      ? { verdict: reading.selfie_verdict, at: reading.selfie_verdict_at }
      : null,
  };
}

/**
 * Record the reading on the live invitation's intake row. A second reading replaces the first — the
 * audit row each one writes (the route's) is the history, as 0376's pair CHECK keeps one reading and its
 * time together on the row.
 *
 * Refused without a selfie on file: a reading of a photo nobody took is a reading of nothing, and a
 * driver who could not take one is checked in person (§6.7, "never a hard block").
 */
export async function recordSelfieVerdict(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  driverId: string,
  verdict: SelfieVerdict,
  now: Date,
): Promise<{ invitationId: string; verdict: SelfieVerdict; at: string } | SelfieError> {
  const invitation = await readLiveInvitation(admin, orgId, driverId);
  if (!invitation) return { code: "no_invitation", message: "This applicant has no live application link." };
  if (!(await photos(admin, orgId, invitation.id)).some((r) => r.slot === "selfie")) {
    return { code: "no_selfie", message: "There is no photo of the applicant to compare." };
  }
  const at = now.toISOString();
  const { data, error } = await admin
    .from("application_intakes")
    .update({ selfie_verdict: verdict, selfie_verdict_by: userId, selfie_verdict_at: at, updated_at: at })
    .eq("org_id", orgId)
    .eq("invitation_id", invitation.id)
    .select("invitation_id");
  if (error || !data || data.length === 0) {
    return { code: "write_failed", message: "The reading could not be saved." };
  }
  return { invitationId: invitation.id, verdict, at };
}
