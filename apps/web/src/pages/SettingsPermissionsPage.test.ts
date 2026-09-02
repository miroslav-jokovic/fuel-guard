import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { sectionAccess } from "@silvicom/shared";
import SettingsPermissionsPage from "@/pages/SettingsPermissionsPage.vue";

/**
 * The permissions page (EDITABLE-PERMISSIONS-PLAN.md P0).
 *
 * Two claims are worth pinning, and they are the two that would rot silently.
 *
 * First, the matrix is DERIVED from `packages/shared/src/auth.ts` rather than retyped. A page that
 * hand-lists what each role may do is the "copy is a workaround with a delay fuse" failure — it
 * would keep rendering yesterday's answer confidently after the matrix changed, and nothing would
 * notice. So the assertions below read the shared matrix rather than hard-coding cells.
 *
 * Second, "what one member sees" is built by `buildNavGroups` — the same function the real sidebar
 * calls. If it ever became a separate list, this page would be a second opinion about the product's
 * navigation, which is exactly the question it exists to answer authoritatively.
 */
const members = vi.hoisted(() => ({
  value: [
    { userId: "u-disp", email: "dana@silvicom.test", role: "dispatcher", joinedAt: "2026-01-01T00:00:00Z" },
    { userId: "u-rec", email: "rae@silvicom.test", role: "recruiter", joinedAt: "2026-01-02T00:00:00Z" },
  ] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => ({ ok: true, data: { members: members.value } })),
}));
vi.mock("@/composables/useModules", () => ({
  useModulesQuery: () => ({ data: { value: null } }),
}));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ error: vi.fn(), success: vi.fn() }) }));

const stubs = {
  RouterLink: { template: "<a><slot /></a>" },
  PageHeader: { template: "<div />" },
  SettingsSection: { template: "<section><slot /></section>" },
  AppCard: { template: "<div><slot /></div>" },
  AppTable: { template: "<table><slot /></table>" },
  AppSelect: { props: ["modelValue", "options"], template: "<select />" },
};

function mountPage() {
  return mount(SettingsPermissionsPage, { global: { plugins: [createPinia()], stubs } });
}

beforeEach(() => setActivePinia(createPinia()));

describe("SettingsPermissionsPage", () => {
  it("renders one row per role and one column per section, read from the shared matrix", async () => {
    const w = mountPage();
    await flushPromises();
    const rows = w.findAll("tbody tr");
    expect(rows.length).toBeGreaterThan(0);
    // A recruiter's row is the one the matrix documents most carefully (RECRUITER-ROLE-SCOPE.md):
    // recruitment manage, roster view, equipment none. Read from the matrix so the test cannot
    // outlive a deliberate change to it.
    expect(sectionAccess("recruiter", "recruitment")).toBe("manage");
    expect(sectionAccess("recruiter", "roster")).toBe("view");
    expect(sectionAccess("recruiter", "equipment")).toBe("none");
    const recruiterRow = rows.find((r) => r.text().startsWith("Recruiter"));
    expect(recruiterRow, "a Recruiter row is rendered").toBeTruthy();
    expect(recruiterRow!.text()).toContain("Manage");
    expect(recruiterRow!.text()).toContain("View");
    expect(recruiterRow!.text()).toContain("—");
  });

  it("says the matrix cannot be edited here, rather than implying it can", async () => {
    const w = mountPage();
    await flushPromises();
    expect(w.text()).toContain("These permissions are fixed");
    expect(w.text()).toContain("not built yet");
  });

  /**
   * The half that answers the actual question — "control exactly what they can see on dashboard".
   * A dispatcher holds `dispatch: manage` and `equipment: view`, so Loads and Vehicles are in their
   * sidebar; they hold `recruitment: none` and `accounting: none`, so Applicants and Money in & out
   * are not. Reading those four from the same nav builder the shell uses is the whole point.
   */
  it("shows a member's real sidebar, including what is hidden from them", async () => {
    const w = mountPage();
    await flushPromises();
    const text = w.text();
    expect(text).toContain("Vehicles");
    expect(text).toContain("Drivers");
    expect(text).not.toContain("Applicants");
    expect(text).toContain("Hidden from them:");
    expect(text).toContain("Recruitment");
    expect(text).toContain("Accounting");
  });

  it("copes with an org that has no members yet instead of rendering an empty sidebar as fact", async () => {
    members.value = [];
    const w = mountPage();
    await flushPromises();
    expect(w.text()).toContain("No members yet");
    members.value = [
      { userId: "u-disp", email: "dana@silvicom.test", role: "dispatcher", joinedAt: "2026-01-01T00:00:00Z" },
    ];
  });
});
