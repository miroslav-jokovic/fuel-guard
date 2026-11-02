import type { SupabaseClient } from "@supabase/supabase-js";
import { TRAVEL_MODE_LABELS, formatDisplayDateTime, type TravelMode, type TripLines } from "@silvicom/shared";

/**
 * One booked trip as the applicant's messages read it (§12 MT3): the row by id, and its lines on the
 * carrier's clock. Its own file because both the send (`applicantTravelSend.ts`) and the outbox's text
 * (`smsOutboxRender.ts`) read it, and the send also writes to the outbox — one file each way, no cycle.
 */

export interface TripRow {
  id: string;
  invitation_id: string;
  mode: TravelMode;
  depart_at: string;
  arrive_at: string;
  confirmation_ref: string | null;
  cancelled_at: string | null;
}

export const TRIP_COLS = "id, invitation_id, mode, depart_at, arrive_at, confirmation_ref, cancelled_at";

/** The trip as the applicant reads it: on the carrier's clock, the zone named — the office typed it on that clock. */
export function tripLinesFor(t: TripRow, zone: string): TripLines {
  const label = (instant: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(new Date(instant)).find((p) => p.type === "timeZoneName")?.value ?? zone;
  const at = (instant: string) => `${formatDisplayDateTime(instant, "", zone)} ${label(instant)}`;
  return { mode: TRAVEL_MODE_LABELS[t.mode], leaves: at(t.depart_at), arrives: at(t.arrive_at), confirmation: t.confirmation_ref };
}

/** One trip of this carrier's, by id. */
export async function readTrip(admin: SupabaseClient, orgId: string, travelId: string): Promise<TripRow | null> {
  const { data } = await admin.from("applicant_travel").select(TRIP_COLS).eq("org_id", orgId).eq("id", travelId).maybeSingle();
  return (data as TripRow | null) ?? null;
}

