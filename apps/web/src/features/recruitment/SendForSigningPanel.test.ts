import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import SendForSigningPanel from "@/features/recruitment/SendForSigningPanel.vue";

/**
 * "Send for signing" (D-AW14, C3s3a), which replaced AF5's "Open signing on this screen". What it must
 * do: offer nothing before approval; name the federal gates and road test outstanding BEFORE the press
 * and send anyway (D-AF6); open NO tab and show NO link — the link goes to the applicant's phone only;
 * say where it went, and say loudly when it reached nobody; read the last send's state from the
 * invitation (live, ran out, stopped by wrong dates of birth); offer a reader nothing to press.
 */

const INV = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const DRIVER = "driver-1";

const state = vi.hoisted(() => ({
  posts: [] as string[],
  fail: false,
  answer: {} as Record<string, unknown>,
  invite: {} as Record<string, unknown>,
  steps: [] as Array<{ key: string; label: string; state: string }>,
}));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string }) => {
    if (opts?.method === "POST") {
      state.posts.push(url);
      if (state.fail) return { ok: false, error: { code: "application_not_approved", message: "Approve it first." } };
      return { ok: true, data: state.answer };
    }
    if (url.includes("/checklist")) return { ok: true, data: { checklist: { steps: state.steps } } };
    return { ok: true, data: { invitations: [{ id: INV, ...state.invite }] } };
  }),
}));

const role = vi.hoisted(() => ({ value: "recruiter" as string }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ get role() { return role.value; } }) }));

const mountIt = () =>
  mount(SendForSigningPanel, {
    props: { invitationId: INV, driverId: DRIVER },
    global: {
      plugins: [VueQueryPlugin],
      stubs: {
        ApplicantTextsStatus: true,
        // HeadlessUI's Dialog throws under jsdom; the stub says what the viewer was handed.
        DocumentPreview: {
          props: ["open", "label", "rendered"],
          template: "<div v-if='open' data-viewer :data-path='rendered?.path' :data-label='label' />",
        },
      },
    },
  });

const button = (w: ReturnType<typeof mountIt>, label: string) =>
  w.findAll("button").find((b) => b.text() === label);

const APPROVED = { approved_at: "2026-09-23T09:00:00Z", signing_opened_at: null, submitted_at: null };
const SENT = {
  warnings: ["road_test"], signingOpenedAt: "2026-09-24T12:00:00Z", signLinkExpiresAt: "2026-09-27T12:00:00Z",
  email: { sent: true, email: "susan@example.test", reason: null }, text: { state: "sent" },
};

let windowOpen: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  setActivePinia(createPinia());
  state.posts.length = 0;
  state.fail = false;
  state.answer = { ...SENT };
  state.invite = { ...APPROVED };
  state.steps = [];
  role.value = "recruiter";
  windowOpen?.mockRestore();
  windowOpen = vi.spyOn(window, "open").mockReturnValue(null);
});

const press = async (w: ReturnType<typeof mountIt>, label = "Send for signing") => {
  await button(w, label)!.trigger("click");
  await flushPromises();
};

describe("sending the packet for signing", () => {
  it("offers nothing to send before the application is approved", async () => {
    state.invite = { approved_at: null, signing_opened_at: null, submitted_at: null };
    const w = mountIt();
    await flushPromises();
    expect(w.text()).toContain("Approve the application first");
    expect(button(w, "Send for signing")).toBeUndefined();
  });

  it("names the federal gates and road test still outstanding, and lets it be sent anyway", async () => {
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
    expect(button(w, "Send for signing")).toBeDefined();
  });

  /** ⚠ The retired path: no tab on the office's computer, and no link on its screen. */
  it("posts to send-for-signing, opens no tab, and shows no link", async () => {
    const w = mountIt();
    await flushPromises();
    await press(w);
    expect(state.posts).toEqual([`/api/recruitment/applications/${INV}/send-for-signing`]);
    expect(windowOpen).not.toHaveBeenCalled();
    expect(w.text()).not.toMatch(/\/apply\/|https?:\/\//);
  });

  it("says where it went, until when, and what was outstanding", async () => {
    const w = mountIt();
    await flushPromises();
    await press(w);
    expect(w.text()).toContain("Emailed to susan@example.test.");
    expect(w.text()).toContain("Also texted to the applicant.");
    expect(w.text()).toContain("The link works until 09/27/2026");
    expect(w.text()).toContain("Sent with these still outstanding: Road test.");
    expect(w.text()).not.toContain("did not reach the applicant");
  });

  it("says when the text waits for the applicant's morning", async () => {
    state.answer = { ...SENT, text: { state: "queued", notBefore: "2026-09-25T13:00:00Z" } };
    const w = mountIt();
    await flushPromises();
    await press(w);
    expect(w.text()).toContain("it will be texted to them at 09/25/2026");
  });

  /** Neither went: said as a caution, while the applicant is still at the desk. */
  it("warns when the link reached nobody", async () => {
    state.answer = { ...SENT, email: { sent: false, email: null, reason: "no_address" }, text: { state: "held", reason: "no_consent" } };
    const w = mountIt();
    await flushPromises();
    await press(w);
    expect(w.text()).toContain("Not emailed: this application has no email address.");
    expect(w.text()).toContain("The link did not reach the applicant.");
  });

  it("does not warn when only the text went", async () => {
    state.answer = { ...SENT, email: { sent: false, email: "x@y.test", reason: "send_failed" } };
    const w = mountIt();
    await flushPromises();
    await press(w);
    expect(w.text()).toContain("The email did not go through.");
    expect(w.text()).not.toContain("did not reach the applicant");
  });

  it("reads a live link's end from the invitation, and offers to send again", async () => {
    state.invite = { ...APPROVED, signing_opened_at: "2026-09-24T09:00:00Z", sign_link_expires_at: "2099-01-01T12:00:00Z", unlock_failures: 0 };
    const w = mountIt();
    await flushPromises();
    expect(w.text()).toContain("The link works until 01/01/2099");
    expect(w.text()).toContain("the one before stops working");
    expect(button(w, "Send again")).toBeDefined();
  });

  it("says a link ran out", async () => {
    state.invite = { ...APPROVED, signing_opened_at: "2026-09-24T09:00:00Z", sign_link_expires_at: "2026-09-27T09:00:00Z", unlock_failures: 0 };
    const w = mountIt();
    await flushPromises();
    expect(w.text()).toContain("The last link ran out");
  });

  it("says a link stopped after five wrong dates of birth, ahead of its end", async () => {
    state.invite = { ...APPROVED, signing_opened_at: "2026-09-24T09:00:00Z", sign_link_expires_at: "2099-01-01T12:00:00Z", unlock_failures: 5 };
    const w = mountIt();
    await flushPromises();
    expect(w.text()).toContain("stopped after 5 wrong dates of birth");
    expect(w.text()).not.toContain("The link works until");
  });

  it("tells an office holding a link opened on a screen before C3s3a to send it", async () => {
    state.invite = { ...APPROVED, signing_opened_at: "2026-09-24T09:00:00Z" };
    const w = mountIt();
    await flushPromises();
    expect(w.text()).toContain("Opened on this screen 09/24/2026");
    expect(button(w, "Send again")).toBeDefined();
  });

  it("shows nothing sent when the office is refused", async () => {
    state.fail = true;
    const w = mountIt();
    await flushPromises();
    await press(w);
    expect(w.text()).not.toContain("Emailed to");
  });

  it("offers nothing once the packet is filed", async () => {
    state.invite = { ...APPROVED, signing_opened_at: "2026-09-24T09:00:00Z", submitted_at: "2026-09-24T11:00:00Z" };
    const w = mountIt();
    await flushPromises();
    expect(w.text()).toContain("Signed and filed");
    expect(w.findAll("button")).toHaveLength(0);
  });

  it("offers a reader no Send button", async () => {
    role.value = "auditor";
    const w = mountIt();
    await flushPromises();
    expect(button(w, "Send for signing")).toBeUndefined();
    expect(state.posts).toHaveLength(0);
  });
});

/** D-AW17 (C3s5): the envelope's two documents, prefilled, previewed from the row that sends them. */
describe("previewing the envelope before sending it", () => {
  it("opens the application and the handbook in the viewer beside the record, and posts nothing", async () => {
    const w = mountIt();
    await flushPromises();
    await button(w, "Preview the application")!.trigger("click");
    expect(w.find("[data-viewer]").attributes("data-path")).toBe(`/api/recruitment/applications/${INV}/preview.pdf`);
    await button(w, "Preview the handbook")!.trigger("click");
    expect(w.find("[data-viewer]").attributes("data-path")).toBe(`/api/recruitment/applicants/${DRIVER}/handbook/preview.pdf`);
    expect(w.find("[data-viewer]").attributes("data-label")).toContain("handbook");
    expect(state.posts).toHaveLength(0);
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("lets a reader preview what they may not send", async () => {
    role.value = "auditor";
    const w = mountIt();
    await flushPromises();
    expect(button(w, "Preview the application")).toBeDefined();
    expect(button(w, "Preview the handbook")).toBeDefined();
  });

  it("offers no preview before approval", async () => {
    state.invite = { ...APPROVED, approved_at: null };
    const w = mountIt();
    await flushPromises();
    expect(button(w, "Preview the application")).toBeUndefined();
  });

  it("closes the viewer when the drawer moves to another applicant", async () => {
    const w = mountIt();
    await flushPromises();
    await button(w, "Preview the handbook")!.trigger("click");
    await w.setProps({ invitationId: "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee" });
    expect(w.find("[data-viewer]").exists()).toBe(false);
  });
});
