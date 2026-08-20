import { buildPspDraft, type CarrierIdentity, type PspDriverIdentity } from "./identity.js";
import { validatePspRequest } from "./validate.js";

/**
 * Who could be screened today, and what exactly is stopping the rest (P0b).
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 * On 2026-08-20 the production roster held 201 active drivers, a licence for 166 of them and a date
 * of birth for **none** — so the answer to "how many drivers can we screen" was zero, and no screen
 * in the product said so. The PSP integration was complete and unusable, and the reason was data
 * entry the UI made a 201-visit job.
 *
 * ── IT ASKS THE VALIDATOR, NOT A CHECKLIST ─────────────────────────────────────────────────────
 * Every row here is judged by `validatePspRequest` — the same function the order path runs, over a
 * draft built by the same `buildPspDraft`. A readiness screen with its own idea of what PSP needs
 * would drift from the request that actually gets sent, and the drift costs money to discover: PSP
 * charges the transaction fee on Failure (§8), so a driver this screen called ready and PSP refuses
 * is a wasted purchase, not a validation error.
 *
 * Consent is deliberately assumed TRUE when building the draft. The signed authorization is a
 * separate gate the order path owns (`missingAuthorizations`), and folding it in here would report
 * every driver as "not ready" for a reason that has nothing to do with their identity data — which
 * is the one thing this report is about.
 */

export interface ScreeningGap {
  field: string;
  message: string;
}

export interface ScreeningRow {
  driverId: string;
  name: string;
  status: string;
  ready: boolean;
  /** What PSP would refuse, in the validator's own words. Empty when ready. */
  gaps: ScreeningGap[];
}

export interface ScreeningSummary {
  drivers: number;
  ready: number;
  /** How many drivers each missing field is blocking — what to fix first, by size. */
  blockedBy: Array<{ field: string; drivers: number }>;
  carrierSource: CarrierIdentity["source"];
}

export interface ScreeningReadiness {
  rows: ScreeningRow[];
  summary: ScreeningSummary;
}

/** The field names the validator uses, in the words an operator would use for them. */
export const SCREENING_FIELD_LABELS: Record<string, string> = {
  driverDOB: "Date of birth",
  driverFirstName: "First name",
  driverLastName: "Last name",
  "licenseQueries.0.dlNum": "Licence number",
  "licenseQueries.0.dlState": "Licence state",
  "licenseQueries.0.dlFirstName": "Licence first name",
  "licenseQueries.0.dlLastName": "Licence last name",
  dotNumber: "Carrier DOT number",
  internalRefId: "Internal reference",
  driverConsent: "Driver authorization",
};

export const screeningFieldLabel = (field: string): string =>
  SCREENING_FIELD_LABELS[field] ?? field;

export function screeningReadiness(
  drivers: readonly (PspDriverIdentity & { status: string })[],
  carrier: CarrierIdentity,
  today: string,
): ScreeningReadiness {
  const blocked = new Map<string, number>();

  const rows = drivers.map((driver): ScreeningRow => {
    const draft = buildPspDraft({
      driver,
      carrier,
      internalRefId: driver.id,
      // The signed release is the order path's gate, not this report's subject. See the header.
      consent: true,
    });
    const gaps = validatePspRequest(draft, today).map((issue) => ({
      field: issue.field,
      message: issue.message,
    }));
    for (const gap of gaps) blocked.set(gap.field, (blocked.get(gap.field) ?? 0) + 1);
    return {
      driverId: driver.id,
      name: driver.full_name,
      status: driver.status,
      ready: gaps.length === 0,
      gaps,
    };
  });

  return {
    rows,
    summary: {
      drivers: rows.length,
      ready: rows.filter((r) => r.ready).length,
      blockedBy: [...blocked.entries()]
        .map(([field, count]) => ({ field, drivers: count }))
        .sort((a, b) => b.drivers - a.drivers || a.field.localeCompare(b.field)),
      carrierSource: carrier.source,
    },
  };
}
