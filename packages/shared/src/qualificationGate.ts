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

/**
 * Why a subject is not qualified, at a glance (F-H1).
 *
 * `not_started` and `incomplete` are both fail-closed and both unclearable — the distinction is not a
 * softening of the gate, it is an honest reading of the evidence. A driver with nothing on file
 * produces seven findings that all restate one fact, and an organization with nothing on file
 * produces two more; eleven red rows on a fleet's first day look like a broken product rather than an
 * empty filing cabinet, and that is how a real disqualification later gets ignored.
 *
 * The collapse loses nothing: when there are zero certifications there is nothing subject-specific to
 * record. "No CDL on file, no medical on file, no H endorsement on file" is one sentence written
 * seven times. As soon as a single certification exists the gate goes back to naming every gap,
 * because from then on each one is a distinct fact about a real file.
 */
export type QualState = "qualified" | "not_started" | "incomplete";

export interface QualResult {
  qualified: boolean;
  /** Which of the three shapes this is — see QualState. Never softens `qualified`. */
  state: QualState;
  findings: QualFinding[];
  /** The flag codes alone (what lands in hazmat_runs.flags). */
  flags: string[];
}

const result = (findings: QualFinding[], state?: QualState): QualResult => ({
  qualified: findings.length === 0,
  state: state ?? (findings.length === 0 ? "qualified" : "incomplete"),
  findings,
  flags: findings.map((f) => f.code),
});

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

  // Employment is a fact about the person, not about the filing cabinet: a terminated driver is
  // disqualified whether or not anyone ever started their file. So it is computed first and survives
  // the first-run collapse below.
  const employment: QualFinding[] = input.driverStatus !== "active"
    ? [D("employment", `Driver employment status is '${input.driverStatus ?? "unknown"}', not active.`, "49 CFR §391 (driver qualification)")]
    : [];

  // FIRST RUN (F-H1). Still unqualified, still unclearable — the `driver_unqualified:` prefix is what
  // hazmatReview.ts matches on, so nothing about clearability changes here.
  if (input.certs.length === 0) {
    return result([
      D("file_not_started",
        "No certifications have been recorded for this driver yet — their qualification file has not been started. It needs a CDL, a medical certificate, an H or X endorsement, and current hazmat training.",
        "49 CFR §391.51 (driver qualification file)"),
      ...employment,
    ], "not_started");
  }
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

  // Employment — computed at the top so it survives the first-run collapse; appended here to keep
  // the plan's finding order unchanged.
  findings.push(...employment);

  return result(findings);
}

export interface OrgQualInput {
  evalDate: string;
  /** CURRENT organization-level certifications. */
  certs: QualCertSnapshot[];
  /** M9 (§5.1 conditional): the load trips the §172.800(b) large-bulk security-plan criterion.
   *  Computed from the load's materials by the DB-facing gate (provisional applicability, SME-pending). */
  requiresSecurityPlan?: boolean;
  /** M9 (§5.1 conditional): the load trips the §385.403(b) explosives safety-permit criterion — the one
   *  dataset-evaluable §385.403 category (provisional applicability, SME attestation pending). */
  requiresSafetyPermit?: boolean;
}

const O = (code: string, message: string, citation: string): QualFinding =>
  ({ code: `org_unqualified:${code}`, message, citation });

/**
 * §10.5 — v1 runs the two UNCONDITIONAL org checks always (PHMSA registration, financial
 * responsibility) plus two CONDITIONAL checks when the load trips them (M9, both PROVISIONAL /
 * SME-attestation-pending): `security_plan` (§172.800(b) large-bulk) and `safety_permit`
 * (§385.403(b) explosives — the one dataset-evaluable §385.403 category). Both are UNCLEARABLE and
 * never silently assumed satisfied; the other §385.403 categories remain the hazmat-trained backstop.
 */
export function qualifyOrg(input: OrgQualInput): QualResult {
  const findings: QualFinding[] = [];
  const evalDate = dateOf(input.evalDate);

  // FIRST RUN (F-H1) — the carrier's own file. Every check below is certification-derived, so with
  // nothing on file there is no partial state to describe, only a filing cabinet nobody has opened.
  if (input.certs.length === 0) {
    return result([
      O("file_not_started",
        "No certifications have been recorded for this carrier yet — its compliance file has not been started. It needs a PHMSA hazmat registration and a financial-responsibility certification.",
        "49 CFR Part 107 subpart G"),
    ], "not_started");
  }
  const check = (kind: string, code: string, label: string, citation: string) => {
    const c = input.certs.find((x) => x.kind === kind);
    if (!c) findings.push(O(code, `No current ${label} on file for the carrier.`, citation));
    else if (c.expiresAt == null) findings.push(O(`${code}_no_expiry`, `The ${label} on file records no expiry date.`, citation));
    else if (dateOf(c.expiresAt) < evalDate) findings.push(O(code, `${label} expired ${dateOf(c.expiresAt)}.`, citation));
  };
  check("phmsa_registration", "phmsa_registration", "PHMSA hazmat registration", "49 CFR Part 107 subpart G");
  check("financial_responsibility", "financial_responsibility", "financial-responsibility (insurance) certification", "49 CFR §387.9");
  // M9 (§172.800(b), PROVISIONAL — SME attestation pending): a large-bulk Division 2.1 / Class 3 PG I/II
  // load requires the carrier to maintain a current security plan. UNCLEARABLE like the others.
  if (input.requiresSecurityPlan) {
    check("security_plan", "security_plan", "§172.800 security plan (provisional applicability — SME attestation pending)", "49 CFR §172.800(b)");
  }
  // M9 (§385.403(b), PROVISIONAL — SME attestation pending): a large-explosives load (Division 1.1/1.2/1.3
  // over 25 kg, or a placardable Division 1.5) requires the carrier to hold a current FMCSA safety permit.
  if (input.requiresSafetyPermit) {
    check("hazmat_safety_permit", "hazmat_safety_permit", "§385.403 FMCSA safety permit (provisional applicability — SME attestation pending)", "49 CFR §385.403(b)");
  }
  return result(findings);
}

/** §10.3 — which date to evaluate at, and whether the info flag must be added. */
export function qualificationEvalDate(plannedPickupAt: string | null | undefined, nowIso: string): { evalDate: string; usedFallback: boolean } {
  return plannedPickupAt
    ? { evalDate: plannedPickupAt, usedFallback: false }
    : { evalDate: nowIso, usedFallback: true };
}

/** Info flag recorded when §10.3's fallback was used. */
export const QUALIFICATION_EVAL_AT_NOW_FLAG = "qualification_evaluated_at_now";
