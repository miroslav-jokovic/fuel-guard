import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One person's display name, as `/api/me` reports it (0301, D-MEM1/D-MEM3).
 *
 * The profile's name first; for a driver member with no profile, the roster's name for that person
 * in that org — the same order `org_member_directory()` applies for a whole org, kept here in
 * TypeScript because this is one person on the bootstrap path and a directory call would read the
 * whole org to answer for one row.
 *
 * ⚠ FAIL-OPEN, always: this is called on every page load, a name is a courtesy, and the reader was
 * deployed one merge after its table (D-SURF9). A missing profile, a missing table during that
 * window, or any Supabase error answers `null` and the shell shows the email as it always did. It
 * must never throw into `/api/me`.
 */
export async function displayNameFor(
  admin: SupabaseClient,
  userId: string,
  orgId: string | null,
  role: string | null,
): Promise<string | null> {
  try {
    const { data: profile } = await admin
      .from("user_profiles")
      .select("full_name")
      .eq("user_id", userId)
      .maybeSingle();
    const named = (profile?.full_name as string | undefined) ?? null;
    if (named || !orgId || role !== "driver") return named;
    const { data: driver } = await admin
      .from("drivers")
      .select("full_name")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    return (driver?.full_name as string | undefined) ?? null;
  } catch {
    return null;
  }
}
