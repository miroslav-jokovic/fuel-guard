import { describe, it, expect } from "vitest";
import {
  emailDomain,
  isEmailDomainAllowed,
  canManageFleet,
  canResolveAnomalies,
  isAdmin,
  isReadOnly,
  claimsToContext,
  inviteCreateSchema,
  sectionAccess,
  canViewSection,
  canManageSection,
  rolesThatManage,
  rolesThatCanView,
  RESTRICTED_QUALIFICATION_KINDS,
  canReadAllRestricted,
  canWriteDriverLifecycle,
  canArchiveDriver,
  canReadInvestigationHistory,
  canReadRestrictedKind,
  canReadTestingRecords,
  filterRestrictedRows,
  QUALIFICATION_RECORD_KINDS,
  USER_ROLES,
} from "./index.js";

describe("emailDomain", () => {
  it("extracts and lowercases the domain", () => {
    expect(emailDomain("Miki@Silvicominc.com")).toBe("silvicominc.com");
  });
  it("returns null for malformed addresses", () => {
    expect(emailDomain("nope")).toBeNull();
    expect(emailDomain("@x.com")).toBeNull();
    expect(emailDomain("user@")).toBeNull();
  });
});

describe("isEmailDomainAllowed (audit M2)", () => {
  const allowed = ["silvicominc.com"];
  it("allows an exact (case-insensitive) domain match", () => {
    expect(isEmailDomainAllowed("dana@silvicominc.com", allowed)).toBe(true);
    expect(isEmailDomainAllowed("DANA@SILVICOMINC.COM", allowed)).toBe(true);
  });
  it("rejects other domains and lookalikes", () => {
    expect(isEmailDomainAllowed("dana@silvicominc.com.evil.com", allowed)).toBe(false);
    expect(isEmailDomainAllowed("dana@gmail.com", allowed)).toBe(false);
    expect(isEmailDomainAllowed("garbage", allowed)).toBe(false);
  });
});

describe("role helpers", () => {
  it("gates fleet management to admin + fleet_manager", () => {
    expect(canManageFleet("admin")).toBe(true);
    expect(canManageFleet("fleet_manager")).toBe(true);
    expect(canManageFleet("driver")).toBe(false);
    expect(canManageFleet("auditor")).toBe(false);
    expect(canManageFleet(null)).toBe(false);
  });
  it("identifies admin and read-only roles", () => {
    expect(isAdmin("admin")).toBe(true);
    expect(isReadOnly("auditor")).toBe(true);
    expect(isReadOnly("driver")).toBe(false);
  });
  it("lets admin, fleet_manager AND safety_manager resolve anomalies (Safety action)", () => {
    expect(canResolveAnomalies("admin")).toBe(true);
    expect(canResolveAnomalies("fleet_manager")).toBe(true);
    expect(canResolveAnomalies("safety_manager")).toBe(true);
    expect(canResolveAnomalies("dispatcher")).toBe(false);
    expect(canResolveAnomalies("auditor")).toBe(false);
    expect(canResolveAnomalies(null)).toBe(false);
  });
});

describe("section capability matrix", () => {
  it("dispatcher: manages Dispatch, reads Fuel + Fleet, no Safety/Admin", () => {
    expect(canManageSection("dispatcher", "dispatch")).toBe(true);
    expect(canViewSection("dispatcher", "fuel")).toBe(true);
    expect(canManageSection("dispatcher", "fuel")).toBe(false);
    expect(canViewSection("dispatcher", "fleet")).toBe(true);
    expect(canManageSection("dispatcher", "fleet")).toBe(false);
    expect(canViewSection("dispatcher", "safety")).toBe(false);
    expect(canViewSection("dispatcher", "admin")).toBe(false);
  });
  it("safety_manager: manages Safety + Fleet, reads Fuel, no Dispatch/Admin", () => {
    expect(canManageSection("safety_manager", "safety")).toBe(true);
    expect(canManageSection("safety_manager", "fleet")).toBe(true);
    expect(canViewSection("safety_manager", "fuel")).toBe(true);
    expect(canManageSection("safety_manager", "fuel")).toBe(false);
    expect(canViewSection("safety_manager", "dispatch")).toBe(false);
    expect(canViewSection("safety_manager", "admin")).toBe(false);
  });
  it("admin manages everything incl. Admin; auditor views all but manages none; driver sees no section", () => {
    for (const s of ["fuel", "dispatch", "safety", "fleet", "recruitment", "admin"] as const) expect(canManageSection("admin", s)).toBe(true);
    expect(canViewSection("auditor", "safety")).toBe(true);
    expect(canManageSection("auditor", "safety")).toBe(false);
    expect(canViewSection("driver", "fuel")).toBe(false);
    expect(sectionAccess(null, "fuel")).toBe("none");
  });
  /**
   * Recruitment (2026-08-19). These assertions exist because the section's whole point is the
   * dispatcher row: the surface shipped gated on `fleet`, which handed a dispatcher every driver's
   * former employers and their contact details. §391.53(a)(1) puts the investigation history with
   * "those who are involved in the hiring decision", and this is where that is said once.
   */
  it("recruitment: hiring roles manage it, the auditor reads it, and the dispatcher cannot see it at all", () => {
    expect(canManageSection("admin", "recruitment")).toBe(true);
    expect(canManageSection("fleet_manager", "recruitment")).toBe(true);
    expect(canManageSection("safety_manager", "recruitment")).toBe(true);
    expect(canManageSection("recruiter", "recruitment")).toBe(true);
    // The recruiter's whole shape: hiring, and nothing else. `fleet: view` is what lets them open a
    // driver's §391.51 file at all (routes/compliance.ts gates on rolesThatCanView("fleet")); it is
    // deliberately not "manage", which would also hand them vehicles and trailers.
    expect(canViewSection("recruiter", "fleet")).toBe(true);
    expect(canManageSection("recruiter", "fleet")).toBe(false);
    for (const s of ["fuel", "dispatch", "safety", "hazmat", "admin"] as const) {
      expect(canViewSection("recruiter", s)).toBe(false);
    }
    // A DOT audit is exactly the reader who asks for the §391.23 investigation file.
    expect(canViewSection("auditor", "recruitment")).toBe(true);
    expect(canManageSection("auditor", "recruitment")).toBe(false);
    // The narrowing. A dispatcher reads Fleet to see who is on which truck; that is not a reason to
    // read where somebody worked in 2022.
    expect(canViewSection("dispatcher", "recruitment")).toBe(false);
    expect(canViewSection("driver", "recruitment")).toBe(false);
  });
  /**
   * The recruiter creates and edits an applicant's driver row and stops there. Terminating is a fleet
   * act: it stamps `termination_date` (the §391.51(c) retention clock) and ends the driver's app
   * access, since `auth_driver_id()` resolves only `active` rows.
   */
  it("driver lifecycle: the fleet managers move somebody's employment, the recruiter does not", () => {
    const allowed = USER_ROLES.filter((r) => canWriteDriverLifecycle(r));
    expect(allowed.sort()).toEqual(["admin", "fleet_manager", "safety_manager"]);
    expect(canWriteDriverLifecycle("recruiter")).toBe(false);
    expect(canWriteDriverLifecycle(null)).toBe(false);
  });
  /**
   * `canArchiveDriver` (migration 0235) follows the LIST, not the table.
   *
   * Archiving is not a lifecycle act — it starts no retention clock and ends no driver-app session —
   * so it is deliberately not `canWriteDriverLifecycle`. What it changes is which of two lists
   * somebody has to read, and the two lists have two owners: the applicant board is the recruiter's,
   * Fleet → Drivers is the fleet's. Pinned as a matrix rather than as examples, because the failure
   * mode is a role quietly gaining or losing one half.
   */
  describe("canArchiveDriver", () => {
    it("lets the recruiter tidy the applicant board and nothing else", () => {
      expect(canArchiveDriver("recruiter", "applicant")).toBe(true);
      for (const status of ["active", "inactive", "on_leave", "terminated"]) {
        expect(canArchiveDriver("recruiter", status)).toBe(false);
      }
    });

    it("lets fleet managers archive anybody on the roster, applicants included", () => {
      const both = USER_ROLES.filter(
        (r) => canArchiveDriver(r, "active") && canArchiveDriver(r, "applicant"),
      );
      expect(both.sort()).toEqual(["admin", "fleet_manager", "safety_manager"]);
    });

    it("refuses every role that manages neither section, and a missing role", () => {
      for (const r of ["dispatcher", "auditor", "driver"] as const) {
        expect(canArchiveDriver(r, "applicant")).toBe(false);
        expect(canArchiveDriver(r, "active")).toBe(false);
      }
      expect(canArchiveDriver(null, "applicant")).toBe(false);
      expect(canArchiveDriver(undefined, "active")).toBe(false);
    });

    /**
     * A null status is what a partially-read row looks like. It must fall to the FLEET gate rather
     * than the recruitment one: treating "unknown" as "applicant" would hand a recruiter the whole
     * roster on a read that happened to omit a column.
     */
    it("treats an unknown status as roster, not as applicant", () => {
      expect(canArchiveDriver("recruiter", null)).toBe(false);
      expect(canArchiveDriver("fleet_manager", null)).toBe(true);
    });
  });

  it("rolesThatManage/rolesThatCanView expose the matrix for guard building", () => {
    expect(rolesThatManage("dispatch").sort()).toEqual(["admin", "dispatcher", "fleet_manager"]);
    expect(rolesThatManage("safety").sort()).toEqual(["admin", "fleet_manager", "safety_manager"]);
    expect(rolesThatManage("fleet").sort()).toEqual(["admin", "fleet_manager", "safety_manager"]);
    // Mirrored by driver_employment_history's write policy (0208) and its restrictive read (0209).
    expect(rolesThatManage("recruitment").sort()).toEqual(["admin", "fleet_manager", "recruiter", "safety_manager"]);
    expect(rolesThatCanView("recruitment").sort()).toEqual(["admin", "auditor", "fleet_manager", "recruiter", "safety_manager"]);
    expect(rolesThatCanView("fuel").sort()).toEqual(["admin", "auditor", "dispatcher", "fleet_manager", "safety_manager"]);
  });
});

describe("claimsToContext", () => {
  it("maps a fully-claimed JWT", () => {
    expect(
      claimsToContext({ sub: "u1", email: "a@b.com", org_id: "o1", user_role: "fleet_manager", iat: 1_700_000_000 }),
    ).toEqual({ userId: "u1", email: "a@b.com", orgId: "o1", role: "fleet_manager", issuedAt: 1_700_000_000 });
  });
  it("nulls org/role when the user has no membership (audit B3)", () => {
    expect(claimsToContext({ sub: "u1" })).toEqual({
      userId: "u1",
      email: null,
      orgId: null,
      role: null,
      // A token with no `iat` yields null, and every step-up gate reads null as "not fresh". Failing
      // closed on an absent claim is the property, not an accident — see middleware/requireFreshAuth.ts.
      issuedAt: null,
    });
  });
});

describe("inviteCreateSchema", () => {
  it("accepts a valid invite", () => {
    expect(inviteCreateSchema.safeParse({ email: "x@y.com", role: "driver" }).success).toBe(true);
  });
  it("rejects a bad email or role", () => {
    expect(inviteCreateSchema.safeParse({ email: "x", role: "driver" }).success).toBe(false);
    expect(inviteCreateSchema.safeParse({ email: "x@y.com", role: "boss" }).success).toBe(false);
  });
});

/**
 * Phase G (D-DQ15) — the restricted-records vocabulary. The exhaustive classification below is the
 * point, not a formality: every qualification-record kind must appear in exactly one of the two
 * lists, so adding a sixteenth kind FORCES a decision about whether it is access-restricted rather
 * than silently defaulting to world-readable.
 */
describe("restricted qualification records (Phase G)", () => {
  const NOT_RESTRICTED = [
    "employment_application", "mvr", "annual_mvr_review", "road_test", "cdl_equivalency",
    "eldt", "spe_certificate", "medical_registry_verification", "accident",
  ] as const;

  it("classifies every qualification-record kind, exhaustively", () => {
    const classified = [...RESTRICTED_QUALIFICATION_KINDS, ...NOT_RESTRICTED].sort();
    expect(classified).toEqual([...QUALIFICATION_RECORD_KINDS].sort());
  });

  it("pins the restricted set", () => {
    expect([...RESTRICTED_QUALIFICATION_KINDS].sort()).toEqual([
      "alcohol_test", "clearinghouse_full", "clearinghouse_limited",
      "drug_test", "previous_employer_inquiry", "previous_employer_response",
      // 0217. Investigation history, not a testing record — so the recruiter who ordered it can
      // read it, which is the whole reason the split exists.
      "psp_report",
    ]);
  });

  /**
   * The split (2026-08-19). One flag became two because the two regulations behind it are addressed
   * to different people: §382.401(a) is a custody rule about testing records, §391.53(a)(1) puts the
   * investigation history with "those who are involved in the hiring decision". A recruiter who
   * cannot read a previous-employer response cannot do the job §391.23(a)(2) assigns them.
   */
  it("§382.401 testing records stay with admin + safety_manager — the split did not widen them", () => {
    const allowed = USER_ROLES.filter((r) => canReadTestingRecords(r));
    expect(allowed.sort()).toEqual(["admin", "safety_manager"]);
    expect(canReadTestingRecords(null)).toBe(false);
    expect(canReadTestingRecords("recruiter")).toBe(false);
  });

  it("§391.53 investigation history adds the recruiter, and nobody else", () => {
    const allowed = USER_ROLES.filter((r) => canReadInvestigationHistory(r));
    expect(allowed.sort()).toEqual(["admin", "recruiter", "safety_manager"]);
    expect(canReadInvestigationHistory(null)).toBe(false);
    expect(canReadInvestigationHistory("fleet_manager")).toBe(false);
  });

  it("canReadRestrictedKind answers per KIND, because a recruiter's answer is no longer uniform", () => {
    expect(canReadRestrictedKind("previous_employer_response", "recruiter")).toBe(true);
    // The recruiter spends the money on this one; they must be able to open it.
    expect(canReadRestrictedKind("psp_report", "recruiter")).toBe(true);
    expect(canReadRestrictedKind("psp_report", "dispatcher")).toBe(false);
    expect(canReadRestrictedKind("drug_test", "recruiter")).toBe(false);
    expect(canReadRestrictedKind("clearinghouse_full", "recruiter")).toBe(false);
    // An unrestricted kind is readable by anyone the section guard already admitted.
    expect(canReadRestrictedKind("mvr", "dispatcher")).toBe(true);
  });

  it("a whole-file operation needs BOTH halves — the binder cannot express a partial grant", () => {
    const allowed = USER_ROLES.filter((r) => canReadAllRestricted(r));
    expect(allowed.sort()).toEqual(["admin", "safety_manager"]);
    expect(canReadAllRestricted("recruiter")).toBe(false);
  });

  it("filterRestrictedRows drops per row, so a recruiter keeps the inquiry and loses the drug test", () => {
    const rows = [{ kind: "mvr" }, { kind: "drug_test" }, { kind: "previous_employer_response" }];
    expect(filterRestrictedRows(rows, "dispatcher").map((r) => r.kind)).toEqual(["mvr"]);
    expect(filterRestrictedRows(rows, "auditor").map((r) => r.kind)).toEqual(["mvr"]);
    expect(filterRestrictedRows(rows, "recruiter").map((r) => r.kind)).toEqual([
      "mvr",
      "previous_employer_response",
    ]);
    expect(filterRestrictedRows(rows, "safety_manager")).toHaveLength(3);
    expect(filterRestrictedRows(rows, "admin")).toHaveLength(3);
  });
});
