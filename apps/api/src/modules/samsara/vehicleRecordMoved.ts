/**
 * Has a Samsara vehicle record MOVED to another of our trucks since we linked it?
 *
 * ── WHY THE ID MATCH CANNOT BE TRUSTED ON ITS OWN ────────────────────────────────────────────────
 * The vehicle sync matches a Samsara record to a row by `samsara_vehicle_id` first, and until
 * 2026-10-12 it trusted that match unconditionally. But a Samsara record follows its GATEWAY, and a
 * gateway gets moved: measured that day, record 281474990492891 (gateway GPFA-CWR-JA4) had been taken
 * out of old unit 603 — McLeod `tractor_status = 'I'`, out of service 10/01 — and fitted to new unit
 * 819. Samsara renamed the record "819" and reads 819's VIN off the engine, while our 603 row still held
 * its id. So every position, odometer and fuel reading of 819 landed on 603, and 819 showed nothing.
 *
 * The VIN says which truck the record now describes, and in link-only mode our VINs are McLeod's
 * (Samsara writes none), so a disagreement between the two is evidence, not noise. Of 215 records that
 * day, 2 disagreed with the row they were linked to:
 *
 *  · "819" → our 603, VIN belongs to 819, which holds no device: the record MOVED. Follow it.
 *  · "563 - SOLD" → our 563, VIN belongs to 804, which holds its own live device: two records claim one
 *    truck. That is FL1b's held case (Q-FL6) — report it, move nothing — which the id match used to
 *    hide, because it returned before the held check ever ran.
 *
 * A record with no VIN, a row with no VIN, or a VIN no other row carries changes nothing: absence of
 * evidence is not a move. Pure, so the three outcomes are unit tests rather than production surprises.
 */
export interface LinkedRow {
  id: string;
  vin: string | null;
  samsara_vehicle_id: string | null;
}

export type RecordMove<R extends LinkedRow> =
  | { kind: "stay" }
  | { kind: "moved"; from: R; to: R }
  | { kind: "contested"; claimedBy: R };

const norm = (vin: string | null | undefined) => (vin ?? "").trim().toUpperCase();

export function recordMove<R extends LinkedRow>(
  samsaraId: string,
  samsaraVin: string | null | undefined,
  linked: R | undefined,
  byVin: Map<string, R>,
  liveIds: Set<string>,
): RecordMove<R> {
  const vin = norm(samsaraVin);
  if (!linked || !vin || !norm(linked.vin) || norm(linked.vin) === vin) return { kind: "stay" };
  const other = byVin.get(vin);
  if (!other || other.id === linked.id) return { kind: "stay" };
  // The truck the VIN names already reports through ANOTHER device Samsara still lists.
  if (other.samsara_vehicle_id && other.samsara_vehicle_id !== samsaraId && liveIds.has(other.samsara_vehicle_id)) {
    return { kind: "contested", claimedBy: other };
  }
  return { kind: "moved", from: linked, to: other };
}
