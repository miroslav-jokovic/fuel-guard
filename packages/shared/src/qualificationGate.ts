/** Local date helper — self-contained so FuelGuard need not port the full compliance contract. */
function addYearsIso(iso: string, years: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00.000Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/**
 * The hazmat qualification gate (PLAN §5, §5.1) — PURE, no DB (M3.1). The API assembles the
 * snapshots; these functions decide. Every predicate is §10.4/§10.5 verbatim, and every failure
 * carries its citation, because the finding ends up in front of a reviewer (and, in M12, in the
 * roadside packet).
 *
 * Clearability: every code emitted here is UNCLEARABLE (§10.2) — an expired medical card is a
 *   legal disqualification, not a risk decision a supervisor is entitled to make. Enforced by
 *   prefix matching in hazmatReview.ts, asserted in tests there.
 * Evaluation date (§10.3): evalDate = load.planned_pickup_at ?? now. When the fallback is used the
 *   caller adds `qualification_evaluated_at_now` (tier info) so the run records which date it used.
 */

export interface QualCertSnapshot {
  kind: string;                    // certifications.kind
  qualifier: string | null;        // endorsement letter
  trainingType: string | null;     // §172.704(a) type
  issuedAt: string | null;         // ISO date
  expiresAt: string | null;        // ISO date
}

export interface QualFinding {
  /** Flag code, e.g. `driver_unqualified:medical` — prefix-matched into UNCLEARABLE (§10.2). */
  code: string;
  message: string;
  citation: string;
}

export interface QualResult {
  qualified: boolean;
  findings: QualFinding[];
  /** The flag codes alone (what lands in hazmat_runs.flags). */
  flags: string[];
}

export interface DriverQualInput {
  /** ISO date/time the load is evaluated at (§10.3 — planned_pickup_at, or now as fallback). */
  evalDate: string;
  driverStatus: string | null;     // drivers.status; null = no driver row resolved
  /** CURRENT certifications for the driver (superseded_by is null). */
  certs: QualCertSnapshot[];
  /** §10.4: tank endorsement is demanded only for cargo tanks. */
  vehicleKind: "cargo_tank" | "van_or_flatbed";
  /** §10.4: in_depth_security training is required only when the org holds a security plan. */
  orgHasSecurityPlan: boolean;
}

const D = (code: string, message: string, citation: string): QualFinding =>
  ({ code: `driver_unqualified:${code}`, message, citation });

/** §10.4 required training types; in_depth_security joins when the org holds a security plan. */
export const REQUIRED_TRAINING_TYPES = ["general_awareness", "function_specific", "safety", "security_awareness"] as const;

const dateOf = (iso: string): string => iso.slice(0, 10);

/** §10.4 — exact predicates, in the plan's own order. */
export function qualifyDriver(input: DriverQualInput): QualResult {
  const findings: QualFinding[] = [];
  const evalDate = dateOf(input.evalDate);
  const current = (kind: string, qualifier?: string): QualCertSnapshot | undefined =>
    input.certs.find((c) => c.kind === kind && (qualifier === undefined || c.qualifier === qualifier));

  // cdl / medical_card — expiry REQUIRED; a null expiry is a data defect, not an eternal licence.
  const cdl = current("cdl");
  if (!cdl) findings.push(D("cdl", "No current CDL certification on file.", "49 CFR §391.51(b)(6)"));
  else if (cdl.expiresAt == null) findings.push(D("cdl_no_expiry", "The CDL on file records no expiry date — a data defect, not an eternal licence.", "49 CFR §391.51(b)(6)"));
  else if (dateOf(cdl.expiresAt) < evalDate) findings.push(D("cdl", `CDL expired ${dateOf(cdl.expiresAt)} — before the evaluation date.`, "49 CFR §391.51(b)(6)"));

  const med = current("medical_card");
  if (!med) findings.push(D("medical", "No current medical certificate on file.", "49 CFR §391.43"));
  else if (med.expiresAt == null) findings.push(D("medical_no_expiry", "The medical certificate on file records no expiry date.", "49 CFR §391.43"));
  else if (dateOf(med.expiresAt) < evalDate) findings.push(D("medical", `Medical certificate expired ${dateOf(med.expiresAt)}.`, "49 CFR §391.43"));

  // Endorsements — a null expiry INHERITS the CDL expiry (§10.4's null rule).
  const endorsementCurrent = (letter: string): boolean => {
    const e = current("endorsement", letter);
    if (!e) return false;
    const expiry = e.expiresAt ?? cdl?.expiresAt ?? null;
    return expiry != null && dateOf(expiry) >= evalDate;
  };
  if (!endorsementCurrent("H") && !endorsementCurrent("X")) {
    findings.push(D("endorsement_hazmat", "No current H or X endorsement — the driver may not transport placardable hazmat.", "49 CFR §383.93"));
  }
  if (input.vehicleKind === "cargo_tank" && !endorsementCurrent("N") && !endorsementCurrent("X")) {
    findings.push(D("endorsement_tank", "This is a cargo-tank load and the driver holds no current N or X endorsement.", "49 CFR §383.93"));
  }

  // Hazmat training — §172.704(c)(2): recurrent every three years, judged from ISSUED date, per
  // REQUIRED TYPE (§172.704(a) — five distinct requirements, not one).
  const required: string[] = [...REQUIRED_TRAINING_TYPES];
  if (input.orgHasSecurityPlan) required.push("in_depth_security");
  for (const t of required) {
    const rows = input.certs.filter((c) => c.kind === "hazmat_training" && c.trainingType === t && c.issuedAt != null);
    const fresh = rows.some((c) => addYearsIso(dateOf(c.issuedAt!), 3) >= evalDate);
    if (!fresh) {
      findings.push(D(`training_${t}`,
        `No ${t.replace(/_/g, " ")} hazmat training completed within 3 years of the evaluation date.`,
        t === "in_depth_security" ? "49 CFR §172.704(a)(5)" : "49 CFR §172.704(c)(2)"));
    }
  }

  // Employment.
  if (input.driverStatus !== "active") {
    findings.push(D("employment", `Driver employment status is '${input.driverStatus ?? "unknown"}', not active.`, "49 CFR §391 (driver qualification)"));
  }

  return { qualified: findings.length === 0, findings, flags: findings.map((f) => f.code) };
}

export interface OrgQualInput {
  evalDate: string;
  /** CURRENT organization-level certifications. */
  certs: QualCertSnapshot[];
}

const O = (code: string, message: string, citation: string): QualFinding =>
  ({ code: `org_unqualified:${code}`, message, citation });

/**
 * §10.5 — v1 runs the UNCONDITIONAL org checks only. `hazmat_safety_permit` and `security_plan`
 * are conditional on material lists not present in the dataset (M9); their absence is stated in
 * the audit packet, never silently assumed satisfied.
 */
export function qualifyOrg(input: OrgQualInput): QualResult {
  const findings: QualFinding[] = [];
  const evalDate = dateOf(input.evalDate);
  const check = (kind: string, code: string, label: string, citation: string) => {
    const c = input.certs.find((x) => x.kind === kind);
    if (!c) findings.push(O(code, `No current ${label} on file for the carrier.`, citation));
    else if (c.expiresAt == null) findings.push(O(`${code}_no_expiry`, `The ${label} on file records no expiry date.`, citation));
    else if (dateOf(c.expiresAt) < evalDate) findings.push(O(code, `${label} expired ${dateOf(c.expiresAt)}.`, citation));
  };
  check("phmsa_registration", "phmsa_registration", "PHMSA hazmat registration", "49 CFR Part 107 subpart G");
  check("financial_responsibility", "financial_responsibility", "financial-responsibility (insurance) certification", "49 CFR §387.9");
  return { qualified: findings.length === 0, findings, flags: findings.map((f) => f.code) };
}

/** §10.3 — which date to evaluate at, and whether the info flag must be added. */
export function qualificationEvalDate(plannedPickupAt: string | null | undefined, nowIso: string): { evalDate: string; usedFallback: boolean } {
  return plannedPickupAt
    ? { evalDate: plannedPickupAt, usedFallback: false }
    : { evalDate: nowIso, usedFallback: true };
}

/** Info flag recorded when §10.3's fallback was used. */
export const QUALIFICATION_EVAL_AT_NOW_FLAG = "qualification_evaluated_at_now";
