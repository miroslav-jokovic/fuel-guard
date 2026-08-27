import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveCarrierIdentity, screeningReadiness, type ScreeningReadiness } from "@silvicom/shared";
import type { Env } from "../../env.js";

/**
 * How many drivers could be screened today, and what is stopping the rest (P0b).
 *
 * The measurement that prompted this, taken from production on 2026-08-20: 201 active drivers, a
 * licence for 166 of them, and a date of birth for **zero**. Every PSP gate was built, the carrier
 * number was configured, the budget was set — and not one request could have been made, because
 * `validatePspRequest` refuses without a date of birth (§8.5 details 1, 27). Nothing in the product
 * said so; the failure would have surfaced one driver at a time, at the moment somebody tried.
 *
 * ── STATUSES INCLUDED, AND WHY IT IS NOT EVERY DRIVER ──────────────────────────────────────────
 * `active` and `applicant` only. A terminated driver is not going to be screened, and counting them
 * would make the number that matters — how much data entry stands between us and a usable
 * integration — permanently and misleadingly worse.
 *
 * Reads only. Nothing here writes, calls a vendor, or costs anything.
 */

const DRIVER_COLS = "id, first_name, last_name, full_name, status, date_of_birth, cdl_number, cdl_state";

export async function loadScreeningReadiness(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  today: string,
): Promise<ScreeningReadiness> {
  const [{ data: drivers }, { data: org }] = await Promise.all([
    admin
      .from("drivers")
      .select(DRIVER_COLS)
      .eq("org_id", orgId)
      .in("status", ["active", "applicant"])
      .order("full_name", { ascending: true }),
    admin.from("organizations").select("dot_number").eq("id", orgId).maybeSingle(),
  ]);

  const carrier = resolveCarrierIdentity({
    orgDotNumber: (org as { dot_number: string | null } | null)?.dot_number ?? null,
    envDotNumber: env.PSP_DOT_NUMBER ?? null,
    envMotorCarrierId: env.PSP_MOTOR_CARRIER_ID ?? null,
    environment: env.PSP_ENVIRONMENT,
  });

  return screeningReadiness(
    (drivers ?? []) as Parameters<typeof screeningReadiness>[0],
    carrier,
    today,
  );
}
