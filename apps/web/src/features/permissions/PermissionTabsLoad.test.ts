import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { AppCombobox } from "@silvicom/ui";

/**
 * The Roles and People tabs when a read fails (D-US5). Both used to say "Reload the page to try
 * again" — which also threw away the role or member picked. Each now says what could not load and
 * offers a Retry that reads again only what failed. The transport is mocked; nothing here saves.
 */
const reads = vi.hoisted(() => ({ refetched: [] as string[] }));
vi.mock("./usePermissions", async () => {
  const { ref } = await import("vue");
  const failed = (name: string) => ({
    data: ref(undefined), isPending: ref(false), isError: ref(true), error: ref(new Error("boom")),
    isFetching: ref(false), refetch: () => { reads.refetched.push(name); },
  });
  const ok = <T>(name: string, data: T) => ({
    data: ref(data), isPending: ref(false), isError: ref(false), error: ref(null),
    isFetching: ref(false), refetch: () => { reads.refetched.push(name); },
  });
  const mutation = { isPending: ref(false), mutateAsync: vi.fn() };
  return {
    useSectionAccessQuery: () => failed("sections"),
    useSurfaceAccessQuery: () => ok("surfaces", { overrides: {} }),
    useSetRoleSection: () => mutation,
    useSetRoleSurface: () => mutation,
    useMembersQuery: () => ok("members", [{ userId: "u-dee", email: "dee@carrier.test", fullName: "Dee", role: "dispatcher" }]),
    useMemberSectionAccessQuery: () => failed("member-sections"),
    useMemberSurfaceAccessQuery: () => failed("member-surfaces"),
    useSetMemberSection: () => mutation,
    useSetMemberSurface: () => mutation,
  };
});
vi.mock("@/composables/useModules", async () => {
  const { ref } = await import("vue");
  return { useModulesQuery: () => ({ data: ref(null) }) };
});
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

const RolesTab = (await import("./RolesTab.vue")).default;
const PeopleTab = (await import("./PeopleTab.vue")).default;
const holdForStepUp = () => false;
const retry = (alert: ReturnType<ReturnType<typeof mount>["get"]>) =>
  alert.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");

beforeEach(() => {
  setActivePinia(createPinia());
  reads.refetched = [];
});

describe("the Roles tab", () => {
  it("says permissions could not load and reads again only what failed", async () => {
    const w = mount(RolesTab, { props: { holdForStepUp } });
    const alert = w.get("[role=alert]");
    expect(alert.text()).toContain("Could not load permissions.");
    expect(w.text()).not.toContain("Reload the page");
    await retry(alert);
    expect(reads.refetched).toEqual(["sections"]);
  });
});

describe("the People tab", () => {
  it("says a member's access and screens could not load, each with its own Retry", async () => {
    const w = mount(PeopleTab, { props: { holdForStepUp }, attachTo: document.body });
    w.findComponent(AppCombobox).vm.$emit("update:modelValue", "u-dee");
    await flushPromises();
    const alerts = w.findAll("[role=alert]");
    expect(alerts.map((a) => a.text().replace(/\s*Retry$/, ""))).toEqual([
      "Could not load their access.",
      "Could not load their screens.",
    ]);
    await retry(alerts[1]!);
    expect(reads.refetched).toEqual(["member-surfaces"]);
    w.unmount();
  });
});
