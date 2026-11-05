import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { DQ_EXPORT_MAX_DRIVERS } from "@silvicom/shared";
import DriverBinderBar from "./DriverBinderBar.vue";

/**
 * The binder bar on the Drivers page (DQ-INTO-DRIVERS-PLAN DD2): what it sends, what it says, and
 * that the restricted opt-in reaches the request only from a role allowed to make it (D-DQ15).
 */
const mutateAsync = vi.fn();
const isPending = ref(false);
vi.mock("@/composables/useDqExports", () => ({ useRequestBinder: () => ({ mutateAsync, isPending }) }));
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("@/stores/toast", () => ({ useToastStore: () => toast }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("safety_manager");
  return { useSessionStore: () => s, __session: s };
});

const session = async () =>
  ((await import("@/stores/session")) as unknown as { __session: import("@/testing/fakeSession").FakeSession }).__session;
const mountBar = (selected = new Set(["d1", "d2"])) => mount(DriverBinderBar, { props: { selected } });
const buildButton = (w: ReturnType<typeof mountBar>) => w.findAll("button").find((b) => b.text().includes("Build audit binder"))!;

beforeEach(async () => {
  mutateAsync.mockReset().mockResolvedValue({ exportId: "e1" });
  toast.success.mockReset();
  toast.error.mockReset();
  (await session()).role = "safety_manager";
});

describe("DriverBinderBar", () => {
  it("renders nothing with no driver ticked", () => {
    expect(mountBar(new Set()).text()).toBe("");
  });

  it("builds one binder for the ticked drivers, then clears the selection and opens the ledger", async () => {
    const w = mountBar();
    await buildButton(w).trigger("click");
    await flushPromises();
    expect(mutateAsync).toHaveBeenCalledWith({ driverIds: ["d1", "d2"], asAt: null, includeRestricted: false });
    expect(w.emitted("clear")).toHaveLength(1);
    expect(w.emitted("built")).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith("Building the binder", "2 qualification files. It appears under Audit binders in a minute or two.");
  });

  it("sends restricted records only when a role that reads them all ticks the box", async () => {
    const w = mountBar();
    await w.find("input[type=checkbox]").setValue(true);
    await buildButton(w).trigger("click");
    await flushPromises();
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ includeRestricted: true }));
  });

  it("offers no restricted opt-in to a role that may not read restricted records", async () => {
    (await session()).role = "fleet_manager";
    const w = mountBar();
    expect(w.find("input[type=checkbox]").exists()).toBe(false);
    await buildButton(w).trigger("click");
    await flushPromises();
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ includeRestricted: false }));
  });

  it("drops a ticked opt-in when the role lost restricted access before the build (session refresh)", async () => {
    const w = mountBar();
    await w.find("input[type=checkbox]").setValue(true);
    (await session()).role = "fleet_manager";
    await buildButton(w).trigger("click");
    await flushPromises();
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ includeRestricted: false }));
  });

  it("says why it failed and keeps the selection", async () => {
    mutateAsync.mockRejectedValue(new Error("No drivers selected."));
    const w = mountBar();
    await buildButton(w).trigger("click");
    await flushPromises();
    expect(toast.error).toHaveBeenCalledWith("Could not start the binder", "No drivers selected.");
    expect(w.emitted("clear")).toBeUndefined();
  });

  it("says when the selection is as large as one binder holds", () => {
    const full = new Set(Array.from({ length: DQ_EXPORT_MAX_DRIVERS }, (_, i) => `d${i}`));
    expect(mountBar(full).text()).toContain("most drivers one binder holds");
    expect(mountBar().text()).not.toContain("most drivers one binder holds");
  });
});
