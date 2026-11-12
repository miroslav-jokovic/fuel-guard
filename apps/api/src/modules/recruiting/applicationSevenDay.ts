import type { SupabaseClient } from "@supabase/supabase-js";
import {
  displayDayOf,
  SEVEN_DAY_LENGTH,
  sevenDayWindow,
  wallClockToUtc,
  type DriverApplication,
} from "@silvicom/shared";
import { carrierZone } from "./carrierClock.js";

/**
 * Page 21's statement becomes the driver's §395.8(j)(2) record (Q-AM21 (a), owner 2026-11-12; 0591).
 *
 * The driver signs the seven-day work statement on the packet's page 21 (Q-AM4). The owner ruled that
 * the signed statement is ALSO a row of `seven_day_statements` — the list dispatch reads before a first
 * load — so there is one place to look. Written once per application by `record_application_seven_day_statement`
 * (a retry answers with the same row), with the same day and hours the packet prints:
 *
 * · `statement_date` is the application's day by `displayDayOf(certified_at)`, the one definition the
 *   page's `Today's date` prints with; the seven dates are `sevenDayWindow` of it, oldest first.
 * · `last_relieved_at` is the driver's local wall time read in the carrier's zone (the paper is filled
 *   in the carrier's day), stored as the instant the column holds.
 * · `signed_name` is the adopted signature the packet's marks carry.
 *
 * ⚠ Best effort, after the filing commits, for D-APP9's reason: the evidence is the payload and the
 * marks, already committed and append-only, and this row is derived from them. A failure is logged and
 * costs a retry, never the driver's submission. An application filed before Q-AM4 has no hours and
 * records nothing.
 */
export async function recordSevenDayFromApplication(
  admin: SupabaseClient,
  orgId: string,
  applicationId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("driver_applications")
    .select("payload, signed_name, certified_at")
    .eq("org_id", orgId)
    .eq("id", applicationId)
    .maybeSingle();
  const row = data as { payload: DriverApplication; signed_name: string; certified_at: string } | null;
  const hours = row?.payload.seven_day_hours;
  const relieved = row?.payload.last_relieved_at;
  if (!row || !Array.isArray(hours) || hours.length !== SEVEN_DAY_LENGTH || !relieved) return null;

  const day = displayDayOf(row.certified_at);
  const [ymd, hm] = relieved.split("T") as [string, string];
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const [hour, minute] = hm.split(":").map(Number) as [number, number];
  const instant = wallClockToUtc({ year: y, month: m, day: d, hour, minute, second: 0 }, await carrierZone(admin, orgId));

  const { data: id, error } = await admin.rpc("record_application_seven_day_statement", {
    p_org: orgId,
    p_application: applicationId,
    p_statement_date: day,
    p_days: sevenDayWindow(day).map((date, i) => ({ date, hours: hours[i] })),
    p_last_relieved_at: new Date(instant).toISOString(),
    p_signed_name: row.signed_name,
    p_signed_on: day,
  });
  if (error) {
    console.error("[seven-day] page 21 not recorded on the roster", { applicationId, code: error.code ?? null });
    return null;
  }
  return (id as string | null) ?? null;
}
