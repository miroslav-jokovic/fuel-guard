import type { SupabaseClient } from "@supabase/supabase-js";
import { organizationTimezone, todayInZone, type CalendarDay } from "@silvicom/shared";

/**
 * Today on the CARRIER's calendar: the `YYYY-MM-DD` the office means by "today", in the zone the
 * org's operating hours name (`organizationTimezone`). `org` owns `organizations`, so the one
 * definition lives here and every module reads it through org's index.
 *
 * ⚠ Never `new Date().toISOString().slice(0, 10)`: that is the UTC day, and from 18:00–19:00 Central
 * every evening it is tomorrow. Found across DQ, annual inspections, the digest and the alerts on
 * 2026-11-11 (F21 PLAN.md §6, the carrier-day entry): a driver's medical card read "expired" for the
 * last hours of its final day, the DQ alert run could fire a day early, and the dispatch board judged
 * an annual inspection on a different day from the Shop page. The rule is `calendarDay.ts`'s: the
 * column decides, the carrier's zone measures, never the viewer's or the server's.
 *
 * Replaces two copies that were each right but separate — `inspections/read/orgToday.ts` (deleted)
 * and `recruiting/carrierClock.ts`'s `carrierToday` (now this function under its old name) — so a
 * page and the Ask AI tool that copies its day cannot drift onto different clocks.
 *
 * `now` is a parameter so a reader that takes one (the assistant tools, the board) cuts the SAME
 * instant it was asked about, and so a test can pin an evening-Central instant.
 *
 * ORG-SCOPED: reads only the named org's row.
 */
export async function orgToday(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<CalendarDay> {
  const { data } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
  return todayInZone(now, organizationTimezone((data as { operating_hours?: unknown } | null)?.operating_hours as object | null));
}
