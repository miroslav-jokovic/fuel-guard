import type { HazmatCreateLoadRequest } from "@fuelguard/shared";
import { buildEngineLines, emptyLine, type CalcLineForm } from "./calcModel";

/**
 * Load Workspace create-form model + pure form→request logic (plan H5). Kept import-light (no supabase)
 * so it unit-tests headless — the composables add the Vue Query wiring. A load's `declared_lines` are the
 * same engine `LoadInput` lines the calculator builds, so line editing is shared with calcModel.
 */
export interface LoadForm {
  vehicleId: string; // "" = none
  trailerId: string; // "" = none
  driverId: string;
  tankState: string;
  carrierRelationship: string;
  plannedPickupAt: string; // datetime-local value or ""
  claimedNoPlacards: boolean;
  specialPermitNumbers: string; // comma-separated DOT-SP numbers
  lines: CalcLineForm[];
}

export const CARRIER_RELATIONSHIP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "unknown", label: "Unknown" },
  { value: "carrier_supplied_cargo_tank", label: "Carrier-supplied cargo tank" },
  { value: "shipper_supplied_common_carrier", label: "Shipper-supplied (common carrier)" },
  { value: "private_carrier", label: "Private carrier" },
];

export function emptyLoadForm(): LoadForm {
  return {
    vehicleId: "",
    trailerId: "",
    driverId: "",
    tankState: "loaded",
    carrierRelationship: "unknown",
    plannedPickupAt: "",
    claimedNoPlacards: false,
    specialPermitNumbers: "",
    lines: [emptyLine()],
  };
}

/** Split a comma-separated list into trimmed, non-empty items (commas only — DOT-SP numbers can contain spaces). */
export function parseList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function loadFormHasProduct(form: LoadForm): boolean {
  return form.lines.some((l) => l.product !== null);
}

/**
 * Build the `POST /hazmat/loads` body. `id` is client-generated (idempotency, 02 §10.2). Enum fields are
 * validated server-side by the request schema; `plannedPickupAt` is passed through as-is (ISO / null).
 */
export function buildCreateLoadRequest(id: string, form: LoadForm): HazmatCreateLoadRequest {
  const body = {
    id,
    vehicleId: form.vehicleId || null,
    trailerId: form.trailerId || null,
    driverId: form.driverId || null,
    tankState: form.tankState,
    carrierRelationship: form.carrierRelationship,
    plannedPickupAt: form.plannedPickupAt ? new Date(form.plannedPickupAt).toISOString() : null,
    declaredLines: buildEngineLines(form.lines),
    specialPermitNumbers: parseList(form.specialPermitNumbers),
    claimedNoPlacards: form.claimedNoPlacards,
    supersedesLoadId: null,
  };
  return body as unknown as HazmatCreateLoadRequest;
}
