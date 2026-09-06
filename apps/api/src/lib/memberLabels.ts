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

/** What the product knows to call a person: their name if they have one, their email either way. */
export interface MemberLabel {
  name: string | null;
  email: string | null;
}

/** The one string a document or a list prints for "who": the name, else the email, else nothing. */
export const labelOf = (m: MemberLabel | undefined): string | null => m?.name ?? m?.email ?? null;

/**
 * Who these people are, for everything that prints an actor: a binder cover, a load's timeline, an
 * export ledger, a hazmat packet, a fuel plan's history row, the card-control approver list.
 *
 * ── ONE DIRECTORY CALL, THEN ONLY THE PEOPLE IT CANNOT NAME ────────────────────────────────────
 * `org_member_directory(p_org_id)` (0301) answers every CURRENT member of the org — email, profile
 * name, roster name for a driver — in one round trip, which is what replaced the six call sites that
 * each did one `auth.admin.getUserById` per person. What the directory cannot answer is somebody
 * who has LEFT the org: their membership row is gone, but a binder generated last year still has to
 * say who asked for it (§390.32 is about exactly that loose page), and a load's timeline still names
 * who dispatched it. For those — and only those — the auth admin API is asked, one call each,
 * bounded by the number of departed actors in a single request rather than by the number of rows.
 * That is the ONLY place in the product that still calls `getUserById` for a display purpose; the
 * invite acceptance's call is a different question (is this email confirmed?) and stays where it is.
 *
 * Fail-open per person: a lookup that throws leaves that id unlabelled, and the caller falls back to
 * the id or the role as it always did. An unknown actor must never take a document down with it.
 */
export async function memberLabels(
  admin: SupabaseClient,
  orgId: string,
  userIds: readonly string[],
): Promise<Map<string, MemberLabel>> {
  const wanted = [...new Set(userIds.filter(Boolean))];
  const labels = new Map<string, MemberLabel>();
  if (wanted.length === 0) return labels;

  try {
    const { data } = await admin.rpc("org_member_directory", { p_org_id: orgId });
    for (const row of (data ?? []) as Array<{ user_id: string; email: string | null; full_name: string | null }>) {
      if (wanted.includes(row.user_id)) labels.set(row.user_id, { name: row.full_name, email: row.email });
    }
  } catch {
    // The directory is the fast path, not the only path — fall through to the per-person lookup.
  }

  const departed = wanted.filter((id) => !labels.has(id));
  await Promise.all(
    departed.map(async (id) => {
      try {
        const [{ data: profile }, { data: auth }] = await Promise.all([
          admin.from("user_profiles").select("full_name").eq("user_id", id).maybeSingle(),
          admin.auth.admin.getUserById(id),
        ]);
        const email = auth?.user?.email ?? null;
        const name = (profile?.full_name as string | undefined) ?? null;
        if (email || name) labels.set(id, { name, email });
      } catch {
        // A deleted login stays unlabelled; the caller prints what it has.
      }
    }),
  );
  return labels;
}
