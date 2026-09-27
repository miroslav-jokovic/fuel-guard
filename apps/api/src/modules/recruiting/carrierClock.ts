import type { SupabaseClient } from "@supabase/supabase-js";
import { wallClockToUtc } from "@silvicom/shared";
import { readCarrierZone } from "./applicantBoardReads.js";

/**
 * The carrier's clock, for the office's acts that are typed as a wall time — a trip (D-AW7), a
 * drug-test window (D-AW6), a phone call (D-AW8). One definition, so the three read a form the same
 * way (`carrierWallTimeSchema`): an office on a laptop set to another zone records the same instant
 * as one at the desk.
 *
 * ⚠ Moved here from `applicantTravel.ts` on 2026-09-26 (C2b3), when the second and third callers
 * arrived, rather than copied into each.
 */
export const carrierZone = (admin: SupabaseClient, orgId: string): Promise<string> => readCarrierZone(admin, orgId);

/** `YYYY-MM-DDTHH:MM` on the carrier's clock, as an instant. */
export function instantOf(wall: string, zone: string): string {
  const [day, time] = wall.split("T") as [string, string];
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  return new Date(wallClockToUtc({ year, month, day: date, hour, minute, second: 0 }, zone)).toISOString();
}
