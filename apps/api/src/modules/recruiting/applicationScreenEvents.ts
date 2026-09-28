import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApplicationScreenEvents } from "@silvicom/shared";
import { resolveInvitation, isIntakeError, type IntakeError } from "./applicationIntake.js";

/**
 * The writer of 0376's `application_screen_events` (AW14, C3d3a) — one row per screen visit on an
 * applicant's link, which is how §6.8's completion times are measured and where applicants stop is
 * found.
 *
 * ── ONE ROW PER VISIT, WRITTEN AT MOST TWICE ──────────────────────────────────────────────────
 * The page mints each visit's `id`. A visit is reported open (`left_at` null) while it is showing, so
 * a phone that dies on a screen still leaves that screen behind, and closed once it is left. So a
 * report is: insert the visits this link has not reported before, and close the ones it reported
 * open. A closed visit is never touched again, and a visit reported twice is the same row — the page
 * resends whatever a failed report carried, and that must change nothing.
 *
 * ⚠ **Every write is scoped to this link's invitation and org**, and not only because the service
 * role bypasses RLS: the ids come from the phone. A made-up id that happens to be another link's row
 * is not found by the select below (it is filtered by invitation), so it is offered to the insert,
 * where the primary key refuses it and `ignoreDuplicates` lets it go. Nothing here can close,
 * rename or read another link's visit.
 *
 * ── THE PHONE'S CLOCK ─────────────────────────────────────────────────────────────────────────
 * Every time in a report is the phone's, and a phone's clock can be minutes off. The report carries
 * the phone's time at sending (`sent_at`), so every time in it is moved by the difference between
 * that and the server's clock on arrival. Durations — the thing §6.8 measures — are unchanged by the
 * move; what it fixes is ordering against the office's own timestamps. A visit that still lands in
 * the future after the move is dropped: it can only be a clock that changed mid-visit.
 *
 * ⚠ No gate on the 7001(c) consent, unlike every write that is part of the application: a screen
 * visit is not an answer and not part of any record the driver signs, and the expectations and
 * consent screens are exactly where the drop-off §6.8 looks for would be.
 */

/** How far in the future a moved time may be before it is a clock problem rather than a delay. */
const FUTURE_SLACK_MS = 60_000;

export interface ScreenEventsResult {
  inserted: number;
  closed: number;
}

export async function recordScreenEvents(
  admin: SupabaseClient,
  token: string,
  report: ApplicationScreenEvents,
  now: Date,
): Promise<ScreenEventsResult | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;

  const shift = now.getTime() - Date.parse(report.sent_at);
  const moved = (iso: string): string => new Date(Date.parse(iso) + shift).toISOString();
  const latest = now.getTime() + FUTURE_SLACK_MS;
  // One entry per id — a report that names a visit twice keeps the later, closed, one.
  const visits = new Map<string, { screen: string; entered_at: string; left_at: string | null }>();
  for (const e of report.events) {
    const entered = moved(e.entered_at);
    const left = e.left_at === null ? null : moved(e.left_at);
    if (Date.parse(entered) > latest || (left !== null && Date.parse(left) > latest)) continue;
    const seen = visits.get(e.id);
    if (seen && seen.left_at !== null && left === null) continue;
    visits.set(e.id, { screen: e.screen, entered_at: entered, left_at: left });
  }
  if (visits.size === 0) return { inserted: 0, closed: 0 };

  const { data: existing, error: readError } = await admin
    .from("application_screen_events")
    .select("id, left_at")
    .eq("org_id", invitation.org_id)
    .eq("invitation_id", invitation.id)
    .in("id", [...visits.keys()]);
  if (readError) throw new Error(`application_screen_events select: ${readError.message}`);
  const known = new Map(((existing ?? []) as { id: string; left_at: string | null }[]).map((r) => [r.id, r.left_at]));

  const fresh = [...visits]
    .filter(([id]) => !known.has(id))
    .map(([id, v]) => ({ id, org_id: invitation.org_id, invitation_id: invitation.id, ...v }));
  if (fresh.length > 0) {
    // A whole row, so `ignoreDuplicates` is `insert … on conflict do nothing` — the replay of a
    // report whose answer was lost, or a made-up id that is another link's (see the header).
    const { error } = await admin
      .from("application_screen_events")
      .upsert(fresh, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(`application_screen_events insert: ${error.message}`);
  }

  let closed = 0;
  for (const [id, v] of visits) {
    if (!known.has(id) || known.get(id) !== null || v.left_at === null) continue;
    const { error } = await admin
      .from("application_screen_events")
      .update({ left_at: v.left_at })
      .eq("id", id)
      .eq("org_id", invitation.org_id)
      .eq("invitation_id", invitation.id)
      .is("left_at", null);
    if (error) throw new Error(`application_screen_events close: ${error.message}`);
    closed += 1;
  }
  return { inserted: fresh.length, closed };
}
