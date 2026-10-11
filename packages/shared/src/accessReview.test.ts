import { describe, expect, it } from "vitest";
import {
  ACCESS_REVIEW_COLUMNS,
  REVIEW_SCREENS,
  accessReviewCsv,
  reviewMembers,
  screenAnswer,
  sectionAnswer,
  whoHasAccess,
} from "./accessReview.js";
import type { AccessReviewMember, AccessReviewState } from "./accessReviewContract.js";
import { accessReviewStateSchema } from "./accessReviewContract.js";
import { APP_SECTIONS, EDITABLE_ROLES, EDITABLE_SECTIONS, sectionAccess } from "./auth.js";
import { ADMIN_ONLY_SURFACES, GRANTABLE_SURFACES, SURFACES } from "./surfaceCatalogue.js";
import type { Surface } from "./surfaces.js";
import { USER_ROLE_LABELS } from "./constants.js";

/**
 * SP10 (Q-SET10) — the reverse view and the access-review file.
 *
 * What is pinned is the thing an auditor relies on: that each answer is the one the product
 * ENFORCES, and that the layer named beside it is the one that decided it. The precedence cases are
 * the four the plan names — a person's answer over their role's, a role's over the shipped default,
 * an admin-only screen, and a screen whose section the person does not hold — plus the two gates
 * that sit outside the three layers: a locked role, and a module the org has not enabled.
 */
const m = (userId: string, role: AccessReviewMember["role"], extra: Partial<AccessReviewMember> = {}): AccessReviewMember => ({
  userId,
  email: `${userId}@carrier.test`,
  fullName: null,
  role,
  suspendedAt: null,
  ...extra,
});

const empty = (over: Partial<AccessReviewState> = {}): AccessReviewState => ({
  orgName: "Silvicom Test Carrier",
  members: [],
  roleSections: {},
  userSections: {},
  roleSurfaces: {},
  userSurfaces: {},
  modules: [],
  ...over,
});

const screen = (key: string): Surface => SURFACES.find((s) => s.key === key)!;

describe("a section's answer and the layer that gave it", () => {
  const disp = m("u-disp", "dispatcher");

  it("falls to the shipped default when no layer answered", () => {
    const a = sectionAnswer(empty(), disp, "dispatch");
    expect(a).toEqual({ granted: true, answer: "Manage", layer: "default" });
    expect(sectionAnswer(empty(), disp, "safety")).toEqual({ granted: false, answer: "None", layer: "default" });
  });

  it("a role override beats the shipped default", () => {
    // Shipped `none` for a dispatcher; the org opened Safety to the whole role.
    expect(sectionAccess("dispatcher", "safety")).toBe("none");
    const s = empty({ roleSections: { dispatcher: { safety: "view" } } });
    expect(sectionAnswer(s, disp, "safety")).toEqual({ granted: true, answer: "View", layer: "role" });
  });

  it("a per-person override beats a role override", () => {
    const s = empty({ roleSections: { dispatcher: { safety: "view" } }, userSections: { "u-disp": { safety: "none" } } });
    expect(sectionAnswer(s, disp, "safety")).toEqual({ granted: false, answer: "None", layer: "user" });
    // …and only for that person: a second dispatcher still follows the role.
    expect(sectionAnswer(s, m("u-disp2", "dispatcher"), "safety").layer).toBe("role");
  });

  it("never honours a row for a locked role, and names the lock", () => {
    const admin = m("u-admin", "admin");
    const s = empty({ roleSections: { admin: { fuel: "none" } }, userSections: { "u-admin": { fuel: "none" } } });
    expect(sectionAnswer(s, admin, "fuel")).toEqual({ granted: true, answer: "Manage", layer: "locked" });
    // The `admin` section is uneditable for every role (D-PERM7).
    expect(sectionAnswer(empty(), m("u-fm", "fleet_manager"), "admin")).toEqual({
      granted: false,
      answer: "None",
      layer: "locked",
    });
  });

  // Every editable cell, with a role answer that differs from the default: the value the review
  // reports is the value written, and it says the role gave it. Walks the whole matrix so a section
  // or role added later is covered without editing this test.
  it("agrees with the role layer across the whole editable matrix", () => {
    for (const role of EDITABLE_ROLES) {
      for (const section of EDITABLE_SECTIONS) {
        const other = sectionAccess(role, section) === "manage" ? "none" : "manage";
        const s = empty({ roleSections: { [role]: { [section]: other } } });
        const a = sectionAnswer(s, m("u", role), section);
        expect(a.answer.toLowerCase(), `${role}/${section}`).toBe(other);
        expect(a.layer).toBe("role");
      }
    }
  });
});

describe("a screen's answer and the layer that gave it", () => {
  it("an admin-only screen opens for an admin and for nobody else, whatever rows exist", () => {
    const card = screen("admin.settings.card-control");
    const s = empty({ userSurfaces: { "u-fm": { "admin.settings.card-control": true } } });
    expect(screenAnswer(s, m("u-admin", "admin"), card)).toEqual({ granted: true, answer: "Open", layer: "admin_only" });
    expect(screenAnswer(s, m("u-fm", "fleet_manager"), card)).toEqual({
      granted: false,
      answer: "Closed",
      layer: "admin_only",
    });
  });

  it("a screen whose section is none is closed by the section, even with a personal allow", () => {
    const ifta = screen("fuel.ifta");
    expect(sectionAccess("technician", "fuel")).toBe("none");
    const s = empty({ userSurfaces: { "u-tech": { "fuel.ifta": true } } });
    expect(screenAnswer(s, m("u-tech", "technician"), ifta)).toEqual({ granted: false, answer: "Closed", layer: "section" });
    // Grant the section to that person and the screen's own answer applies again.
    const granted = { ...s, userSections: { "u-tech": { fuel: "view" as const } } };
    expect(screenAnswer(granted, m("u-tech", "technician"), ifta)).toEqual({ granted: true, answer: "Open", layer: "user" });
  });

  it("a person's answer beats the role's, and the role's beats the starting default", () => {
    const org = screen("admin.settings.org");
    const fm = m("u-fm", "fleet_manager");
    // Q-SET2: Organization starts off for every editable role.
    expect(screenAnswer(empty(), fm, org)).toEqual({ granted: false, answer: "Closed", layer: "default" });
    const roleOn = empty({ roleSurfaces: { fleet_manager: { "admin.settings.org": true } } });
    expect(screenAnswer(roleOn, fm, org)).toEqual({ granted: true, answer: "Open", layer: "role" });
    const personOff = { ...roleOn, userSurfaces: { "u-fm": { "admin.settings.org": false } } };
    expect(screenAnswer(personOff, fm, org)).toEqual({ granted: false, answer: "Closed", layer: "user" });
  });

  it("a screen in a module the org has not enabled opens for nobody", () => {
    const loads = screen("dispatch.loads");
    expect(loads.module).toBe("dispatch");
    expect(screenAnswer(empty(), m("u-admin", "admin"), loads)).toEqual({ granted: false, answer: "Closed", layer: "module" });
    expect(screenAnswer(empty({ modules: ["dispatch"] }), m("u-admin", "admin"), loads).granted).toBe(true);
  });

  it("names the lock for an admin on a grantable screen", () => {
    expect(screenAnswer(empty(), m("u-admin", "admin"), screen("admin.settings.org"))).toEqual({
      granted: true,
      answer: "Open",
      layer: "locked",
    });
  });
});

describe("who is listed", () => {
  const state = empty({
    members: [
      m("u-b", "dispatcher", { fullName: "Bea" }),
      m("u-a", "fleet_manager", { fullName: "Ann" }),
      m("u-drv", "driver", { fullName: "Dan Driver" }),
      m("u-s", "dispatcher", { fullName: "Sam", suspendedAt: "2026-09-29T00:00:00Z" }),
    ],
  });

  it("leaves driver-app logins out, as the Users page does, and keeps the suspended apart", () => {
    const { active, suspended } = reviewMembers(state);
    expect(active.map((x) => x.fullName)).toEqual(["Ann", "Bea"]);
    expect(suspended.map((x) => x.fullName)).toEqual(["Sam"]);
  });

  it("splits holders from the rest and never counts a suspended member as a holder", () => {
    const r = whoHasAccess(state, { kind: "section", section: "dispatch" });
    expect(r.holders.map((x) => x.member.fullName)).toEqual(["Ann", "Bea"]);
    expect(r.without).toEqual([]);
    expect(r.suspended.map((x) => [x.member.fullName, x.answer.answer])).toEqual([["Sam", "Manage"]]);
    const acc = whoHasAccess(state, { kind: "section", section: "accounting" });
    expect(acc.holders).toEqual([]);
    expect(acc.without.map((x) => x.member.fullName)).toEqual(["Ann", "Bea"]);
  });
});

describe("the screens a review covers", () => {
  it("is every grantable screen and every admin-only screen, and nothing detail-level", () => {
    for (const s of GRANTABLE_SURFACES) expect(REVIEW_SCREENS).toContain(s);
    for (const s of ADMIN_ONLY_SURFACES) expect(REVIEW_SCREENS).toContain(s);
    expect(REVIEW_SCREENS.length).toBe(new Set([...GRANTABLE_SURFACES, ...ADMIN_ONLY_SURFACES]).size);
    expect(REVIEW_SCREENS.some((s) => s.parent !== undefined)).toBe(false);
  });
});

describe("the access-review file", () => {
  const state = empty({
    orgName: "=Acme, Inc.",
    members: [
      m("u-a", "fleet_manager", { fullName: "Ann" }),
      m("u-s", "dispatcher", { fullName: "Sam", suspendedAt: "2026-09-29T00:00:00Z" }),
      m("u-drv", "driver"),
    ],
    userSections: { "u-a": { accounting: "view" } },
  });

  it("opens with a row naming the org and the export date, formula-guarded and quoted", () => {
    const out = accessReviewCsv(state, "09/30/2026");
    const [first, header] = out.csv.split("\r\n");
    expect(first).toContain(`"'=Acme, Inc."`);
    expect(first).toContain("Exported 09/30/2026");
    expect(first).toContain("1 suspended");
    expect(header).toBe(ACCESS_REVIEW_COLUMNS.join(","));
  });

  it("lists every active member × every section and reviewed screen, and nobody else", () => {
    const out = accessReviewCsv(state, "09/30/2026");
    expect(out.members).toBe(1);
    expect(out.suspended).toBe(1);
    expect(out.rows).toBe(APP_SECTIONS.length + REVIEW_SCREENS.length);
    expect(out.csv.split("\r\n")).toHaveLength(2 + out.rows);
    expect(out.csv).not.toContain("Sam");
  });

  it("writes the effective answer and the layer that gave it", () => {
    const FM = USER_ROLE_LABELS.fleet_manager;
    const lines = accessReviewCsv(state, "09/30/2026").csv.split("\r\n");
    expect(lines).toContain(`Ann,u-a@carrier.test,${FM},Section,Accounting,accounting,View,Personal`);
    expect(lines).toContain(`Ann,u-a@carrier.test,${FM},Section,Fuel,fuel,Manage,Default`);
    expect(lines).toContain(
      `Ann,u-a@carrier.test,${FM},Screen,Settings › Card control,admin.settings.card-control,Closed,Admin only`,
    );
  });
});

describe("the contract", () => {
  it("accepts the state the tests above resolve", () => {
    expect(accessReviewStateSchema.safeParse(empty({ members: [m("u", "auditor")] })).success).toBe(true);
    expect(accessReviewStateSchema.safeParse({ ...empty(), modules: ["not-a-module"] }).success).toBe(false);
  });
});
