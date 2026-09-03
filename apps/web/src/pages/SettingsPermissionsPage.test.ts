import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import {
  APP_SECTIONS,
  EDITABLE_ROLES,
  EDITABLE_SECTIONS,
  NAV_SURFACES,
  USER_ROLE_LABELS,
  isEditableSurface,
  sectionAccess,
} from "@silvicom/shared";
import SettingsPermissionsPage from "@/pages/SettingsPermissionsPage.vue";

/**
 * The permissions page (SURFACE-ENTITLEMENTS-PLAN.md S6).
 *
 * ── WHAT IS WORTH PINNING, AND WHY IT IS THESE ──────────────────────────────────────────────────
 * The transport is mocked and everything else is real: the tabs, the matrix, the screen grid, the
 * three-state per-person controls and the sidebar preview are the shipped components, so these
 * assertions fail when the page changes what it SAYS or what it SENDS.
 *
 *  · **The two staleness contracts must not be averaged.** A section change lands on the member's
 *    next token refresh — up to an hour (D-PERM6); a screen change lands on their next page load
 *    (D-SURF4). One sentence for both would be wrong for one of them, and which one is wrong depends
 *    on which control was used.
 *  · **The per-user write takes THREE values.** `access: null` / `allowed: null` is "inherit", and it
 *    is stored as the absence of a row. A two-state control here would be unable to express what the
 *    API takes, and an admin could never undo an answer.
 *  · **A cell has to say which layer answered.** Shipped default → org role override → person
 *    override (D-SURF6); without the marker "reset" and "set to this value" are the same control.
 *  · **A surface may only narrow within its section (D-SURF2).** A screen whose section the role does
 *    not hold offers no control — it explains itself.
 *  · **The page must not imply it governs everything** while S7 is outstanding.
 */
const ROLE = "technician";
/** "Technician (shop)" — read from shared so a relabelled role does not silently unhook these tests. */
const ROLE_LABEL = USER_ROLE_LABELS[ROLE];

/** Built the way the API builds it, so the fixture cannot drift from what the endpoint sends. */
const defaults = Object.fromEntries(
  EDITABLE_ROLES.map((r) => [r, Object.fromEntries(APP_SECTIONS.map((s) => [s, sectionAccess(r, s)]))]),
);
const catalogue = NAV_SURFACES.filter(isEditableSurface).map((s) => ({
  key: s.key,
  label: s.label,
  group: s.group,
  section: s.gate.kind === "section" ? s.gate.section : null,
  level: s.gate.kind === "section" ? s.gate.level : null,
}));

const state = vi.hoisted(() => ({
  sections: null as unknown,
  surfaces: null as unknown,
  members: null as unknown,
  memberSections: null as unknown,
  memberSurfaces: null as unknown,
}));
const calls = vi.hoisted(() => ({
  setRoleSection: [] as unknown[],
  setRoleSurface: [] as unknown[],
  setMemberSection: [] as unknown[],
  setMemberSurface: [] as unknown[],
}));
const toasts = vi.hoisted(() => ({ success: [] as Array<[string, string?]>, error: [] as unknown[] }));

vi.mock("@/features/permissions/usePermissions", async () => {
  const { ref: r, computed } = await import("vue");
  const query = (get: () => unknown) => ({ data: computed(get), isPending: r(false) });
  const mutation = (sink: unknown[]) => ({
    mutateAsync: vi.fn(async (v: unknown) => {
      sink.push(v);
    }),
    isPending: r(false),
  });
  return {
    useSectionAccessQuery: () => query(() => state.sections),
    useSurfaceAccessQuery: () => query(() => state.surfaces),
    useMembersQuery: () => query(() => state.members),
    useMemberSectionAccessQuery: () => query(() => state.memberSections),
    useMemberSurfaceAccessQuery: () => query(() => state.memberSurfaces),
    useSetRoleSection: () => mutation(calls.setRoleSection),
    useSetRoleSurface: () => mutation(calls.setRoleSurface),
    useSetMemberSection: () => mutation(calls.setMemberSection),
    useSetMemberSurface: () => mutation(calls.setMemberSurface),
  };
});
vi.mock("@/composables/useModules", () => ({ useModulesQuery: () => ({ data: ref(null) }) }));
vi.mock("@/stores/toast", () => ({
  useToastStore: () => ({
    success: (t: string, m?: string) => toasts.success.push([t, m]),
    error: (t: string, m?: string) => toasts.error.push([t, m]),
  }),
}));

const stubs = { PageHeader: { template: "<div />" }, RouterLink: { template: "<a><slot /></a>" } };
const mountPage = () => mount(SettingsPermissionsPage, { global: { plugins: [createPinia()], stubs } });

beforeEach(() => {
  setActivePinia(createPinia());
  calls.setRoleSection = [];
  calls.setRoleSurface = [];
  calls.setMemberSection = [];
  calls.setMemberSurface = [];
  toasts.success = [];
  toasts.error = [];
  state.sections = {
    // ⚠ The overridden cell is one whose shipped default is NOT the value being written, and not
    // `none` either. With `safety` (shipped `none`) here, a "reset" that wrote `none` instead of the
    // shipped answer passed every assertion — the fixture could not tell the two apart.
    overrides: { [ROLE]: { equipment: "none" } },
    defaults,
    editableRoles: EDITABLE_ROLES,
    editableSections: EDITABLE_SECTIONS,
  };
  state.surfaces = {
    overrides: { [ROLE]: { "maintenance.inspectors": false } },
    surfaces: catalogue,
    editableRoles: EDITABLE_ROLES,
  };
  state.members = [
    { userId: "u-tech", email: "shop@silvicom.test", role: ROLE, joinedAt: "2026-01-01T00:00:00Z" },
    { userId: "u-admin", email: "boss@silvicom.test", role: "admin", joinedAt: "2026-01-02T00:00:00Z" },
  ];
  state.memberSections = {
    userId: "u-tech",
    role: ROLE,
    shipped: Object.fromEntries(APP_SECTIONS.map((s) => [s, sectionAccess(ROLE, s)])),
    roleOverrides: { safety: "view" },
    userOverrides: { maintenance: "manage" },
    editableSections: EDITABLE_SECTIONS,
  };
  state.memberSurfaces = {
    userId: "u-tech",
    role: ROLE,
    roleOverrides: { "maintenance.inspectors": false },
    userOverrides: { "maintenance.repair-spend": false },
    surfaces: catalogue,
  };
});

const selects = (w: ReturnType<typeof mountPage>) => w.findAll("select");
const byLabel = (w: ReturnType<typeof mountPage>, label: string) =>
  w.findAll("select, input").find((el) => el.attributes("aria-label") === label);

describe("the Roles tab", () => {
  it("renders the seven editable roles against the eleven editable sections, and nothing locked", async () => {
    const w = mountPage();
    await flushPromises();
    expect(EDITABLE_ROLES).toHaveLength(7);
    expect(EDITABLE_SECTIONS).toHaveLength(11);
    const header = w.find("thead").text();
    expect(header).toContain("Fuel");
    expect(header).not.toContain("Admin");
    // The FIRST table is the section matrix; the second is the screen grid, whose group headers are
    // also rows and would otherwise answer for it.
    const rows = w.findAll("table")[0]!.findAll("tbody tr");
    expect(rows).toHaveLength(EDITABLE_ROLES.length);
    expect(rows.some((r) => r.text().startsWith(ROLE_LABEL))).toBe(true);
    // D-PERM7/D-PERM8: the two locked roles are explained, never rendered as dead controls.
    expect(rows.some((r) => r.text().startsWith(USER_ROLE_LABELS.admin))).toBe(false);
    expect(rows.some((r) => r.text().startsWith(USER_ROLE_LABELS.driver))).toBe(false);
    expect(w.text()).toContain("not an organisation's to change");
  });

  it("shows what a changed cell would revert to, so `reset` means something", async () => {
    const w = mountPage();
    await flushPromises();
    // The org took Equipment from the technician; the shipped answer is View, which is what reset
    // would restore and what the marker has to say.
    expect(sectionAccess(ROLE, "equipment")).toBe("view");
    expect(w.text()).toContain("Default: View");
  });

  it("saves a section change and says it lands within the hour, not on the next page load", async () => {
    const w = mountPage();
    await flushPromises();
    const cell = byLabel(w, `${ROLE_LABEL} — Fuel`)!;
    await cell.setValue("view");
    await flushPromises();
    expect(calls.setRoleSection).toEqual([{ role: ROLE, section: "fuel", access: "view" }]);
    expect(toasts.success[0]![1]).toMatch(/hour/i);
    expect(toasts.success[0]![1]).not.toMatch(/page/i);
  });

  it("saves a screen change and says it lands on the next page load, not within the hour", async () => {
    const w = mountPage();
    await flushPromises();
    const box = byLabel(w, `${ROLE_LABEL} — Annual inspections`)!;
    await box.setValue(false);
    await flushPromises();
    expect(calls.setRoleSurface).toEqual([
      { role: ROLE, surfaceKey: "maintenance.inspections", allowed: false },
    ]);
    expect(toasts.success[0]![1]).toMatch(/page/i);
    expect(toasts.success[0]![1]).not.toMatch(/hour/i);
  });

  /**
   * D-SURF2 at the cell. A technician holds no `fuel` access, so IFTA is not a screen an org can
   * hand them here — widening is a section edit, one card above, where it is visible as one.
   */
  it("offers no control for a screen inside a section the role does not hold", async () => {
    const w = mountPage();
    await flushPromises();
    expect(sectionAccess(ROLE, "fuel")).toBe("none");
    expect(byLabel(w, `${ROLE_LABEL} — IFTA`)).toBeUndefined();
    expect(w.text()).toContain("No section");
  });

  it("resets a row by writing each changed cell back to its shipped default", async () => {
    const w = mountPage();
    await flushPromises();
    const reset = w.findAll("button").find((b) => b.text() === "Reset row");
    expect(reset, "the overridden role has a reset control").toBeTruthy();
    await reset!.trigger("click");
    await flushPromises();
    expect(calls.setRoleSection).toEqual([
      { role: ROLE, section: "equipment", access: sectionAccess(ROLE, "equipment") },
    ]);
    expect(sectionAccess(ROLE, "equipment")).not.toBe("none");
  });
});

describe("the People tab", () => {
  const openPeople = async () => {
    const w = mountPage();
    await flushPromises();
    const tab = w.findAll('[role="tab"]').find((t) => t.text() === "People")!;
    await tab.trigger("click");
    await flushPromises();
    return w;
  };

  it("marks each cell with the layer that answered it", async () => {
    const w = await openPeople();
    const rows = w.findAll("tbody tr");
    const safety = rows.find((r) => r.text().startsWith("Safety"))!;
    const maintenance = rows.find((r) => r.text().startsWith("Maintenance"))!;
    const fuel = rows.find((r) => r.text().startsWith("Fuel") && r.text().includes("Follow their role"))!;
    expect(safety.text()).toContain("Role override");
    expect(maintenance.text()).toContain("Person override");
    expect(fuel.text()).toContain("Default");
  });

  /**
   * The three-state control. "Follow their role" is not a reset button that writes today's answer —
   * it is `null` on the wire and the absence of a row, which is what keeps the person tracking their
   * role after an admin changes it (D-SURF7).
   */
  it("sends `access: null` when a section is handed back to the role", async () => {
    const w = await openPeople();
    const cell = byLabel(w, "Maintenance access")!;
    await cell.setValue("__inherit__");
    await flushPromises();
    expect(calls.setMemberSection).toEqual([
      { userId: "u-tech", section: "maintenance", access: null },
    ]);
    expect(toasts.success[0]![1]).toMatch(/hour/i);
  });

  it("sends `allowed: null` when a screen is handed back to the role", async () => {
    const w = await openPeople();
    const cell = byLabel(w, "Repair spend visibility")!;
    await cell.setValue("__inherit__");
    await flushPromises();
    expect(calls.setMemberSurface).toEqual([
      { userId: "u-tech", surfaceKey: "maintenance.repair-spend", allowed: null },
    ]);
    expect(toasts.success[0]![1]).toMatch(/page/i);
  });

  it("gives one person back a screen their whole role has lost", async () => {
    const w = await openPeople();
    const cell = byLabel(w, "Inspectors visibility")!;
    await cell.setValue("true");
    await flushPromises();
    expect(calls.setMemberSurface).toEqual([
      { userId: "u-tech", surfaceKey: "maintenance.inspectors", allowed: true },
    ]);
  });

  /**
   * The preview is `buildNavGroups` — the same function the real sidebar calls — so it answers with
   * this member's RESOLVED claims. The technician's own `maintenance: manage` is why the shop
   * screens appear at all, and `maintenance.repair-spend: false` is why one of them does not.
   */
  it("previews the sidebar this member will actually get", async () => {
    const w = await openPeople();
    const text = w.text();
    expect(text).toContain("Annual inspections");
    expect(text).not.toContain("Repair spend visibility\nShown");
    // The six product constants render in the preview and are named as unchangeable (Q-SURF3) —
    // and the sentence names THOSE, not every screen, or it would be telling an admin that the
    // controls above do nothing.
    const alwaysOn = w.findAll("p").find((el) => el.text().startsWith("Always available"))!;
    expect(alwaysOn.text()).toContain("Dashboard");
    expect(alwaysOn.text()).toContain("Ask AI");
    expect(alwaysOn.text()).not.toContain("Inspectors");
  });

  it("explains why an admin gets no controls instead of showing dead ones", async () => {
    state.memberSections = { ...(state.memberSections as object), role: "admin" } as unknown;
    state.memberSurfaces = { ...(state.memberSurfaces as object), role: "admin" } as unknown;
    state.members = [{ userId: "u-admin", email: "boss@silvicom.test", role: "admin", joinedAt: "x" }];
    const w = await openPeople();
    expect(w.text()).toContain("cannot be given a custom setup");
    expect(w.findAll("select").filter((s) => s.attributes("disabled") !== undefined).length).toBeGreaterThan(0);
  });
});

describe("the page itself", () => {
  it("names what stays outside it, rather than implying it governs everything", async () => {
    const w = mountPage();
    await flushPromises();
    /**
     * Q-SURF1 / S7. While the audit was outstanding this said the product was not fully governed;
     * now that it has landed, the honest sentence is the short named list of what is deliberately
     * decided elsewhere — the acts granted by NAME and the endpoints open for a stated reason. Both
     * halves are asserted, because a page that named only one of them would read as though the other
     * did not exist.
     */
    expect(w.text()).toContain("granted by name rather than by section");
    expect(w.text()).toContain("Each one is recorded with its reason");
  });

  it("states both staleness contracts up front, and does not conflate them", async () => {
    const w = mountPage();
    await flushPromises();
    const text = w.text();
    expect(text).toContain("within an hour");
    expect(text).toContain("next time they load a page");
  });

  it("renders both tabs and nothing from the other one at a time", async () => {
    const w = mountPage();
    await flushPromises();
    expect(selects(w).length).toBeGreaterThan(0);
    expect(w.text()).toContain("What each role can reach");
    expect(w.text()).not.toContain("What they can work with");
  });
});
