import type { QualCertSnapshot, QualState } from "@fuelguard/shared";

export interface DriverRosterCert {
  subject_id: string;
  kind: string;
  qualifier: string | null;
  training_type: string | null;
  issued_at: string | null;
  expires_at: string | null;
}

export const QUAL_TONE: Record<QualState, string> = {
  qualified: "success",
  incomplete: "danger",
  not_started: "neutral",
};

export const QUAL_LABEL: Record<QualState, string> = {
  qualified: "ready",
  incomplete: "action required",
  not_started: "not started",
};

export function labelForCode(code: string): string {
  const c = code
    .replace(/^driver_unqualified:/, "")
    .replace(/^training_/, "training: ")
    .replace(/_/g, " ");
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export function certsByDriver(
  certs: readonly DriverRosterCert[],
): Map<string, QualCertSnapshot[]> {
  const m = new Map<string, QualCertSnapshot[]>();
  for (const c of certs) {
    const arr = m.get(c.subject_id) ?? [];
    arr.push({
      kind: c.kind,
      qualifier: c.qualifier,
      trainingType: c.training_type,
      issuedAt: c.issued_at,
      expiresAt: c.expires_at,
    });
    m.set(c.subject_id, arr);
  }
  return m;
}
