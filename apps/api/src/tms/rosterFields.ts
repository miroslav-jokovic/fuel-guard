import type { TmsDriverInput, TmsVehicleInput, TmsTrailerInput } from "@fuelguard/shared";
import { deriveFullName } from "@fuelguard/shared";

/**
 * What the McLeod sync is allowed to write to a row it owns, and nothing else (M4).
 *
 * `CODEBASE-IMPACT-ANALYSIS.md §5` states the rule this file implements: **the sync writes a fixed
 * allowlist of columns, never a row.** Twelve services write to these three tables, and several own
 * columns that are LEARNED rather than recorded — `tank_capacity_gal` and the sensor-reliability
 * estimates come out of real fill history (`scoring/learnVehicle`), trailer `assigned_vehicle_id` and
 * `pairing_confidence` are inferred from telemetry (`reeferPairing`), the whole 20-column idle
 * envelope is derived. McLeod offers a static spec field for some of those and it is worse than what
 * the product computes. So the allowlist is expressed here as data, and a column added to `drivers` in
 * six months is excluded by default rather than included by accident.
 *
 * ── NEVER WRITE A NULL OVER A GOOD VALUE ────────────────────────────────────────────────────────
 * Every builder below omits a field McLeod did not supply, rather than setting it null. This is not
 * fussiness: McLeod's coverage is uneven — 175 of 190 tractors carry a plate, 209 of 235 trailers a
 * plate state — so a blind full-row write would erase perfectly good data on every sweep for the rows
 * where the carrier simply has not filled a field in. `samsaraDriverSync` learned the same rule the
 * hard way ("a null in one response must never wipe a good stored value").
 *
 * Status and termination are deliberately ABSENT from every builder. Retiring a row is M6, it has
 * retention consequences (`drivers.termination_date` starts the clock and the evidence tables are
 * append-only), and it needs the mass-deactivation guard that M6 brings with it.
 */

/** Fields McLeod owns on a driver row it has claimed. Phone is NOT here — see below. */
export function driverPatch(r: TmsDriverInput): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => {
    if (v !== null && v !== undefined && v !== "") p[k] = v;
  };

  // McLeod stores the surname in `name` and the given name separately, so the display name is
  // COMPOSED here and never parsed. Only written when a surname actually arrived — `full_name` is NOT
  // NULL, and half a name is worse than a stale one.
  const full = deriveFullName({
    first_name: r.first_name ?? null,
    middle_name: r.middle_name ?? null,
    last_name: r.last_name ?? null,
  });
  if (r.last_name && full) set("full_name", full);
  set("first_name", r.first_name);
  set("middle_name", r.middle_name);
  set("last_name", r.last_name);

  // The licence and medical card are the reason this milestone exists. D6 made the Samsara sync write
  // `cdl_number` ONLY when empty, because for telematics the licence is a convenience field and a
  // hand-corrected value must not be reverted. McLeod is the carrier's system of record for driver
  // qualification: these are the values their safety department maintains and would defend in an
  // audit, and they are refreshed on every sweep. The office's escape hatch is unchanged — editing an
  // identity field claims the row to 'manual' (resolveDriverUpdate), after which nothing here runs.
  set("cdl_number", r.cdl_number);
  set("cdl_state", r.cdl_state);
  set("cdl_expires_at", r.cdl_expires_at);
  set("medical_card_expires_at", r.medical_card_expires_at);

  set("hire_date", r.hire_date);
  set("date_of_birth", r.date_of_birth);
  set("address_line1", r.address_line1);
  set("city", r.city);
  set("state", r.state);
  set("postal_code", r.postal_code);

  // `phone` is absent on purpose and must stay absent. McLeod holds no phone number for ANY of its
  // 1,463 driver rows, and `samsaraDriverSync` is the only writer of the 164 FuelGuard has. SMS
  // consent, driver-app invitations and messaging all depend on them.
  return p;
}

export function vehiclePatch(r: TmsVehicleInput): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => {
    if (v !== null && v !== undefined && v !== "") p[k] = v;
  };
  set("vin", r.vin);
  set("make", r.make);
  set("model", r.model);
  set("year", r.year);
  set("plate", r.plate);
  set("plate_state", r.plate_state);
  set("registration_expires_at", r.registration_expires_at);

  // McLeod's `inspection_date` is the date the annual inspection was PERFORMED — 175 of 175 in the
  // past, the exact opposite of every driver date on the same row — while FuelGuard's column is an
  // EXPIRY. The derivation is §396.17's annual interval, done here rather than in the agent so the
  // raw observation crosses the wire unchanged and this assumption stays visible and reviewable.
  if (r.annual_inspection_performed_at) {
    const d = new Date(`${r.annual_inspection_performed_at}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      set("dot_annual_inspection_expires_at", d.toISOString().slice(0, 10));
    }
  }

  // `tank_capacity_gal` is NOT here. It is NOT NULL, it drives fuel detection, and `learnVehicle`
  // refines it from observed fills. McLeod's `tractor.fuel_capacity` is a static spec number, and
  // overwriting a learned capacity with it would silently degrade every fuel anomaly on that truck.
  // Same reasoning excludes the idle envelope and `odometer_offset`.
  return p;
}

export function trailerPatch(r: TmsTrailerInput): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => {
    if (v !== null && v !== undefined && v !== "") p[k] = v;
  };
  set("vin", r.vin);
  set("make", r.make);
  set("year", r.year);
  set("plate", r.plate);
  set("plate_state", r.plate_state);
  // A boolean is written even when false: `is_reefer` defaults to false and McLeod's trailer_type is
  // authoritative in both directions, so `set`'s null-skip would wrongly pin a mis-flagged trailer.
  if (typeof r.is_reefer === "boolean") p.is_reefer = r.is_reefer;

  // `unit_number` is NOT written. FuelGuard prefixes reefers with `R` and McLeod does not; the ingest
  // normalises for MATCHING and leaves the stored value alone, because renaming ~46 trailers is a
  // user-visible decision for a human (D-MR11). `assigned_vehicle_id`, `pairing_source` and
  // `pairing_confidence` are excluded for a stronger reason: reeferPairing INFERS them from telemetry,
  // and McLeod's `tractor_id`/`is_hooked` are dispatch's intent — a measured answer beats a planned one.
  return p;
}
