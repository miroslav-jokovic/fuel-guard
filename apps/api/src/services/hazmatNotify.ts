import type { SupabaseClient } from "@supabase/supabase-js";
import { HAZMAT_REVIEW_ROLES } from "@silvicom/shared";
import { notify, loginForDriver } from "../modules/messaging/index.js";

/**
 * HazmatGuard notifications (plan H7 deliverable 4). Emits through the shared `notify()` (entitlement +
 * mute + dedupe aware). A notification is never worth failing the action that caused it — every call is
 * best-effort (.catch swallows), exactly like the dispatch emitters.
 */

/** A load became needs_review → tell the org's trained reviewers (dedup per load). */
export async function notifyReviewersOfFlag(admin: SupabaseClient, orgId: string, loadId: string): Promise<void> {
  const { data } = await admin
    .from("memberships").select("user_id")
    .eq("org_id", orgId).in("role", HAZMAT_REVIEW_ROLES as unknown as string[]);
  const users = (data ?? []) as Array<{ user_id: string }>;
  await Promise.all(
    users.map((u) =>
      notify(admin, {
        orgId, userId: u.user_id, category: "hazmat_review",
        title: "Hazmat load needs review",
        body: "A load was flagged by analysis and needs a trained reviewer.",
        severity: "warning", entityType: "hazmat_load", entityId: loadId,
        dedupeKey: `hazmat_review:${loadId}`,
      }).catch(() => null),
    ),
  );
}

/** A load was cleared/rejected → tell the submitting driver (null driver → no-op). */
export async function notifyDriverOfOutcome(
  admin: SupabaseClient, orgId: string, loadId: string, driverId: string | null, outcome: "cleared" | "rejected",
): Promise<void> {
  if (!driverId) return;
  const userId = await loginForDriver(admin, orgId, driverId);
  if (!userId) return;
  await notify(admin, {
    orgId, userId,
    category: outcome === "cleared" ? "hazmat_cleared" : "hazmat_rejected",
    title: outcome === "cleared" ? "Hazmat load cleared" : "Hazmat load rejected",
    body:
      outcome === "cleared"
        ? "Your hazmat load passed review and is cleared."
        : "Your hazmat load was rejected — recapture the document or fix the issue and resubmit.",
    severity: outcome === "cleared" ? "info" : "warning",
    entityType: "hazmat_load", entityId: loadId,
    dedupeKey: `hazmat_${outcome}:${loadId}`,
  }).catch(() => null);
}
