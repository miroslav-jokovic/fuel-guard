import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";

/**
 * The office's review of an application (F4, D-AX11–13).
 *
 * ⚠ What is worth pinning is the WINDOW and the ACCOUNT. An office that can still change an answer
 * after the driver has been told to sign it, or that changes one without the driver being able to see
 * what moved, turns this feature from a control into a problem — and neither looks wrong in a diff.
 * Everything else here is a screen rendering a list.
 */

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

/** Renders both slots inline, footer included — Approve lives in `#footer`. */
const SlideOverStub = {
  template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "description"],
};

const ApplicationReviewDrawer = (await import("./ApplicationReviewDrawer.vue")).default;

const PAYLOAD = {
  first_name: "Susan",
  last_name: "Godfrey",
  date_of_birth: "1980-04-01",
  employers: [
    {
      employer_name: "Old Carrier", usdot_number: "", address_line1: "", city: "Jolliet", state: "IL",
      phone: "", email: "", position_held: "Driver", started_on: "2023-01-01", ended_on: "2025-06-30",
      operated_cmv: true, dot_regulated: true, reason_for_leaving: "", subject_to_fmcsr: true,
      safety_sensitive: true,
    },
  ],
  declares_no_accidents: true,
  questionnaire: { position: "Line-haul driver" },
};

const review = (over: Record<string, unknown> = {}) => ({
  ok: true,
  invitationId: "inv-1",
  driverId: "drv-1",
  state: "awaiting_review",
  editable: true,
  payload: PAYLOAD,
  edits: [],
  ...over,
});

const drawer = () =>
  mount(ApplicationReviewDrawer, {
    props: { open: true, invitationId: "inv-1" },
    global: { plugins: [VueQueryPlugin, createPinia()], stubs: { SlideOver: SlideOverStub } },
  });

const settle = async (w: ReturnType<typeof drawer>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

const button = (w: ReturnType<typeof drawer>, label: string) =>
  w.findAll("button").find((b) => b.text().trim().startsWith(label));

beforeEach(() => {
  setActivePinia(createPinia());
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, data: review() });
});

describe("what the office reads", () => {
  it("shows the answers themselves, in the words the driver was asked them in", async () => {
    const w = drawer();
    await settle(w);
    expect(w.text()).toContain("Susan Godfrey");
    expect(w.text()).toContain("Old Carrier");
    // The driver's summary and the office's list call the same field the same thing.
    expect(w.text()).toContain("Employer 1 · City");
  });

  it("says where the application has got to", async () => {
    const w = drawer();
    await settle(w);
    expect(w.text()).toContain("Waiting for you");
  });
});

describe("correcting one answer", () => {
  it("sends the contract path and the new value, and nothing else", async () => {
    const w = drawer();
    await settle(w);

    const city = w.find("input#apply-employers-0-city");
    await city.setValue("Joliet");
    await settle(w);
    apiFetch.mockResolvedValueOnce({ ok: true, data: { ok: true } });
    await button(w, "Save")!.trigger("click");
    await settle(w);

    const call = apiFetch.mock.calls.find((c) => c[1]?.method === "PATCH");
    expect(call?.[0]).toBe("/api/recruitment/applications/inv-1/answer");
    // ⚠ The object, never a JSON string — `apiFetch` serialises it, and a double-encoded body is
    // refused by express and surfaces as a generic 500 with no audit row.
    expect(typeof call?.[1].body).toBe("object");
    expect(call?.[1].body.path).toEqual(["employers", 0, "city"]);
    expect(call?.[1].body.value).toBe("Joliet");
  });

  it("offers nothing to save until something is actually different", async () => {
    // Sixty live Save buttons is sixty chances to record `"Joliet" → "Joliet"`, which the driver then
    // has to read past on the screen asking them what moved.
    const w = drawer();
    await settle(w);
    expect(button(w, "Save")).toBeUndefined();
  });

  it("shows every correction, with what the answer was before it", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      data: review({
        edits: [
          { path: ["employers", 0, "city"], before: "Jolliet", after: "Joliet", editedAt: "2026-09-11T12:00:00Z", editedBy: "Dana" },
        ],
      }),
    });
    const w = drawer();
    await settle(w);
    expect(w.text()).toContain("Jolliet");
    expect(w.text()).toContain("Joliet");
    expect(w.text()).toContain("Corrected");
  });
});

/**
 * ⚠ The window. It would be easy to leave the controls up until the driver signs — the draft is still
 * a draft. It must not be: approval is what tells the driver *this document, now, please sign it*.
 */
describe("when the answers may still be changed", () => {
  it("offers no correction and no approval once it has been sent back to sign", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ state: "approved", editable: false }) });
    const w = drawer();
    await settle(w);
    expect(w.find("input#apply-employers-0-city").exists()).toBe(false);
    expect(button(w, "Approve")).toBeUndefined();
    // And says why, rather than simply having nothing there.
    expect(w.text()).toContain("asked the applicant to sign it");
  });

  it("offers no correction while the driver is still filling it in", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ state: "filling", editable: false, payload: null }) });
    const w = drawer();
    await settle(w);
    expect(button(w, "Approve")).toBeUndefined();
    expect(w.text()).toContain("still filling this in");
  });

  it("says the answers are part of the qualification file once they are signed", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ state: "certified", editable: false }) });
    const w = drawer();
    await settle(w);
    expect(w.text()).toContain("Signed and filed");
  });
});

describe("approving it", () => {
  it("asks the server, and says the applicant has been asked to sign", async () => {
    const w = drawer();
    await settle(w);
    apiFetch.mockResolvedValueOnce({ ok: true, data: { ok: true } });
    await button(w, "Approve")!.trigger("click");
    await settle(w);

    const call = apiFetch.mock.calls.find((c) => c[1]?.method === "POST");
    expect(call?.[0]).toBe("/api/recruitment/applications/inv-1/approve");
  });
});
