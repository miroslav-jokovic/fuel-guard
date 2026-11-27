/**
 * Samsara payloads → one `samsara_warnings` row shape (WARNING-DESK-PLAN D-WD4). Pure: no clock, no I/O.
 *
 * Six sources, one row. Each parser takes exactly what the live API returned on 2026-11-26 (shapes in
 * the plan §1) and refuses — returns null — anything without the identity the row is keyed on, so a
 * vendor shape change shows up as `refused` in the run's stats rather than as a half-filled row.
 *
 * Nothing outside `modules/samsara` parses a Samsara payload (docs/ARCHITECTURE.md §2); the desk reads
 * these rows.
 */
import {
  alertRuleDefault,
  alertRuleKey,
  HOS_DRIVING_TYPES,
  SERIOUS_SAFETY_BEHAVIOURS,
  type AlertConfigurationSummary,
  type WarningSource,
  type WarningSubject,
} from "@silvicom/shared";

export interface WarningRow {
  org_id: string;
  source: WarningSource;
  source_key: string;
  kind: string;
  subject_kind: WarningSubject;
  vehicle_samsara_id: string | null;
  trailer_samsara_id: string | null;
  driver_samsara_id: string | null;
  unit_name: string | null;
  driver_name: string | null;
  label: string;
  happened_at: string;
  ended_at: string | null;
  still_active: boolean;
  samsara_url: string | null;
  detail: Record<string, unknown>;
  updated_at: string;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const idOf = (v: unknown): string | null => str(obj(v)?.id) ?? (typeof obj(v)?.id === "number" ? String(obj(v)?.id) : null);
const nameOf = (v: unknown): string | null => str(obj(v)?.name);
const isoOrNull = (v: unknown): string | null => {
  const s = str(v);
  return s && Number.isFinite(Date.parse(s)) ? new Date(Date.parse(s)).toISOString() : null;
};

/** A truck Samsara still lists after a device swap or a sale ("783 - OLD", "556 - SOLD"): not ours to chase. */
export function isRetiredUnitName(name: string | null): boolean {
  return name !== null && /\s-\s*(OLD|SOLD)\b/i.test(name);
}

/** The detail column holds ≤ 2 KB (0653's CHECK); trim long strings rather than fail the row. */
function smallDetail(d: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "string" ? v.slice(0, 300) : v;
  }
  return JSON.stringify(out).length > 1800 ? { note: "detail trimmed" } : out;
}

interface Base {
  orgId: string;
  seenAt: string;
}

/**
 * One alert incident (`GET /alerts/incidents/stream`). Keyed on `incidentUrl`, which is unique per
 * incident (1,764 of 1,764 in ten days). The subject comes from the configuration's derived rule:
 * speed and low fuel are the driver's, the rest the truck's.
 */
export function alertIncidentRow(raw: unknown, config: AlertConfigurationSummary, b: Base): WarningRow | null {
  const i = obj(raw);
  const url = str(i?.incidentUrl);
  const at = isoOrNull(i?.happenedAtTime);
  if (!i || !url || !at) return null;
  const conditions = Array.isArray(i.conditions) ? i.conditions : [];
  let vehicle: unknown = null;
  let driver: unknown = null;
  let trailer: unknown = null;
  const triggerIds: number[] = [];
  for (const c of conditions) {
    const co = obj(c);
    if (typeof co?.triggerId === "number") triggerIds.push(co.triggerId);
    for (const d of Object.values(obj(co?.details) ?? {})) {
      const dd = obj(d);
      vehicle ??= dd?.vehicle ?? null;
      driver ??= dd?.driver ?? null;
      trailer ??= dd?.trailer ?? null;
    }
  }
  const resolved = i.isResolved === true;
  const subject = alertRuleDefault(config).subject;
  return {
    org_id: b.orgId,
    source: "alert",
    source_key: url,
    kind: alertRuleKey(config.id),
    subject_kind: subject === "trailer" && !trailer ? "truck" : subject,
    vehicle_samsara_id: idOf(vehicle),
    trailer_samsara_id: idOf(trailer),
    driver_samsara_id: idOf(driver),
    unit_name: nameOf(vehicle) ?? nameOf(trailer),
    driver_name: nameOf(driver),
    label: config.name,
    happened_at: at,
    ended_at: resolved ? isoOrNull(i.resolvedAtTime) : null,
    still_active: !resolved,
    samsara_url: url,
    detail: smallDetail({ triggerIds }),
    updated_at: b.seenAt,
  };
}

/**
 * One safety event (`GET /safety-events/stream`, includeAsset + includeDriver). Keyed on the event id.
 * Serious if any behaviour is in SERIOUS_SAFETY_BEHAVIOURS (D-WD11). Samsara's coaching state rides in
 * `detail` so the desk shows it without asking Samsara again (D-WD8). A dismissed event is not a
 * warning: it is stored inactive so a re-read cannot resurrect it, and the evaluator never counts it.
 */
export function safetyEventRow(raw: unknown, b: Base): WarningRow | null {
  const e = obj(raw);
  const id = str(e?.id);
  const at = isoOrNull(e?.startMs) ?? isoOrNull(e?.createdAtTime);
  if (!e || !id || !at) return null;
  const labels = (Array.isArray(e.behaviorLabels) ? e.behaviorLabels : [])
    .map((l) => str(obj(l)?.label))
    .filter((l): l is string => l !== null);
  const state = str(e.eventState);
  const dismissed = state === "dismissed";
  const serious = labels.some((l) => SERIOUS_SAFETY_BEHAVIOURS.has(l));
  return {
    org_id: b.orgId,
    source: "safety",
    source_key: id,
    kind: dismissed ? "safety_dismissed" : serious ? "safety_serious" : "safety_other",
    subject_kind: "driver",
    vehicle_samsara_id: idOf(e.asset),
    trailer_samsara_id: null,
    driver_samsara_id: idOf(e.driver),
    unit_name: nameOf(e.asset),
    driver_name: nameOf(e.driver),
    label: labels.length ? labels.join(", ") : "Safety event",
    happened_at: at,
    ended_at: at,
    still_active: false,
    samsara_url: str(e.inboxEventUrl),
    detail: smallDetail({ eventState: state, hasVideo: Array.isArray(e.media) && e.media.length > 0 }),
    updated_at: b.seenAt,
  };
}

/**
 * One DVIR defect (`GET /defects/stream`). Keyed on the defect id; open while `isResolved` is false.
 * A trailer defect is the trailer's, otherwise the truck's.
 */
export function defectRow(raw: unknown, b: Base): WarningRow | null {
  const d = obj(raw);
  const id = str(d?.id) ?? (typeof d?.id === "number" ? String(d.id) : null);
  const at = isoOrNull(d?.createdAtTime);
  if (!d || !id || !at) return null;
  const trailerId = idOf(d.trailer);
  const vehicleId = idOf(d.vehicle);
  if (!trailerId && !vehicleId) return null;
  const resolved = d.isResolved === true;
  return {
    org_id: b.orgId,
    source: "dvir",
    source_key: id,
    kind: "dvir_open",
    subject_kind: trailerId ? "trailer" : "truck",
    vehicle_samsara_id: vehicleId,
    trailer_samsara_id: trailerId,
    driver_samsara_id: null,
    unit_name: nameOf(d.trailer) ?? nameOf(d.vehicle),
    driver_name: null,
    label: str(d.comment)?.trim() || "Defect reported on inspection",
    happened_at: at,
    ended_at: resolved ? isoOrNull(d.resolvedAtTime) ?? isoOrNull(d.updatedAtTime) : null,
    still_active: !resolved,
    samsara_url: null,
    detail: smallDetail({ dvirId: str(d.dvirId), defectTypeId: str(d.defectTypeId) }),
    updated_at: b.seenAt,
  };
}

/**
 * One HOS violation (`GET /fleet/hos/violations`). Keyed on driver + type + start; `unsubmittedLogs`
 * carries no start of its own, so its day stands in.
 */
export function hosViolationRow(raw: unknown, b: Base): WarningRow | null {
  const v = obj(raw);
  const type = str(v?.type);
  const driverId = idOf(v?.driver);
  const at = isoOrNull(v?.violationStartTime) ?? isoOrNull(obj(v?.day)?.startTime);
  if (!v || !type || !driverId || !at) return null;
  const kind = type === "unsubmittedLogs" ? "hos_unsubmitted" : HOS_DRIVING_TYPES.has(type) ? "hos_driving" : null;
  if (!kind) return null;
  return {
    org_id: b.orgId,
    source: "hos",
    source_key: `${driverId}:${type}:${at}`,
    kind,
    subject_kind: "driver",
    vehicle_samsara_id: null,
    trailer_samsara_id: null,
    driver_samsara_id: driverId,
    unit_name: null,
    driver_name: nameOf(v.driver),
    label: str(v.description) ?? type,
    happened_at: at,
    ended_at: at,
    still_active: false,
    samsara_url: null,
    detail: smallDetail({ type, durationMs: typeof v.durationMs === "number" ? v.durationMs : null }),
    updated_at: b.seenAt,
  };
}

/** The lamps one truck shows right now, from its `faultCodes` stat. */
export interface TruckLamps {
  vehicleId: string;
  name: string | null;
  stop: boolean;
  amber: boolean;
  /** Up to three code descriptions, for the desk to read out to the shop. */
  codes: string[];
}

export function truckLamps(raw: unknown): TruckLamps | null {
  const v = obj(raw);
  const id = idOf(v);
  if (!v || !id) return null;
  const name = nameOf(v);
  if (isRetiredUnitName(name)) return null;
  const j = obj(obj(v.faultCodes)?.j1939);
  const lights = obj(j?.checkEngineLights);
  const codes = (Array.isArray(j?.diagnosticTroubleCodes) ? j.diagnosticTroubleCodes : [])
    .map((c) => str(obj(c)?.spnDescription))
    .filter((c): c is string => c !== null)
    .slice(0, 3);
  return {
    vehicleId: id,
    name,
    stop: lights?.stopIsOn === true,
    amber: lights?.warningIsOn === true || lights?.emissionsIsOn === true,
    codes,
  };
}
