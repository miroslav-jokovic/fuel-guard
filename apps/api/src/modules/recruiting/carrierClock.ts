import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInZone, wallClockToUtc } from "@silvicom/shared";
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

/**
 * Today, on the carrier's calendar — the `YYYY-MM-DD` a record filed now should carry.
 *
 * ⚠ Never `new Date().toISOString().slice(0, 10)`: that is the UTC day, and from 19:00 Central every
 * evening it is tomorrow. Eleven sites in this module read it that way until 2026-10-20, one of them
 * the `occurred_on` of the handbook's qualification record — append-only, so a handbook signed at
 * eight in the evening was filed as signed the next day and could only be put right by a new row.
 * One definition here, on the org's own zone (`calendarDay.ts`'s rule: the column decides, the
 * carrier's zone measures, never the viewer's), so the next writer of a date reads it rather than
 * the clock.
 */
export async function carrierToday(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<string> {
  return todayInZone(now, await carrierZone(admin, orgId));
}

/** `YYYY-MM-DDTHH:MM` on the carrier's clock, as an instant. */
export function instantOf(wall: string, zone: string): string {
  const [day, time] = wall.split("T") as [string, string];
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  return new Date(wallClockToUtc({ year, month, day: date, hour, minute, second: 0 }, zone)).toISOString();
}
