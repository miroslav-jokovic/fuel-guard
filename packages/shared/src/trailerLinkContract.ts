import { z } from "zod";
import type { TrailerInput } from "./fleet.js";

/**
 * Which trailer is on which truck, from both sources (TRAILER-LINK-PLAN D-TL1, TL4).
 *
 * `GET /api/dispatch/trailers-on-loads` answers the McLeod half: for each trailer on a load a truck is
 * hauling now, the truck and the load. The GPS half is `trailers.assigned_vehicle_id` with its age,
 * `pairing_confirmed_at` (0488), read with the trailer row. The Trailers page shows the two side by side,
 * labelled, rather than one answer that is sometimes the other.
 */
export const trailerOnLoadSchema = z.object({
  trailerId: z.string(),
  vehicleId: z.string(),
  loadId: z.string(),
  /** McLeod's order number, as the board shows it. */
  ref: z.string().nullable(),
});
export type TrailerOnLoad = z.infer<typeof trailerOnLoadSchema>;

export const trailersOnLoadsResponseSchema = z.object({ trailers: z.array(trailerOnLoadSchema) });
export type TrailersOnLoadsResponse = z.infer<typeof trailersOnLoadsResponseSchema>;

/**
 * What a person's save on the Trailers form does to the pairing's provenance (TRAILER-LINK-PLAN Q-TL3).
 * Both machine writers skip a `manual` pairing, but the form never wrote `manual`, so the next GPS run
 * replaced a pairing a person chose. A changed pairing is now theirs; a cleared one is nobody's, so the
 * GPS may pair it again; an unchanged one keeps whatever made it. The date comes from 0488's trigger.
 */
export function handPairingPatch(
  before: string | null,
  after: string | null,
): { assigned_vehicle_id: string | null; pairing_source: "manual" | null; pairing_confidence: null } | null {
  if (before === after) return null;
  return { assigned_vehicle_id: after, pairing_source: after ? "manual" : null, pairing_confidence: null };
}

/** What the Trailers form writes: the form's input, with the pairing's provenance when a person changed it. */
export type TrailerWrite = Omit<TrailerInput, "assigned_vehicle_id"> & Partial<NonNullable<ReturnType<typeof handPairingPatch>>> & {
  assigned_vehicle_id?: string | null;
};
