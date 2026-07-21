/** TMS (McLeod) scoring gates — opt-in, per-org. Isolated so scoreTransaction stays within its budget. */
import type { SupabaseClient } from "@supabase/supabase-js";

const DAY_MS = 86_400_000;

/**
 * McLeod/TMS driver-availability gate — opt-in, corroboration-only. Was a fuel purchase made while the
 * ASSIGNED driver was on home time / time off (fill inside a driver_time_off window, ±1-day buffer)?
 *   undefined = org has no ENABLED TMS feed → not evaluated (unchanged for non-TMS orgs);
 *   false     = feed on, driver was on duty at the fill;
 *   true      = feed on, fill landed inside the driver's time-off window → corroborating signal.
 * Never raises a case alone (the rule's weight is below the lone-review threshold); it only reinforces
 * an independent volume/consumption signal. One indexed lookup on org_integrations gates the rest.
 */
export async function deriveDriverHomeAtFill(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  fueledAtIso: string,
): Promise<boolean | undefined> {
  const { data: tmsOn } = await admin
    .from("org_integrations")
    .select("enabled")
    .eq("org_id", orgId)
    .eq("provider", "mcleod")
    .eq("enabled", true)
    .maybeSingle();
  if (!tmsOn) return undefined; // no feed → leave the fuel-only behavior unchanged

  const t = Date.parse(fueledAtIso);
  if (!Number.isFinite(t)) return undefined;
  // Overlap test with a ±1-day buffer: the time-off window must have STARTED by (fill + 1d) and must not
  // have ENDED before (fill − 1d). end_at NULL = open-ended (still off) → counts as covering the fill.
  const lo = new Date(t - DAY_MS).toISOString();
  const hi = new Date(t + DAY_MS).toISOString();
  const { data: offRows } = await admin
    .from("driver_time_off")
    .select("id")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .lte("start_at", hi)
    .or(`end_at.is.null,end_at.gte.${lo}`)
    .limit(1);
  return ((offRows ?? []) as unknown[]).length > 0;
}
