import type { SupabaseClient } from "@supabase/supabase-js";
import { SURFACES, sectionManagers, whoHasAccess, type AppSection } from "@silvicom/shared";
import { loadAccessReviewState } from "./routes/accessReview.js";

/**
 * Who holds a screen today — the people `surfaceAllowed` would open it for, resolved through the same
 * four tables and the same shared resolver the Permissions page's "Who has access" tab reads
 * (`accessReview.ts`, SP10). One answer for "who may audit chat" and for "who hears that the chat
 * record failed its check": the holders of `chat.compliance`, not a role list (OFFICE-CHAT-PLAN CHA2,
 * replacing CHA1's labelled interim of "the org's admins").
 *
 * Suspended members are left out: a notice to somebody who cannot sign in is a notice to nobody.
 * Lives in `org` because the access tables are org's and messaging may not import org; the
 * composition root (`schedulers.ts`) hands the function across.
 */
export async function surfaceHolders(admin: SupabaseClient, orgId: string, surfaceKey: string): Promise<string[]> {
  const surface = SURFACES.find((s) => s.key === surfaceKey);
  if (!surface) throw new Error(`surfaceHolders("${surfaceKey}") names no surface in the catalogue`);
  const { state } = await loadAccessReviewState(admin, orgId);
  return whoHasAccess(state, { kind: "screen", surface }).holders.map((r) => r.member.userId);
}

/** Who can act in a section today (the same resolver), for a notice that asks a person to do something. */
export async function sectionManagerIds(admin: SupabaseClient, orgId: string, section: AppSection): Promise<string[]> {
  const { state } = await loadAccessReviewState(admin, orgId);
  return sectionManagers(state, section).map((m) => m.userId);
}
