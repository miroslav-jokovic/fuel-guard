import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
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
import { AppCombobox } from "@silvicom/ui";
import SettingsPermissionsPage from "@/pages/SettingsPermissionsPage.vue";

/**
 * The permissions page (SURFACE-ENTITLEMENTS-PLAN.md S6, redrawn as a master–detail).
 *
 * ── WHAT IS WORTH PINNING, AND WHY IT IS THESE ──────────────────────────────────────────────────
 * The transport is mocked and everything else is real: the tabs, the role rail, the segmented
 * controls, the switches, the three-state per-person rows and the sidebar preview are the shipped
 * components, so these assertions fail when the page changes what it SAYS or what it SENDS.
 *
 *  · **The two staleness contracts must not be averaged.** A section change lands on the member's
 *    next token refresh — up to an hour (D-PERM6); a screen change lands on their next page load
 *    (D-SURF4). One sentence for both would be wrong for one of them, and which one is wrong depends
 *    on which control was used.
 *  · **The per-user write takes THREE values.** `access: null` / `allowed: null` is "follow the
 *    role", and it is stored as the absence of a row. A two-state control here would be unable to
 *    express what the API takes, and an admin could never undo an answer.
 *  · **A row has to say which layer answered.** Shipped default → org role override → person
 *    override (D-SURF6); without the marker "follow role" and "set to this value" are the same
 *    control.
 *  · **A surface may only narrow within its section (D-SURF2).** A screen whose section the role does
 *    not hold offers no switch — it says what it needs.
 *  · **The page names what it does not decide**, rather than implying it governs everything.
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
const mountPage = () =>
  mount(SettingsPermissionsPage, { global: { plugins: [createPinia()], stubs }, attachTo: document.body });
type W = VueWrapper<InstanceType<typeof SettingsPermissionsPage>>;

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

/** The segmented control for one section, found by the name a screen reader hears. */
const group = (w: W, label: string) =>
  w.findAll('[role="radiogroup"]').find((g) => g.attributes("aria-label") === label);
const segment = (w: W, label: string, option: string) =>
  group(w, label)?.findAll('[role="radio"]').find((b) => b.text() === option);
const toggle = (w: W, label: string) =>
  w.findAll('[role="switch"]').find((s) => s.attributes("aria-label") === label);
const link = (w: W, text: string) => w.findAll("button").find((b) => b.text() === text);
/** The list row whose label starts with `label` — a section row or a screen row. */
const row = (w: W, label: string) => w.findAll("li").find((li) => li.text().startsWith(label));

/** The Roles tab opens on the first editable role; every assertion here is about the technician. */
async function openRole(w: W, label = ROLE_LABEL) {
  const tab = w.findAll('[role="tab"]').find((t) => t.text().startsWith(label))!;
  await tab.trigger("click");
  await flushPromises();
}

describe("the Roles tab", () => {
  it("lists the seven editable roles in a rail, and eleven sections for the one picked — nothing locked", async () => {
    const w = mountPage();
    await flushPromises();
    await openRole(w);
    expect(EDITABLE_ROLES).toHaveLength(7);
    expect(EDITABLE_SECTIONS).toHaveLength(11);
    // Two rails render — the scrolling strip for a phone and the vertical list for a desktop — so
    // the count is asserted on the vertical one, which is the one that points at the panel.
    const rail = w.find('[role="tablist"][aria-orientation="vertical"]');
    const roleTabs = rail.findAll('[role="tab"]').map((t) => t.text());
    expect(roleTabs).toHaveLength(EDITABLE_ROLES.length);
    expect(roleTabs.some((t) => t.startsWith(ROLE_LABEL))).toBe(true);
    // D-PERM7/D-PERM8: the two locked roles are explained, never rendered as dead controls.
    expect(roleTabs.some((t) => t.startsWith(USER_ROLE_LABELS.admin))).toBe(false);
    expect(roleTabs.some((t) => t.startsWith(USER_ROLE_LABELS.driver))).toBe(false);
    expect(w.text()).toContain("not an organisation's to change");
    expect(w.findAll('[role="radiogroup"]')).toHaveLength(EDITABLE_SECTIONS.length);
    expect(group(w, "Admin access")).toBeUndefined();
  });

  it("draws each role's eleven answers on the rail, and says them once in words", async () => {
    const w = mountPage();
    await flushPromises();
    const rail = w.find('[role="tablist"][aria-orientation="vertical"]');
    const tech = rail.findAll('[role="tab"]').find((t) => t.text().startsWith(ROLE_LABEL))!;
    // Eleven marks, decorative; one sentence, for a screen reader. The technician ships with one
    // manage (maintenance), one view (equipment) — and the org's `equipment: none` takes that one.
    expect(tech.findAll('[aria-hidden="true"]')).toHaveLength(EDITABLE_SECTIONS.length);
    expect(tech.find(".sr-only").text()).toBe("Manage 1, view 0, none 10");
  });

  it("marks a changed cell, says what reset would restore, and counts it on the rail", async () => {
    const w = mountPage();
    await flushPromises();
    await openRole(w);
    // The org took Equipment from the technician; the shipped answer is View, which is what reset
    // would restore and what the link has to say.
    expect(sectionAccess(ROLE, "equipment")).toBe("view");
    const equipment = row(w, "Equipment")!;
    expect(equipment.text()).toContain("Changed");
    expect(link(w, "Reset to View")).toBeTruthy();
    expect(row(w, "Fuel")!.text()).not.toContain("Changed");
    // One section and one screen are the org's answers: the rail says so beside the role.
    expect(w.find('[role="tablist"][aria-orientation="vertical"]').text()).toContain("2 custom");
  });

  it("saves a section change and says it lands within the hour, not on the next page load", async () => {
    const w = mountPage();
    await flushPromises();
    await openRole(w);
    await segment(w, "Fuel access", "View")!.trigger("click");
    await flushPromises();
    expect(calls.setRoleSection).toEqual([{ role: ROLE, section: "fuel", access: "view" }]);
    expect(toasts.success[0]![1]).toMatch(/hour/i);
    expect(toasts.success[0]![1]).not.toMatch(/page/i);
  });

  it("does not write a section cell that is clicked on its current value", async () => {
    const w = mountPage();
    await flushPromises();
    await openRole(w);
    await segment(w, "Fuel access", "None")!.trigger("click");
    await flushPromises();
    expect(calls.setRoleSection).toEqual([]);
  });

  it("saves a screen change and says it lands on the next page load, not within the hour", async () => {
    const w = mountPage();
    await flushPromises();
    await openRole(w);
    await toggle(w, "Annual inspections")!.trigger("click");
    await flushPromises();
    expect(calls.setRoleSurface).toEqual([
      { role: ROLE, surfaceKey: "maintenance.inspections", allowed: false },
    ]);
    expect(toasts.success[0]![1]).toMatch(/page/i);
    expect(toasts.success[0]![1]).not.toMatch(/hour/i);
  });

  /**
   * D-SURF2 at the row. A technician holds `equipment: view` and no `fuel` at all, so Fuel Spend
   * (fuel: manage) is not a screen an org can hand them here — and neither is any Fuel screen, so
   * the whole group is named as unlisted rather than drawn as four rows of refusals. A group with
   * SOME reachable screens keeps the others, each saying what it needs.
   */
  it("offers no switch for a screen inside a section the role does not hold, and says why", async () => {
    const w = mountPage();
    await flushPromises();
    await openRole(w);
    expect(sectionAccess(ROLE, "fuel")).toBe("none");
    expect(toggle(w, "IFTA")).toBeUndefined();
    expect(w.text()).toMatch(/Not listed: .*Fuel/);
    // A group with SOME reachable screens keeps the rest, each saying what it needs. The dispatcher
    // holds `dispatch: manage` and `fuel: view`, so in the Fuel group Cards is a switch and Fuel
    // Spend — `fuel: manage` — is an explanation.
    await openRole(w, USER_ROLE_LABELS.dispatcher);
    expect(sectionAccess("dispatcher", "fuel")).toBe("view");
    expect(toggle(w, "Cards")).toBeTruthy();
    expect(toggle(w, "Fuel Spend")).toBeUndefined();
    expect(row(w, "Fuel Spend")!.text()).toContain("Needs Fuel · Manage");
  });

  it("resets a role by writing each changed section back to its shipped default and each screen to allowed", async () => {
    const w = mountPage();
    await flushPromises();
    await openRole(w);
    const reset = link(w, "Reset role to defaults");
    expect(reset, "the overridden role has a reset control").toBeTruthy();
    await reset!.trigger("click");
    await flushPromises();
    expect(calls.setRoleSection).toEqual([
      { role: ROLE, section: "equipment", access: sectionAccess(ROLE, "equipment") },
    ]);
    expect(sectionAccess(ROLE, "equipment")).not.toBe("none");
    expect(calls.setRoleSurface).toEqual([{ role: ROLE, surfaceKey: "maintenance.inspectors", allowed: true }]);
  });

  it("offers no reset for a role the organisation has not changed", async () => {
    const w = mountPage();
    await flushPromises();
    await openRole(w, USER_ROLE_LABELS.auditor);
    expect(link(w, "Reset role to defaults")).toBeUndefined();
  });
});

describe("the People tab", () => {
  const openPeople = async (userId = "u-tech") => {
    const w = mountPage();
    await flushPromises();
    const tab = w.findAll('[role="tab"]').find((t) => t.text() === "People")!;
    await tab.trigger("click");
    await flushPromises();
    // Nobody is selected until the admin picks someone; the picker is the shared combobox.
    expect(w.text()).toContain("Pick a member");
    w.findComponent(AppCombobox).vm.$emit("update:modelValue", userId);
    await flushPromises();
    return w;
  };

  it("marks each row with the layer that answered it", async () => {
    const w = await openPeople();
    expect(row(w, "Safety")!.text()).toContain("Role");
    expect(row(w, "Maintenance")!.text()).toContain("Personal");
    expect(row(w, "Fuel")!.text()).toContain("Default");
    // A following row shows the role's answer outlined; a personal row holds its own.
    expect(segment(w, "Fuel access", "None")!.classes()).toContain("ring-1");
    expect(segment(w, "Maintenance access", "Manage")!.classes()).toContain("bg-surface");
  });

  /**
   * The three-state row. "Follow role" is not a reset button that writes today's answer — it is
   * `null` on the wire and the absence of a row, which is what keeps the person tracking their role
   * after an admin changes it (D-SURF7). The link names the answer they will fall back to.
   */
  it("sends `access: null` when a section is handed back to the role", async () => {
    const w = await openPeople();
    // The link names what they fall back to: their ROLE's answer for maintenance, which is the
    // shipped one because the fixture's role layer only speaks for safety.
    const fallback = sectionAccess(ROLE, "maintenance");
    const label = fallback === "manage" ? "Manage" : fallback === "view" ? "View" : "None";
    await link(w, `Follow role (${label})`)!.trigger("click");
    await flushPromises();
    expect(calls.setMemberSection).toEqual([{ userId: "u-tech", section: "maintenance", access: null }]);
    expect(toasts.success[0]![1]).toMatch(/hour/i);
  });

  it("writes a personal row when a following row's own value is chosen", async () => {
    const w = await openPeople();
    // Fuel follows the role at None; choosing None again is a real answer, not a no-op.
    await segment(w, "Fuel access", "None")!.trigger("click");
    await flushPromises();
    expect(calls.setMemberSection).toEqual([{ userId: "u-tech", section: "fuel", access: "none" }]);
  });

  it("sends `allowed: null` when a screen is handed back to the role", async () => {
    const w = await openPeople();
    await link(w, "Follow role (Shown)")!.trigger("click");
    await flushPromises();
    expect(calls.setMemberSurface).toEqual([
      { userId: "u-tech", surfaceKey: "maintenance.repair-spend", allowed: null },
    ]);
    expect(toasts.success[0]![1]).toMatch(/page/i);
  });

  it("gives one person back a screen their whole role has lost", async () => {
    const w = await openPeople();
    const inspectors = toggle(w, "Inspectors")!;
    expect(inspectors.attributes("aria-checked")).toBe("false");
    await inspectors.trigger("click");
    await flushPromises();
    expect(calls.setMemberSurface).toEqual([
      { userId: "u-tech", surfaceKey: "maintenance.inspectors", allowed: true },
    ]);
  });

  it("hands every personal row back to the role in one act", async () => {
    const w = await openPeople();
    await link(w, "Follow role everywhere")!.trigger("click");
    await flushPromises();
    expect(calls.setMemberSection).toEqual([{ userId: "u-tech", section: "maintenance", access: null }]);
    expect(calls.setMemberSurface).toEqual([
      { userId: "u-tech", surfaceKey: "maintenance.repair-spend", allowed: null },
    ]);
  });

  /**
   * The preview is `buildNavGroups` — the same function the real sidebar calls — so it answers with
   * this member's RESOLVED claims. The technician's own `maintenance: manage` is why the shop
   * screens appear at all, and `maintenance.repair-spend: false` is why one of them is struck.
   */
  it("previews the sidebar this member will actually get, with what they lost struck through", async () => {
    const w = await openPeople();
    const preview = w.find('nav[aria-label="Sidebar preview"]');
    const items = preview.findAll("li");
    expect(items.some((li) => li.text().startsWith("Annual inspections") && !li.classes().includes("line-through"))).toBe(true);
    expect(items.some((li) => li.text().startsWith("Repair spend") && li.classes().includes("line-through"))).toBe(true);
    // The product constants render in the preview and are named as unchangeable (Q-SURF3) — and
    // the sentence names THOSE, not every screen, or it would be telling an admin that the
    // controls above do nothing.
    const alwaysOn = w.findAll("p").find((el) => el.text().includes("Always available"))!;
    expect(alwaysOn.text()).toContain("Dashboard");
    expect(alwaysOn.text()).toContain("Ask AI");
    expect(alwaysOn.text()).not.toContain("Inspectors");
  });

  it("explains why an admin gets no controls instead of showing live ones", async () => {
    state.memberSections = { ...(state.memberSections as object), role: "admin" } as unknown;
    state.memberSurfaces = { ...(state.memberSurfaces as object), role: "admin" } as unknown;
    const w = await openPeople("u-admin");
    expect(w.text()).toContain("cannot be given a custom setup");
    const groups = w.findAll('[role="radiogroup"]');
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((g) => g.attributes("aria-disabled") === "true")).toBe(true);
  });
});

describe("the page itself", () => {
  it("names what stays outside it, rather than implying it governs everything", async () => {
    const w = mountPage();
    await flushPromises();
    /**
     * Q-SURF1 / S7. The honest sentence is the short named list of what is deliberately decided
     * elsewhere — the acts granted by NAME and the endpoints open for a stated reason. Both halves
     * are asserted, because a page that named only one of them would read as though the other did
     * not exist. It lives in a disclosure at the foot, so it is findable without being read first.
     */
    expect(w.find("details").exists()).toBe(true);
    expect(w.text()).toContain("granted by name rather than by section");
    expect(w.text()).toContain("Each one is recorded with its reason");
  });

  it("states each staleness contract beside the rows it governs, and does not conflate them", async () => {
    const w = mountPage();
    await flushPromises();
    const sections = w.find('section[aria-label="Sections"]').text();
    const screens = w.find('section[aria-label="Screens"]').text();
    expect(sections).toContain("within an hour");
    expect(sections).not.toContain("load a page");
    expect(screens).toContain("next time they load a page");
    expect(screens).not.toContain("hour");
  });

  it("renders both tabs and nothing from the other one at a time", async () => {
    const w = mountPage();
    await flushPromises();
    expect(w.findAll('[role="radiogroup"]').length).toBeGreaterThan(0);
    expect(w.find('section[aria-label="Sections"]').exists()).toBe(true);
    expect(w.findComponent(AppCombobox).exists()).toBe(false);
    expect(w.text()).not.toContain("Pick a member");
  });
});
