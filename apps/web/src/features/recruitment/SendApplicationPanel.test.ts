import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import SendApplicationPanel from "@/features/recruitment/SendApplicationPanel.vue";

/**
 * "Send the application" (AF4, D-AF5, D-AF7). What it must do: say what screening is outstanding
 * BEFORE the press and send anyway, hand the new link back on screen, say that a second press makes a
 * new link, and offer a reader nothing to press.
 */

const INV = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const DRIVER = "driver-1";

const state = vi.hoisted(() => ({
  posts: [] as string[],
  sentAt: null as string | null,
  steps: [] as Array<{ key: string; label: string; state: string }>,
}));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string }) => {
    if (opts?.method === "POST") {
      state.posts.push(url);
      return {
        ok: true,
        data: {
          link: "https://app.test/apply/NEWTOKEN",
          warnings: ["psp"],
          applicationSentAt: "2026-09-24T12:00:00Z",
          delivery: { sent: true, email: "susan@example.test", reason: null },
        },
      };
    }
    if (url.includes("/checklist")) return { ok: true, data: { checklist: { steps: state.steps } } };
    return { ok: true, data: { invitations: [{ id: INV, application_sent_at: state.sentAt }] } };
  }),
}));

const role = vi.hoisted(() => ({ value: "recruiter" as string }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ get role() { return role.value; } }) }));

const mountIt = () =>
  mount(SendApplicationPanel, {
    props: { invitationId: INV, driverId: DRIVER },
    global: { plugins: [VueQueryPlugin] },
  });

const button = (w: ReturnType<typeof mountIt>, label: string) =>
  w.findAll("button").find((b) => b.text() === label);

beforeEach(() => {
  setActivePinia(createPinia());
  state.posts.length = 0;
  state.sentAt = null;
  state.steps = [];
  role.value = "recruiter";
});

describe("sending the application", () => {
  it("names the screening still outstanding before the press, and lets it be sent anyway", async () => {
    state.steps = [
      { key: "mvr", label: "Driving record", state: "done" },
      { key: "psp", label: "PSP report", state: "waiting_on_us" },
      { key: "drug_test", label: "Drug test result", state: "waiting_on_them" },
      { key: "application_filled", label: "Application filled in", state: "blocked" },
    ];
    const w = mountIt();
    await flushPromises();
    expect(w.text()).toContain("Still outstanding: PSP report, Drug test result.");
    expect(w.text()).not.toContain("Driving record");
    // D-AF5: a warning, never a refusal.
    expect(button(w, "Send the application")).toBeDefined();
  });

  it("sends to this invitation, and shows the new link once with copy", async () => {
    const w = mountIt();
    await flushPromises();
    await button(w, "Send the application")!.trigger("click");
    await flushPromises();
    expect(state.posts).toEqual([`/api/recruitment/applications/${INV}/send-application`]);
    expect(w.text()).toContain("https://app.test/apply/NEWTOKEN");
    expect(w.text()).toContain("Emailed to susan@example.test");
    expect(w.text()).toContain("Sent with these still outstanding: PSP report.");
    expect(w.text()).toContain("send the application again if it is lost");
  });

  it("offers to send again once sent, and says the old link will stop working", async () => {
    state.sentAt = "2026-09-20T00:00:00Z";
    const w = mountIt();
    await flushPromises();
    expect(w.text()).toContain("Sent 09/20/2026");
    expect(w.text()).toContain("the one sent before stops working");
    expect(button(w, "Send again")).toBeDefined();
  });

  it("offers a reader no button", async () => {
    role.value = "auditor";
    const w = mountIt();
    await flushPromises();
    expect(button(w, "Send the application")).toBeUndefined();
    expect(state.posts).toHaveLength(0);
  });
});
