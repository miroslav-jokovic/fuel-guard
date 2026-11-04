import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { IDENTITY_NUMBER_IMAGES_PERMISSION } from "@silvicom/shared";

/**
 * Settings → Permissions' "Sensitive papers" card (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.1, Q-WF4b). The
 * transport is mocked; what is pinned is what the card shows for a role and what it sends.
 */
const KEY = IDENTITY_NUMBER_IMAGES_PERMISSION;
const state = vi.hoisted(() => ({ grants: {} as Record<string, Record<string, boolean>>, sent: [] as unknown[] }));
vi.mock("./useNamedPermissions", async () => {
  const { ref } = await import("vue");
  return {
    useNamedPermissionsQuery: () => ({
      data: ref({
        permissions: [{ key: KEY, label: "See SSN-card and passport pictures", description: "d", shippedRoles: ["safety_manager", "recruiter"] }],
        grants: state.grants,
        editableRoles: ["recruiter", "dispatcher"],
      }),
      isPending: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn(),
    }),
    useSetNamedPermission: () => ({ isPending: ref(false), mutateAsync: vi.fn(async (v: unknown) => { state.sent.push(v); }) }),
  };
});
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

const Card = (await import("./NamedPermissionsCard.vue")).default;
const holdForStepUp = () => false;
const switchOf = (w: ReturnType<typeof mount>) => w.get('[role="switch"]');

beforeEach(() => {
  setActivePinia(createPinia());
  state.grants = {};
  state.sent = [];
});

describe("the Sensitive papers card", () => {
  it("shows the recruiter on by default and the dispatcher off, neither marked changed", () => {
    const rec = mount(Card, { props: { role: "recruiter", holdForStepUp } });
    expect(switchOf(rec).attributes("aria-checked")).toBe("true");
    expect(rec.text()).not.toContain("Changed");
    const disp = mount(Card, { props: { role: "dispatcher", holdForStepUp } });
    expect(switchOf(disp).attributes("aria-checked")).toBe("false");
  });

  it("shows a carrier's switch as changed, with a reset back to the shipped value", async () => {
    state.grants = { recruiter: { [KEY]: false } };
    const w = mount(Card, { props: { role: "recruiter", holdForStepUp } });
    expect(switchOf(w).attributes("aria-checked")).toBe("false");
    expect(w.text()).toContain("Changed");
    await w.findAll("button").find((b) => b.text() === "Reset to on")!.trigger("click");
    await flushPromises();
    expect(state.sent).toEqual([{ role: "recruiter", permission: KEY, allowed: null }]);
  });

  it("sends the role, the permission and the new value when switched", async () => {
    const w = mount(Card, { props: { role: "dispatcher", holdForStepUp } });
    await switchOf(w).trigger("click");
    await flushPromises();
    expect(state.sent).toEqual([{ role: "dispatcher", permission: KEY, allowed: true }]);
  });
});
