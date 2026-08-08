import { describe, expect, it } from "vitest";
import { qualifyDriver, qualifyOrg, qualificationEvalDate, type QualCertSnapshot } from "./qualificationGate.js";

/**
 * The hazmat qualification gate. This module decides whether a load can ever clear, and until now it
 * had no test at all — the §10.4 predicates were verified only indirectly, through the analysis paths
 * that call them.
 *
 * Two things are being pinned here. The §10.4/§10.5 predicates themselves, as they already behaved;
 * and F-H1's first-run state, whose whole risk is that it reads like a softening of the gate. It is
 * not, and the assertions say so explicitly: `not_started` is never `qualified`, and it never stops
 * carrying the `driver_unqualified:` / `org_unqualified:` prefix that makes a finding unclearable.
 */

const EVAL = "2026-08-08";

const cert = (over: Partial<QualCertSnapshot>): QualCertSnapshot => ({
  kind: "cdl", qualifier: null, trainingType: null, issuedAt: null, expiresAt: null, ...over,
});

/** Everything §10.4 asks of a cargo-tank driver, all of it current at EVAL. */
const fullDriverFile = (): QualCertSnapshot[] => [
  cert({ kind: "cdl", expiresAt: "2027-01-01" }),
  cert({ kind: "medical_card", expiresAt: "2027-01-01" }),
  // Null expiry inherits the CDL's, per §10.4's null rule. X covers both hazmat and tank.
  cert({ kind: "endorsement", qualifier: "X" }),
  cert({ kind: "hazmat_training", trainingType: "general_awareness", issuedAt: "2025-01-01" }),
  cert({ kind: "hazmat_training", trainingType: "function_specific", issuedAt: "2025-01-01" }),
  cert({ kind: "hazmat_training", trainingType: "safety", issuedAt: "2025-01-01" }),
  cert({ kind: "hazmat_training", trainingType: "security_awareness", issuedAt: "2025-01-01" }),
];

const driver = (certs: QualCertSnapshot[], over: Partial<Parameters<typeof qualifyDriver>[0]> = {}) =>
  qualifyDriver({
    evalDate: EVAL, driverStatus: "active", certs,
    vehicleKind: "cargo_tank", orgHasSecurityPlan: false, ...over,
  });

describe("qualifyDriver — the first-run state (F-H1)", () => {
  it("reports an empty file as ONE finding, not one per requirement", () => {
    const res = driver([]);
    expect(res.state).toBe("not_started");
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0]!.code).toBe("driver_unqualified:file_not_started");
  });

  it("is still unqualified — the collapse is a change of wording, not of the gate", () => {
    expect(driver([]).qualified).toBe(false);
  });

  it("keeps the prefix that makes the finding UNCLEARABLE (§10.2)", () => {
    // hazmatReview.ts matches `driver_unqualified:` as a prefix family. If this code ever lost the
    // prefix, an empty qualification file would silently become a supervisor-clearable risk decision.
    for (const f of driver([]).flags) expect(f.startsWith("driver_unqualified:")).toBe(true);
  });

  it("still reports employment separately — that is a fact about the person, not the file", () => {
    const res = driver([], { driverStatus: "terminated" });
    expect(res.state).toBe("not_started");
    expect(res.flags).toEqual([
      "driver_unqualified:file_not_started",
      "driver_unqualified:employment",
    ]);
  });

  it("goes back to naming every gap the moment ONE certification exists", () => {
    const res = driver([cert({ kind: "cdl", expiresAt: "2027-01-01" })]);
    expect(res.state).toBe("incomplete");
    expect(res.flags).not.toContain("driver_unqualified:file_not_started");
    expect(res.flags).toContain("driver_unqualified:medical");
    expect(res.flags).toContain("driver_unqualified:endorsement_hazmat");
  });
});

describe("qualifyDriver — the §10.4 predicates", () => {
  it("passes a complete, current cargo-tank file", () => {
    const res = driver(fullDriverFile());
    expect(res.qualified).toBe(true);
    expect(res.state).toBe("qualified");
    expect(res.findings).toEqual([]);
  });

  it("treats a missing expiry as a data defect, not an eternal licence", () => {
    const certs = fullDriverFile().map((c) => (c.kind === "cdl" ? { ...c, expiresAt: null } : c));
    expect(driver(certs).flags).toContain("driver_unqualified:cdl_no_expiry");
  });

  it("fails an expired medical certificate", () => {
    const certs = fullDriverFile().map((c) => (c.kind === "medical_card" ? { ...c, expiresAt: "2026-08-07" } : c));
    expect(driver(certs).flags).toContain("driver_unqualified:medical");
  });

  it("lets an endorsement with no expiry inherit the CDL's", () => {
    // X has expiresAt null throughout fullDriverFile, and the file passes — so the inheritance works.
    expect(driver(fullDriverFile()).qualified).toBe(true);
    // Expire the CDL and the endorsement goes with it, on top of the CDL's own finding.
    const certs = fullDriverFile().map((c) => (c.kind === "cdl" ? { ...c, expiresAt: "2026-01-01" } : c));
    expect(driver(certs).flags).toContain("driver_unqualified:endorsement_hazmat");
  });

  it("demands a tank endorsement only for cargo tanks", () => {
    const certs = fullDriverFile().map((c) =>
      c.kind === "endorsement" ? { ...c, qualifier: "H" } : c);
    expect(driver(certs).flags).toContain("driver_unqualified:endorsement_tank");
    expect(driver(certs, { vehicleKind: "van_or_flatbed" }).flags).not.toContain("driver_unqualified:endorsement_tank");
  });

  it("expires hazmat training three years from the ISSUED date (§172.704(c)(2))", () => {
    const stale = fullDriverFile().map((c) =>
      c.trainingType === "safety" ? { ...c, issuedAt: "2023-08-07" } : c); // +3y = 2026-08-07 < EVAL
    expect(driver(stale).flags).toContain("driver_unqualified:training_safety");
    const justInside = fullDriverFile().map((c) =>
      c.trainingType === "safety" ? { ...c, issuedAt: "2023-08-08" } : c); // +3y = 2026-08-08 = EVAL
    expect(driver(justInside).qualified).toBe(true);
  });

  it("adds in-depth security training only when the carrier holds a security plan (§172.704(a)(5))", () => {
    expect(driver(fullDriverFile(), { orgHasSecurityPlan: true }).flags)
      .toContain("driver_unqualified:training_in_depth_security");
  });
});

describe("qualifyOrg", () => {
  it("reports an empty carrier file as one finding", () => {
    const res = qualifyOrg({ evalDate: EVAL, certs: [] });
    expect(res.state).toBe("not_started");
    expect(res.qualified).toBe(false);
    expect(res.flags).toEqual(["org_unqualified:file_not_started"]);
  });

  it("names each gap once the file exists", () => {
    const res = qualifyOrg({ evalDate: EVAL, certs: [cert({ kind: "phmsa_registration", expiresAt: "2027-01-01" })] });
    expect(res.state).toBe("incomplete");
    expect(res.flags).toEqual(["org_unqualified:financial_responsibility"]);
  });

  it("passes the two unconditional checks", () => {
    const res = qualifyOrg({
      evalDate: EVAL,
      certs: [
        cert({ kind: "phmsa_registration", expiresAt: "2027-01-01" }),
        cert({ kind: "financial_responsibility", expiresAt: "2027-01-01" }),
      ],
    });
    expect(res.qualified).toBe(true);
    expect(res.state).toBe("qualified");
  });

  it("adds the conditional checks only when the load trips them", () => {
    const certs = [
      cert({ kind: "phmsa_registration", expiresAt: "2027-01-01" }),
      cert({ kind: "financial_responsibility", expiresAt: "2027-01-01" }),
    ];
    expect(qualifyOrg({ evalDate: EVAL, certs, requiresSecurityPlan: true }).flags)
      .toContain("org_unqualified:security_plan");
    expect(qualifyOrg({ evalDate: EVAL, certs, requiresSafetyPermit: true }).flags)
      .toContain("org_unqualified:hazmat_safety_permit");
  });
});

describe("qualificationEvalDate (§10.3)", () => {
  it("uses the planned pickup when there is one", () => {
    expect(qualificationEvalDate("2026-09-01T08:00:00Z", "2026-08-08T00:00:00Z"))
      .toEqual({ evalDate: "2026-09-01T08:00:00Z", usedFallback: false });
  });

  it("falls back to now, and says so — the run records which date it used", () => {
    expect(qualificationEvalDate(null, "2026-08-08T00:00:00Z"))
      .toEqual({ evalDate: "2026-08-08T00:00:00Z", usedFallback: true });
  });
});
