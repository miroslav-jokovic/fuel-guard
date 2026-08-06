import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  qualifyDriver, qualifyOrg, qualificationEvalDate,
  type QualCertSnapshot, type QualFinding,
} from "@fuelguard/shared";

/**
 * Qualification gate — the DB-facing half (M3.2). Assembles the snapshots, calls the PURE gate
 * (packages/shared/qualificationGate.ts), and returns everything the analysis paths need: the
 * blocking flags, the findings with citations (run evidence, hazmat_runs.qualification — 0007),
 * and a CANONICAL INPUT DIGEST for the extraction cache key (§10.10: the gate's findings are part
 * of the verdict now, so a cached verdict must be keyed by the qualification inputs too — renew a
 * medical card and the same photo MUST re-evaluate).
 */

export interface QualificationEvaluation {
  flags: string[];
  driverFindings: QualFinding[];
  orgFindings: QualFinding[];
  evalDate: string;
  usedFallback: boolean;
  /** sha256 over the canonical qualification inputs — a §10.10 hash term. */
  inputsDigest: string;
  /** The 0007 run-evidence payload. */
  record: {
    evalDate: string;
    usedFallback: boolean;
    driver: QualFinding[];
    org: QualFinding[];
  };
}

const CERT_SNAPSHOT_COLS = "kind, qualifier, training_type, issued_at, expires_at";

interface CertRow { kind: string; qualifier: string | null; training_type: string | null; issued_at: string | null; expires_at: string | null }
const toSnapshot = (c: CertRow): QualCertSnapshot => ({
  kind: c.kind, qualifier: c.qualifier, trainingType: c.training_type, issuedAt: c.issued_at, expiresAt: c.expires_at,
});

function canonical(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(x as Record<string, unknown>).sort()) o[k] = norm((x as Record<string, unknown>)[k]);
      return o;
    }
    return x;
  };
  return JSON.stringify(norm(v));
}

export async function evaluateQualification(
  admin: SupabaseClient, orgId: string,
  load: { driver_id: string | null; planned_pickup_at: string | null },
  vehicleKind: "cargo_tank" | "van_or_flatbed",
  nowIso: string,
): Promise<QualificationEvaluation> {
  const { evalDate, usedFallback } = qualificationEvalDate(load.planned_pickup_at, nowIso);

  const [orgCertsRes, driverRes, driverCertsRes] = await Promise.all([
    admin.from("certifications").select(CERT_SNAPSHOT_COLS)
      .eq("org_id", orgId).eq("subject_type", "organization").is("superseded_by", null),
    load.driver_id
      ? admin.from("drivers").select("id, status").eq("org_id", orgId).eq("id", load.driver_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    load.driver_id
      ? admin.from("certifications").select(CERT_SNAPSHOT_COLS)
          .eq("org_id", orgId).eq("subject_type", "driver").eq("subject_id", load.driver_id).is("superseded_by", null)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const orgCerts = ((orgCertsRes.data ?? []) as CertRow[]).map(toSnapshot);
  const orgHasSecurityPlan = orgCerts.some((c) => c.kind === "security_plan");

  let driverFindings: QualFinding[];
  const driverCerts = ((driverCertsRes.data ?? []) as CertRow[]).map(toSnapshot);
  const driverStatus = (driverRes.data as { status: string } | null)?.status ?? null;
  if (!load.driver_id) {
    // Fail-closed (documented in PLAN v1.15): a load with NO assigned driver cannot demonstrate a
    // qualified driver, so it cannot clear. Analysis still runs — the dispatcher sees the verdict —
    // but the flag keeps `cleared` unreachable until a qualified driver is assigned and re-analyzed.
    driverFindings = [{
      code: "driver_unqualified:unassigned",
      message: "No driver is assigned to this load — a qualified driver must be assigned before it can clear (§5).",
      citation: "49 CFR §177.800(c) / PLAN §5",
    }];
  } else {
    driverFindings = qualifyDriver({ evalDate, driverStatus, certs: driverCerts, vehicleKind, orgHasSecurityPlan }).findings;
  }

  const orgFindings = qualifyOrg({ evalDate, certs: orgCerts }).findings;

  const inputsDigest = createHash("sha256").update(canonical({
    evalDate: evalDate.slice(0, 10), usedFallback,
    driverId: load.driver_id, driverStatus, driverCerts, orgCerts, vehicleKind,
  })).digest("hex");

  return {
    flags: [...driverFindings, ...orgFindings].map((f) => f.code),
    driverFindings, orgFindings, evalDate, usedFallback, inputsDigest,
    record: { evalDate, usedFallback, driver: driverFindings, org: orgFindings },
  };
}
