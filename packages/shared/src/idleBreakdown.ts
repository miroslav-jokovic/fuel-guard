/** Pure rollup aggregation used by both the Idling page and the live precision verifier. */
export type IdleBreakdownEnvelopeStatus =
  "sufficient" | "insufficient" | "ambiguous" | "not_applicable" | "unavailable";
export type IdleBreakdownEnvelopeSource = "documented_default" | "learned_behavioral" | "none";

export interface IdleBreakdownRollupRow {
  vehicle_id: string;
  day: string;
  drive_sec: number;
  idle_sec: number;
  off_sec: number;
  coverage_sec: number;
  managed_idle_sec: number;
  continuous_idle_sec: number;
  rest_idle_sec: number;
  work_idle_sec: number;
  other_idle_sec: number;
  optimized_envelope_inside_sec: number;
  optimized_envelope_outside_sec: number;
  optimized_envelope_unknown_sec: number;
  optimized_envelope_ambiguous_sec: number;
  optimized_envelope_status: IdleBreakdownEnvelopeStatus;
  optimized_envelope_source: IdleBreakdownEnvelopeSource;
  hos_rest_sec: number;
  hos_work_sec: number;
  hos_unknown_sec: number;
  hos_ambiguous_sec: number;
  hos_grace_sec: number;
  hos_evidence_status: IdleBreakdownEnvelopeStatus;
  attributed_driver_id?: string | null;
}

export interface VehicleRollupSums {
  drive: number;
  idle: number;
  off: number;
  cov: number;
  managed: number;
  continuous: number;
  rest: number;
  work: number;
  other: number;
  optimizedEnvelopeInside: number;
  optimizedEnvelopeOutside: number;
  optimizedEnvelopeUnknown: number;
  optimizedEnvelopeAmbiguous: number;
  optimizedEnvelopeStatus: IdleBreakdownEnvelopeStatus;
  optimizedEnvelopeSource: IdleBreakdownEnvelopeSource;
  hosRest: number;
  hosWork: number;
  hosUnknown: number;
  hosAmbiguous: number;
  hosGrace: number;
  hosEvidenceStatus: IdleBreakdownEnvelopeStatus;
}

const STATUS_RANK: Record<IdleBreakdownEnvelopeStatus, number> = {
  not_applicable: 0,
  sufficient: 1,
  insufficient: 2,
  ambiguous: 3,
  unavailable: 4,
};

export function sumRollupByVehicle(rows: readonly IdleBreakdownRollupRow[]): Map<string, VehicleRollupSums> {
  const out = new Map<string, VehicleRollupSums>();
  for (const r of rows) {
    const s = out.get(r.vehicle_id) ?? {
      drive: 0,
      idle: 0,
      off: 0,
      cov: 0,
      managed: 0,
      continuous: 0,
      rest: 0,
      work: 0,
      other: 0,
      optimizedEnvelopeInside: 0,
      optimizedEnvelopeOutside: 0,
      optimizedEnvelopeUnknown: 0,
      optimizedEnvelopeAmbiguous: 0,
      optimizedEnvelopeStatus: "not_applicable",
      optimizedEnvelopeSource: "none",
      hosRest: 0,
      hosWork: 0,
      hosUnknown: 0,
      hosAmbiguous: 0,
      hosGrace: 0,
      hosEvidenceStatus: "not_applicable",
    };
    s.drive += Number(r.drive_sec);
    s.idle += Number(r.idle_sec);
    s.off += Number(r.off_sec);
    s.cov += Number(r.coverage_sec);
    s.managed += Number(r.managed_idle_sec);
    s.continuous += Number(r.continuous_idle_sec);
    s.rest += Number(r.rest_idle_sec);
    s.work += Number(r.work_idle_sec);
    s.other += Number(r.other_idle_sec);
    s.optimizedEnvelopeInside += Number(r.optimized_envelope_inside_sec);
    s.optimizedEnvelopeOutside += Number(r.optimized_envelope_outside_sec);
    s.optimizedEnvelopeUnknown += Number(r.optimized_envelope_unknown_sec);
    s.optimizedEnvelopeAmbiguous += Number(r.optimized_envelope_ambiguous_sec);
    if (STATUS_RANK[r.optimized_envelope_status] > STATUS_RANK[s.optimizedEnvelopeStatus])
      s.optimizedEnvelopeStatus = r.optimized_envelope_status;
    if (r.optimized_envelope_source === "learned_behavioral") s.optimizedEnvelopeSource = "learned_behavioral";
    else if (s.optimizedEnvelopeSource === "none") s.optimizedEnvelopeSource = r.optimized_envelope_source;
    s.hosRest += Number(r.hos_rest_sec);
    s.hosWork += Number(r.hos_work_sec);
    s.hosUnknown += Number(r.hos_unknown_sec);
    s.hosAmbiguous += Number(r.hos_ambiguous_sec);
    s.hosGrace += Number(r.hos_grace_sec);
    if (STATUS_RANK[r.hos_evidence_status] > STATUS_RANK[s.hosEvidenceStatus])
      s.hosEvidenceStatus = r.hos_evidence_status;
    out.set(r.vehicle_id, s);
  }
  return out;
}
