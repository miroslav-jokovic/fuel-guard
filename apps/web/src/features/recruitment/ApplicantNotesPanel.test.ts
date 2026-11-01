import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import ApplicantNotesPanel from "@/features/recruitment/ApplicantNotesPanel.vue";

/**
 * The office's notes on an applicant (§9 P10, 0535): the two acts the table allows — add and pin —
 * asserted by the BODY the API receives, and both hidden from a role without recruitment manage.
 */
const state = vi.hoisted(() => ({
  notes: [] as unknown[],
  requests: [] as Array<{ url: string; method: string; body: unknown }>,
  canManage: true,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? "GET";
    if (method !== "GET") {
      state.requests.push({ url, method, body: opts?.body });
      return { ok: true, data: { note: { id: "new" }, pinned: true } };
    }
    return { ok: true, data: { notes: state.notes } };
  }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => state.canManage }) }));

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
const mountPanel = () => mount(ApplicantNotesPanel, { props: { driverId: "d1" }, global: { plugins: [VueQueryPlugin] } });
const button = (w: ReturnType<typeof mount>, text: string) => w.findAll("button").find((b) => b.text().includes(text));

const NOTES = [
  { id: "n-pin", driver_id: "d1", invitation_id: null, body: "Prefers texts", author_id: "u", author_name: "Dana", pinned: true, created_at: "2026-10-01T15:00:00Z" },
  { id: "n-new", driver_id: "d1", invitation_id: null, body: "Called, sends the SSN card Monday", author_id: "u", author_name: "Dana", pinned: false, created_at: "2026-10-30T15:00:00Z" },
];

beforeEach(() => {
  setActivePinia(createPinia());
  state.notes = NOTES;
  state.requests = [];
  state.canManage = true;
});

describe("ApplicantNotesPanel", () => {
  it("adds a note as one textarea and one button, posting what was typed", async () => {
    const w = mountPanel();
    await settle(w);
    expect(button(w, "Add a note")!.attributes("disabled")).toBeDefined();
    await w.find("textarea").setValue("Called 10/30, sends the SSN card Monday");
    await settle(w);
    await button(w, "Add a note")!.trigger("click");
    await settle(w);
    expect(state.requests).toEqual([
      { url: "/api/recruitment/applicants/d1/notes", method: "POST", body: { body: "Called 10/30, sends the SSN card Monday" } },
    ]);
    expect((w.find("textarea").element as HTMLTextAreaElement).value).toBe("");
  });

  it("shows the notes in the server's order, the pinned one marked, and pins another to the top", async () => {
    const w = mountPanel();
    await settle(w);
    const rows = w.findAll('[data-test="note"]');
    expect(rows.map((r) => r.text())).toEqual([
      expect.stringContaining("Pinned"),
      expect.stringContaining("Called, sends the SSN card Monday"),
    ]);
    expect(rows[0]!.text()).toContain("10/01/2026");
    await rows[1]!.findAll("button").find((b) => b.text() === "Pin to top")!.trigger("click");
    await settle(w);
    expect(state.requests).toEqual([
      { url: "/api/recruitment/applicants/d1/notes/n-new/pin", method: "POST", body: { pinned: true } },
    ]);
    await rows[0]!.findAll("button").find((b) => b.text() === "Unpin")!.trigger("click");
    await settle(w);
    expect(state.requests[1]).toEqual({ url: "/api/recruitment/applicants/d1/notes/n-pin/pin", method: "POST", body: { pinned: false } });
  });

  it("offers no writing and no pinning to a role without recruitment manage", async () => {
    state.canManage = false;
    const w = mountPanel();
    await settle(w);
    expect(w.findAll('[data-test="note"]')).toHaveLength(2);
    expect(w.find("textarea").exists()).toBe(false);
    expect(w.findAll("button").filter((b) => /Pin|Unpin|Add a note/.test(b.text()))).toHaveLength(0);
  });
});
