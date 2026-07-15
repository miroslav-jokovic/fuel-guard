/**
 * HERE Routing v8 truck-route request builder + response parser (pure; verified param names/units/enums,
 * audit §A). The live fetch lives in apps/api/src/lib/here.ts — this half is unit-testable without a key.
 * Units: HERE wants grossWeight/weightPerAxle in KG and height/width/length in CM (we store US customary,
 * convert here). Polyline is per-section: decode each and stitch.
 */
import { cmFromInches, kgFromLb } from "./units.js";
import { decodeFlexPolyline, type LatLng } from "./flexPolyline.js";
import type { TruckProfile } from "./types.js";

/** HERE `vehicle[shippedHazardousGoods]` enum (audit-confirmed, exactly these 11). */
export type HazmatClass =
  | "explosive" | "gas" | "flammable" | "combustible" | "organic" | "poison"
  | "radioactive" | "corrosive" | "poisonousInhalation" | "harmfulToWater" | "other";
/** HERE ADR `vehicle[tunnelCategory]` (B least → E most restrictive; no A). */
export type TunnelCategory = "B" | "C" | "D" | "E";

export interface HereRouteRequest {
  origin: LatLng;
  via?: LatLng[];
  destination: LatLng;
  profile: TruckProfile;
  hazmat?: HazmatClass[];
  tunnelCategory?: TunnelCategory | null;
}

/** Build the HERE v8 truck-route URL. apiKey + baseUrl are injected so the pure builder never reads env. */
export function buildTruckRouteUrl(req: HereRouteRequest, apiKey: string, baseUrl = "https://router.hereapi.com/v8/routes"): string {
  // Build the query manually (no URLSearchParams — the shared package is DOM-free/portable).
  const params: [string, string][] = [
    ["transportMode", "truck"],
    ["origin", `${req.origin.lat},${req.origin.lng}`],
  ];
  for (const v of req.via ?? []) params.push(["via", `${v.lat},${v.lng}`]);
  params.push(["destination", `${req.destination.lat},${req.destination.lng}`]);
  params.push(["return", "polyline,summary,actions"]);
  // "fast" (time-optimal) matches commercial truck-nav behaviour (Samsara markets the fastest route); Samsara's
  // map is HERE-powered (2025 partnership) so this maximises corridor agreement with the driver's actual route.
  params.push(["routingMode", "fast"]);
  // Truck restrictions only apply when the vehicle profile is supplied (kg / cm, integer).
  params.push(["vehicle[grossWeight]", String(Math.round(kgFromLb(req.profile.grossWeightLb)))]);
  params.push(["vehicle[height]", String(Math.round(cmFromInches(req.profile.heightIn)))]);
  params.push(["vehicle[width]", String(Math.round(cmFromInches(req.profile.widthIn)))]);
  params.push(["vehicle[length]", String(Math.round(cmFromInches(req.profile.lengthIn)))]);
  params.push(["vehicle[axleCount]", String(req.profile.axleCount)]);
  if (req.hazmat && req.hazmat.length) params.push(["vehicle[shippedHazardousGoods]", req.hazmat.join(",")]);
  if (req.tunnelCategory) params.push(["vehicle[tunnelCategory]", req.tunnelCategory]);
  params.push(["apiKey", apiKey]);
  const qs = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return `${baseUrl}?${qs}`;
}

/** One turn-by-turn maneuver from HERE (defensively typed: any field may be absent in the response). */
export interface RouteStep {
  instruction: string;
  lengthMeters: number;
  durationSeconds: number;
}
export interface ParsedHereRoute {
  polyline: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
}

interface HereAction {
  instruction?: string;
  length?: number;
  duration?: number;
}
interface HereSection {
  polyline?: string;
  summary?: { length?: number; duration?: number };
  actions?: HereAction[];
}
interface HereResponse {
  routes?: { sections?: HereSection[] }[];
  notices?: unknown[];
}

/** Parse a HERE v8 response: stitch the sections' decoded polylines (dedupe join points), sum length+duration. */
export function parseHereRoute(json: unknown): ParsedHereRoute | null {
  const route = (json as HereResponse)?.routes?.[0];
  if (!route || !route.sections || route.sections.length === 0) return null;
  const polyline: LatLng[] = [];
  const steps: RouteStep[] = [];
  let distanceMeters = 0;
  let durationSeconds = 0;
  for (const s of route.sections) {
    if (s.summary?.length) distanceMeters += s.summary.length;
    if (s.summary?.duration) durationSeconds += s.summary.duration;
    for (const a of s.actions ?? []) {
      const instruction = typeof a.instruction === "string" ? a.instruction.trim() : "";
      if (!instruction) continue;
      steps.push({ instruction, lengthMeters: a.length ?? 0, durationSeconds: a.duration ?? 0 });
    }
    if (!s.polyline) continue;
    const pts = decodeFlexPolyline(s.polyline);
    const start = polyline.length > 0 && pts.length > 0 && polyline[polyline.length - 1]!.lat === pts[0]!.lat && polyline[polyline.length - 1]!.lng === pts[0]!.lng ? 1 : 0;
    for (let i = start; i < pts.length; i++) polyline.push(pts[i]!);
  }
  return { polyline, distanceMeters, durationSeconds, steps };
}
