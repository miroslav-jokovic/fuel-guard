import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import HireDrawer from "@/features/recruitment/HireDrawer.vue";

/**
 * The drawer's job is to be read before the button is pressed. An inquiry marked sent with no date
 * cannot become a §391.51 record — the handoff refuses to invent one — and this is the last moment
 * anybody will notice while it is still cheap to fix. So what is pinned is that the skip is SHOWN,
 * in words a person can act on, rather than being a number in a response nobody reads.
 */

const calls: Array<{ path: string; init?: { method?: string; body?: unknown } }> = [];
const preview = vi.hoisted(() => ({
  value: {
    driverId: "d1",
    fullName: "An Applicant",
    status: "applicant",
    skipped: [{ employmentId: "emp-1", employerName: "Old Carrier", reason: "undated_inquiry" }],
    outstanding: [
      { key: "mvr_preemployment", label: "Pre-employment driving record inquiry", citation: "49 CFR §391.23(a)(1)" },
    ],
  },
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ path, init });
    if (path.includes("hire-preview")) return { ok: true, data: preview.value };
    return { ok: true, data: { driverId: "d1", hireDate: "2026-08-19", filed: 1, skipped: [], outstanding: [] } };
  }),
}));

const SlideOverStub = {
  template: "<div><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "description"],
};

const mountDrawer = () =>
  mount(HireDrawer, {
    props: { open: true, driverId: "d1", fullName: "An Applicant" },
    global: { plugins: [VueQueryPlugin], stubs: { SlideOver: SlideOverStub, teleport: true } },
  });

const settle = async (w: ReturnType<typeof mountDrawer>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

describe("hiring an applicant", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    calls.length = 0;
  });

  it("shows what will not be filed, and why, in words a recruiter can act on", async () => {
    const w = mountDrawer();
    await settle(w);
    expect(w.text()).toContain("Old Carrier");
    expect(w.text()).toContain("Marked sent, but with no date");
  });

  /**
   * ⚠ Was "…with its citation", asserting "§391.23(a)(1)" rendered beside the requirement's label.
   * The citation still travels in the payload (`useHire.ts`'s `OutstandingItem.citation`, and
   * `dqCatalogue.ts` behind it) because a printed file and counsel both want it — it simply stopped
   * being rendered on 2026-08-22. What a recruiter needs from this list is the NAME of the thing
   * still missing, which is what the label is.
   */
  it("names what the qualification file will still need, without citing a regulation at it", async () => {
    const w = mountDrawer();
    await settle(w);
    expect(w.text()).toContain("Pre-employment driving record inquiry");
    expect(w.text()).not.toMatch(/§|\bCFR\b/);
  });

  it("posts the driver and the hire date, and nothing else", async () => {
    const w = mountDrawer();
    await settle(w);
    await w.find('input[type="date"]').setValue("2026-09-01");
    await w.findAll("button").find((b) => b.text() === "Hire")!.trigger("click");
    await settle(w);

    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.path).toBe("/api/recruitment/hire");
    expect(post.init?.body).toEqual({ driver_id: "d1", hire_date: "2026-09-01" });
  });

  /** Nothing about the file blocks the hire — the carrier hired somebody, and refusing to write it
   *  down does not undo that. */
  it("offers the hire even when the file is incomplete", async () => {
    const w = mountDrawer();
    await settle(w);
    const hire = w.findAll("button").find((b) => b.text() === "Hire")!;
    expect(hire.attributes("disabled")).toBeUndefined();
  });
});
