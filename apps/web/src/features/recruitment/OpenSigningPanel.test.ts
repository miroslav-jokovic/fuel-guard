import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import OpenSigningPanel from "@/features/recruitment/OpenSigningPanel.vue";

/**
 * "Open signing on this screen" (AF5, D-AF3, D-AF6). What it must do: offer nothing to open before
 * approval, name the federal gates and road test outstanding BEFORE the press and open anyway, point
 * a tab opened INSIDE the click at the sign link, show the link once without telling anybody to send
 * it, and offer a reader nothing to press.
 */

const INV = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const DRIVER = "driver-1";

const state = vi.hoisted(() => ({
  posts: [] as string[],
  fail: false,
  invite: {} as Record<string, unknown>,
  steps: [] as Array<{ key: string; label: string; state: string }>,
}));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string }) => {
    if (opts?.method === "POST") {
      state.posts.push(url);
      if (state.fail) return { ok: false, error: { code: "application_not_approved", message: "Approve it first." } };
      return {
        ok: true,
        data: { link: "https://app.test/apply/SIGNTOKEN", warnings: ["road_test"], signingOpenedAt: "2026-09-24T12:00:00Z" },
      };
    }
    if (url.includes("/checklist")) return { ok: true, data: { checklist: { steps: state.steps } } };
    return { ok: true, data: { invitations: [{ id: INV, ...state.invite }] } };
  }),
}));

const role = vi.hoisted(() => ({ value: "recruiter" as string }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ get role() { return role.value; } }) }));

const mountIt = () =>
  mount(OpenSigningPanel, {
    props: { invitationId: INV, driverId: DRIVER },
    global: { plugins: [VueQueryPlugin] },
  });

const button = (w: ReturnType<typeof mountIt>, label: string) =>
  w.findAll("button").find((b) => b.text() === label);

/** A stand-in for the tab the click opens: it records where it was sent and whether it was closed. */
const tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
let windowOpen: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setActivePinia(createPinia());
  state.posts.length = 0;
  state.fail = false;
  state.invite = { approved_at: "2026-09-23T09:00:00Z", signing_opened_at: null, submitted_at: null };
  state.steps = [];
  role.value = "recruiter";
  tab.opener = {};
  tab.location.href = "";
  tab.close.mockClear();
  windowOpen = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
});
afterEach(() => windowOpen.mockRestore());

describe("opening signing in the office", () => {
  it("offers nothing to open before the application is approved", async () => {
    state.invite = { approved_at: null, signing_opened_at: null, submitted_at: null };
    const w = mountIt();
    await flushPromises();
    expect(w.text()).toContain("Approve the application first");
    expect(button(w, "Open signing on this screen")).toBeUndefined();
  });

  it("names the federal gates and road test still outstanding, and lets it be opened anyway", async () => {
    state.steps = [
      { key: "mvr", label: "Driving record", state: "done" },
      { key: "drug_test", label: "Drug test result", state: "waiting_on_them" },
      { key: "road_test", label: "Road test", state: "waiting_on_us" },
      { key: "application_filled", label: "Application filled in", state: "done" },
    ];
    const w = mountIt();
    await flushPromises();
    expect(w.text()).toContain("Still outstanding: Drug test result, Road test.");
    expect(w.text()).not.toContain("Driving record");
    // D-AF6: a warning, never a refusal.
    expect(button(w, "Open signing on this screen")).toBeDefined();
  });

  /**
   * ⚠ The tab is opened DURING the click and pointed at the link after the answer: a `window.open`
   * after an `await` is a pop-up, and a blocked pop-up is an applicant standing at a desk with
   * nothing to sign.
   */
  it("opens a tab inside the click, and points it at the sign link it was handed", async () => {
    const w = mountIt();
    await flushPromises();
    await button(w, "Open signing on this screen")!.trigger("click");
    expect(windowOpen).toHaveBeenCalledTimes(1);
    await flushPromises();
    expect(state.posts).toEqual([`/api/recruitment/applications/${INV}/open-signing`]);
    expect(tab.location.href).toBe("https://app.test/apply/SIGNTOKEN");
    expect(tab.opener).toBeNull();
  });

  it("shows the link once, and never tells anybody to send it", async () => {
    const w = mountIt();
    await flushPromises();
    await button(w, "Open signing on this screen")!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain("https://app.test/apply/SIGNTOKEN");
    expect(w.text()).toContain("hand this screen to the applicant");
    expect(w.text()).not.toMatch(/send this link|emailed/i);
    expect(w.text()).toContain("Opened with these still outstanding: Road test.");
  });

  it("closes the tab it opened when the office is refused", async () => {
    state.fail = true;
    const w = mountIt();
    await flushPromises();
    await button(w, "Open signing on this screen")!.trigger("click");
    await flushPromises();
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("");
  });

  it("offers to open again once opened, and says the old sign link will stop working", async () => {
    state.invite = { approved_at: "2026-09-23T09:00:00Z", signing_opened_at: "2026-09-24T09:00:00Z", submitted_at: null };
    const w = mountIt();
    await flushPromises();
    expect(w.text()).toContain("Opened 09/24/2026");
    expect(w.text()).toContain("the one before stops working");
    expect(button(w, "Open signing again")).toBeDefined();
  });

  it("offers nothing once the packet is filed", async () => {
    state.invite = { approved_at: "2026-09-23T09:00:00Z", signing_opened_at: "2026-09-24T09:00:00Z", submitted_at: "2026-09-24T11:00:00Z" };
    const w = mountIt();
    await flushPromises();
    expect(w.text()).toContain("Signed and filed");
    expect(w.findAll("button")).toHaveLength(0);
  });

  it("offers a reader no button", async () => {
    role.value = "auditor";
    const w = mountIt();
    await flushPromises();
    expect(button(w, "Open signing on this screen")).toBeUndefined();
    expect(state.posts).toHaveLength(0);
  });
});
