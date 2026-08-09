import { qualifyDriver, type Driver, type QualCertSnapshot, type QualState } from "@fuelguard/shared";
import { labelForCode } from "./qualificationRoster";

export interface QualificationRosterRow {
  id: string;
  full_name: string;
  status: string;
  ready: boolean;
  state: QualState;
  issues: string[];
  issueSummary: string;
}

export function buildQualificationRosterRows(
  drivers: readonly Driver[],
  certsByDriver: ReadonlyMap<string, readonly QualCertSnapshot[]>,
  today: string,
  vehicleKind: "cargo_tank" | "van_or_flatbed",
  orgHasSecurityPlan: boolean,
): QualificationRosterRow[] {
  return drivers.map((d) => {
    const certs = certsByDriver.get(d.id) ?? [];
    const res = qualifyDriver({
      evalDate: today,
      driverStatus: d.status,
      certs: [...certs],
      vehicleKind,
      orgHasSecurityPlan,
    });
    const issues = res.findings.map((f) => labelForCode(f.code));
    return {
      id: d.id,
      full_name: d.full_name,
      status: d.status,
      ready: res.qualified,
      state: res.state,
      issues,
      issueSummary: issues.join(", "),
    };
  });
}
