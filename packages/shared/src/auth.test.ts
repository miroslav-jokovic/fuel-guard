import { describe, it, expect } from "vitest";
import {
  APP_SECTIONS,
  EDITABLE_ROLES,
  EDITABLE_SECTIONS,
  UNEDITABLE_ROLES,
  effectiveSectionAccess,
  emailDomain,
  isEmailDomainAllowed,
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
  /**
   * `canManageFleet` was DELETED by R0 (D-ROS7) and its test with it. It was `admin || fleet_manager`,
   * hand-written beside a matrix that said something else, and `session.canManage` built the whole web
   * on it — which is why a safety_manager held `roster: manage` and saw a read-only screen. Its members
   * live on as `rolesThatManage("settings")`, asserted below, because ten of the fifty call sites
   * genuinely meant "may configure the product" and had no section to say so in.
   */
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
  it("dispatcher: manages Dispatch, reads Fuel + Roster + Equipment, no Safety/Admin", () => {
    expect(canManageSection("dispatcher", "dispatch")).toBe(true);
    expect(canViewSection("dispatcher", "fuel")).toBe(true);
    expect(canManageSection("dispatcher", "fuel")).toBe(false);
    expect(canViewSection("dispatcher", "roster")).toBe(true);
    expect(canManageSection("dispatcher", "roster")).toBe(false);
    expect(canViewSection("dispatcher", "equipment")).toBe(true);
    expect(canManageSection("dispatcher", "equipment")).toBe(false);
    expect(canViewSection("dispatcher", "safety")).toBe(false);
    expect(canViewSection("dispatcher", "admin")).toBe(false);
  });
  /**
   * THE D-ROS12 ROW. This is the case that forced `fleet` apart on 2026-08-30: a safety manager owns
   * the §391.51 qualification file, so they must WRITE driver rows — and has no business editing a
   * tractor's plate or VIN, which the single `fleet` section handed them as a side effect. Under one
   * section neither half could be said without the other, so the product said it twice instead, in a
   * hand-written `canManageFleet` that disagreed with the matrix. Both halves are pinned here so the
   * two cannot drift back together.
   */
  it("safety_manager: manages Safety + Roster, READS Equipment, reads Fuel, no Dispatch/Admin", () => {
    expect(canManageSection("safety_manager", "safety")).toBe(true);
    expect(canManageSection("safety_manager", "roster")).toBe(true);
    expect(canViewSection("safety_manager", "equipment")).toBe(true);
    expect(canManageSection("safety_manager", "equipment")).toBe(false);
    expect(canViewSection("safety_manager", "fuel")).toBe(true);
    expect(canManageSection("safety_manager", "fuel")).toBe(false);
    expect(canViewSection("safety_manager", "dispatch")).toBe(false);
    expect(canViewSection("safety_manager", "admin")).toBe(false);
  });
  it("admin manages everything incl. Admin; auditor views all but manages none; driver sees no section", () => {
    for (const s of ["fuel", "dispatch", "safety", "roster", "equipment", "recruitment", "admin"] as const) expect(canManageSection("admin", s)).toBe(true);
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
    // The recruiter's whole shape: hiring, and nothing else. `roster: view` is what lets them open a
    // driver's §391.51 file at all (routes/compliance.ts gates on rolesThatCanView("roster")); it is
    // deliberately not "manage" — the one write they need is granted by name in 0212.
    expect(canViewSection("recruiter", "roster")).toBe(true);
    expect(canManageSection("recruiter", "roster")).toBe(false);
    // `equipment: none` is the NARROWING the D-ROS12 split made possible. Under `fleet: view` a
    // recruiter could read the tractor and trailer lists; nobody hiring a driver needs them.
    expect(canViewSection("recruiter", "equipment")).toBe(false);
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
    // D-ROS12: these two lines are the whole split, and they are what R0a's Done-when names.
    expect(rolesThatManage("roster").sort()).toEqual(["admin", "fleet_manager", "safety_manager"]);
    expect(rolesThatManage("equipment").sort()).toEqual(["admin", "fleet_manager"]);
    // 0277 mirrors the equipment line into vehicles_write / trailers_write. The view side is wider
    // than the manage side on purpose — a dispatcher and a safety manager both READ the truck list.
    // `technician` joins the readers 2026-08-31 (0279, D-AVI11) and ONLY the readers: the inspector
    // must find unit 654 in the list, and 0277's ruling that a machine's plate and VIN are the fleet
    // manager's record is unchanged by a new role turning up to inspect it.
    expect(rolesThatCanView("equipment").sort()).toEqual(["admin", "auditor", "dispatcher", "fleet_manager", "safety_manager", "technician"]);
    expect(rolesThatCanView("roster").sort()).toEqual(["admin", "auditor", "dispatcher", "fleet_manager", "recruiter", "safety_manager"]);
    // Mirrored by driver_employment_history's write policy (0208) and its restrictive read (0209).
    expect(rolesThatManage("recruitment").sort()).toEqual(["admin", "fleet_manager", "recruiter", "safety_manager"]);
    expect(rolesThatCanView("recruitment").sort()).toEqual(["admin", "auditor", "fleet_manager", "recruiter", "safety_manager"]);
    expect(rolesThatCanView("fuel").sort()).toEqual(["accountant", "admin", "auditor", "dispatcher", "fleet_manager", "safety_manager"]);
    // ── the finance sections (0266, D-SEP7): the money role and the admin manage the books; the
    // auditor reads them; ops roles get NOTHING — the recruiter lesson applied on day one ──────────
    expect(rolesThatManage("accounting").sort()).toEqual(["accountant", "admin"]);
    expect(rolesThatManage("billing").sort()).toEqual(["accountant", "admin"]);
    expect(rolesThatCanView("accounting").sort()).toEqual(["accountant", "admin", "auditor"]);
    expect(rolesThatCanView("billing").sort()).toEqual(["accountant", "admin", "auditor"]);
    // maintenance: the shop is ops (admin + fleet_manager manage); the bookkeeper and the auditor read
    // — plus the `technician` who actually turns the wrench (0279, D-AVI11, 2026-08-31)
    expect(rolesThatManage("maintenance").sort()).toEqual(["admin", "fleet_manager", "technician"]);
    // `settings` (R0): the operations console. Its members are EXACTLY the deleted canManageFleet
    // set, and that is the point — R0 said what the 50 web call sites meant without re-deciding who
    // may do what. The auditor reads it for the audit-log card; safety_manager does not, because
    // maintaining the §391.51 file is no reason to re-sync Samsara.
    expect(rolesThatManage("settings").sort()).toEqual(["admin", "fleet_manager"]);
    expect(rolesThatCanView("settings").sort()).toEqual(["admin", "auditor", "fleet_manager"]);
    expect(sectionAccess("safety_manager", "settings")).toBe("none");
    expect(rolesThatCanView("maintenance").sort()).toEqual(["accountant", "admin", "auditor", "fleet_manager", "technician"]);
    // ── `technician` (0279, D-AVI11): the shop floor and NOTHING else ─────────────────────────────
    // Asserted as a whole row rather than section by section, because the failure this guards is a
    // section quietly widening later — the recruiter leak was exactly that, and it was found by
    // reading, not by a test.
    expect(sectionAccess("technician", "maintenance")).toBe("manage");
    expect(sectionAccess("technician", "equipment")).toBe("view");
    for (const section of APP_SECTIONS) {
      if (section === "maintenance" || section === "equipment") continue;
      expect(sectionAccess("technician", section), section).toBe("none");
    }
    // The narrowing that is the reason this role exists at all: a technician reads the tractor list
    // and may not edit it (D-ROS12's argument), and never sees a driver.
    expect(canManageSection("technician", "equipment")).toBe(false);
    expect(canViewSection("technician", "roster")).toBe(false);
    // ...and the reverse never happened: adding a role must not widen an existing one.
    expect(rolesThatManage("equipment").sort()).toEqual(["admin", "fleet_manager"]);
    // and the narrowing that matters: dispatch/fleet access never implies books access
    expect(sectionAccess("dispatcher", "accounting")).toBe("none");
    expect(sectionAccess("fleet_manager", "billing")).toBe("none");
    expect(sectionAccess("accountant", "dispatch")).toBe("none");
  });
});

describe("claimsToContext", () => {
  it("maps a fully-claimed JWT", () => {
    expect(
      claimsToContext({ sub: "u1", email: "a@b.com", org_id: "o1", user_role: "fleet_manager", iat: 1_700_000_000 }),
    ).toEqual({
      userId: "u1",
      email: "a@b.com",
      orgId: "o1",
      role: "fleet_manager",
      sections: null,
      issuedAt: 1_700_000_000,
    });
  });
  it("carries the org's overrides through from the same verified token (D-PERM2)", () => {
    expect(
      claimsToContext({ sub: "u1", org_id: "o1", user_role: "dispatcher", sections: { safety: "view" } }).sections,
    ).toEqual({ safety: "view" });
  });
  it("nulls org/role when the user has no membership (audit B3)", () => {
    expect(claimsToContext({ sub: "u1" })).toEqual({
      userId: "u1",
      email: null,
      orgId: null,
      role: null,
      /**
       * Null, and read as "no overrides" — the OPPOSITE of `issuedAt` below, deliberately. Every
       * token minted before migration 0292 is in this state, so failing closed here would refuse
       * the whole product for one token lifetime, while failing closed on freshness is the entire
       * point of that gate.
       */
      sections: null,
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
      // 0237. A TESTING record, and the opposite call to psp_report's for the same structural
      // reason: §40.305 documentation states that a driver had a drug or alcohol programme violation
      // and what a substance abuse professional concluded about it.
      "return_to_duty",
    ]);
  });

  /**
   * ⚠ The half of 0237 that is easy to get wrong, so it is pinned rather than described.
   *
   * A recruiter hiring an applicant is TOLD the §40.25(j) block exists — `previewHire` returns a
   * boolean, and the flag it reads is a column on `drivers`, not a testing record. They cannot read
   * the document that lifts it. That division is the point: the recruiter needs to know the driver
   * cannot be dispatched, and §382.401(a) does not let them hold the file that says why.
   */
  it("return-to-duty documentation is a testing record, so the recruiter cannot read it", () => {
    expect(canReadRestrictedKind("return_to_duty", "recruiter")).toBe(false);
    expect(canReadRestrictedKind("return_to_duty", "safety_manager")).toBe(true);
    expect(canReadRestrictedKind("return_to_duty", "admin")).toBe(true);
    expect(canReadRestrictedKind("return_to_duty", "fleet_manager")).toBe(false);
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

// ── Per-org overrides (D-PERM1/4/7/8, EDITABLE-PERMISSIONS-PLAN.md P1) ────────
describe("the editable surface", () => {
  it("is seven roles by eleven sections — every role but admin and driver, every section but admin", () => {
    expect(EDITABLE_ROLES).toEqual([
      "fleet_manager", "auditor", "dispatcher", "safety_manager", "recruiter", "accountant", "technician",
    ]);
    expect(EDITABLE_SECTIONS).not.toContain("admin");
    expect(EDITABLE_SECTIONS.length).toBe(APP_SECTIONS.length - 1);
  });

  it("derives by subtraction, so a role added to the product is editable unless excluded on purpose", () => {
    for (const r of USER_ROLES) {
      expect(EDITABLE_ROLES.includes(r) || (UNEDITABLE_ROLES as readonly string[]).includes(r)).toBe(true);
    }
  });
});

describe("effectiveSectionAccess", () => {
  it("returns the shipped default when the org has overridden nothing", () => {
    expect(effectiveSectionAccess("dispatcher", "safety", null)).toBe("none");
    expect(effectiveSectionAccess("dispatcher", "safety", {})).toBe("none");
  });

  /**
   * The sparseness is the design (D-PERM4). An ABSENT pair must read as "unchanged", never as
   * "denied" — if absence meant denial, the first org to override one cell would lose every other.
   */
  it("leaves untouched pairs at their default when one cell is overridden", () => {
    const overrides = { dispatcher: { safety: "view" as const } };
    expect(effectiveSectionAccess("dispatcher", "safety", overrides)).toBe("view");
    expect(effectiveSectionAccess("dispatcher", "dispatch", overrides)).toBe("manage");
    expect(effectiveSectionAccess("dispatcher", "recruitment", overrides)).toBe("none");
  });

  it("widens and narrows, because the ruling was 'fully editable' (D-PERM7)", () => {
    expect(sectionAccess("recruiter", "equipment")).toBe("none");
    expect(effectiveSectionAccess("recruiter", "equipment", { recruiter: { equipment: "view" } })).toBe("view");
    expect(effectiveSectionAccess("fleet_manager", "fuel", { fleet_manager: { fuel: "none" } })).toBe("none");
  });

  /**
   * The locks have to hold in the RESOLVER too, not only at the write path. A row for admin or for
   * the admin section cannot be written — 0291's CHECK constraints refuse it and the endpoint
   * refuses it first — so reaching this branch means a row exists that should not, and honouring it
   * would turn a bad row into a privilege escalation.
   */
  it("ignores an override for the admin role, however it got there", () => {
    expect(effectiveSectionAccess("admin", "fuel", { admin: { fuel: "none" } })).toBe("manage");
  });

  it("ignores an override for the driver role", () => {
    expect(effectiveSectionAccess("driver", "fuel", { driver: { fuel: "manage" } })).toBe("none");
  });

  it("ignores an override granting the admin section, which is the escalation path", () => {
    expect(effectiveSectionAccess("fleet_manager", "admin", { fleet_manager: { admin: "manage" } })).toBe("none");
    expect(effectiveSectionAccess("auditor", "admin", { auditor: { admin: "view" } })).toBe("none");
  });

  it("still answers 'none' for no role at all", () => {
    expect(effectiveSectionAccess(null, "fuel", { admin: { fuel: "manage" } })).toBe("none");
  });
});
