import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { HIRE_REFUSES_WITHOUT, RETURN_TO_DUTY_BLOCK } from "@silvicom/shared";
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
    returnToDutyBlocked: false as boolean,
    returnToDutyCause: null as "violation" | "admission" | null,
    driverId: "d1",
    fullName: "An Applicant",
    status: "applicant",
    skipped: [{ employmentId: "emp-1", employerName: "Old Carrier", reason: "undated_inquiry" }],
    outstanding: [
      { key: "mvr_preemployment", label: "Pre-employment driving record inquiry", citation: "49 CFR §391.23(a)(1)" },
    ],
  },
}));

/** §9 P4: the checklist the six federal checks are read from; `open` lists the ones not done. */
const checklist = vi.hoisted(() => ({ open: [] as string[], hiredRequires: null as string[] | null }));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ path, init });
    if (path.endsWith("/checklist")) {
      const { HIRE_REFUSES_WITHOUT: six } = await import("@silvicom/shared");
      // §9 P12: with `hiredRequires` set, the fold's `hired` row carries the carrier's list.
      const keys = checklist.hiredRequires ?? six;
      const steps: Array<Record<string, unknown>> = keys.map((key) => ({ key, state: checklist.open.includes(key) ? "waiting_on_us" : "done" }));
      if (checklist.hiredRequires) steps.push({ key: "hired", state: "blocked", requires: checklist.hiredRequires });
      return { ok: true, data: { checklist: { steps } } };
    }
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
    global: {
      plugins: [VueQueryPlugin],
      stubs: { SlideOver: SlideOverStub, teleport: true, RouterLink: { props: ["to"], template: '<a :data-to="to"><slot /></a>' } },
    },
  });

const settle = async (w: ReturnType<typeof mountDrawer>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

describe("§9 P4 (Q-WF1 (a)): the six federal checks, before the press", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    checklist.open = [];
    checklist.hiredRequires = null;
  });

  it("lists all six, each done or a link to the row that does it", async () => {
    checklist.open = ["drug_test"];
    const w = mountDrawer();
    await settle(w);
    const rows = w.get('[data-testid="federal-checks"]').findAll("li");
    expect(rows).toHaveLength(HIRE_REFUSES_WITHOUT.length);
    expect(HIRE_REFUSES_WITHOUT).toHaveLength(6);
    expect(w.get('[data-to="/recruitment/d1?step=drug_test"]').text()).toBe("Open");
    expect(rows.filter((r) => r.text().includes("Done"))).toHaveLength(5);
  });

  it("holds the press until all six are done, as the API would refuse", async () => {
    checklist.open = ["road_test"];
    const w = mountDrawer();
    await settle(w);
    const hire = () => w.findAll("button").find((b) => b.text().trim() === "Hire")!;
    expect(hire().attributes("disabled")).toBeDefined();
    checklist.open = [];
    const ready = mountDrawer();
    await settle(ready);
    expect(ready.findAll("button").find((b) => b.text().trim() === "Hire")!.attributes("disabled")).toBeUndefined();
  });
});

describe("§9 P12: the carrier's own rule joins the list", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    checklist.open = [];
    checklist.hiredRequires = null;
  });

  it("lists the handbook as the company's rule and holds the press while it is open", async () => {
    const { hireRefusesWithout } = await import("@silvicom/shared");
    checklist.hiredRequires = hireRefusesWithout({ handbook_blocks_hire: true });
    checklist.open = ["handbook"];
    const w = mountDrawer();
    await settle(w);
    const list = w.get('[data-testid="federal-checks"]');
    expect(list.findAll("li")).toHaveLength(7);
    expect(list.text()).toContain("Before the hire");
    expect(list.text()).toContain("your company's rule");
    expect(w.get('[data-to="/recruitment/d1?step=handbook"]').text()).toBe("Open");
    expect(w.findAll("button").find((b) => b.text().trim() === "Hire")!.attributes("disabled")).toBeDefined();
  });
});

describe("hiring an applicant", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    calls.length = 0;
    checklist.open = [];
    preview.value.returnToDutyBlocked = false;
    preview.value.returnToDutyCause = null;
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
    // The wire value, set on the component: the picker's input shows `09/01/2026` (D-DS17) and this
    // test is about what reaches the API.
    w.findComponent({ name: "AppDateField" }).vm.$emit("update:modelValue", "2026-09-01");
    await w.vm.$nextTick();
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

  /**
   * MS2 (F-5): a hold that comes from Med-Stop is worded without the result. The recruiter read the
   * applicant's own admission, so that copy says it plainly; they may not read a testing record, so
   * this one says only that the driving waits.
   */
  it("words a Med-Stop hold without the result, and an admission plainly", async () => {
    preview.value.returnToDutyBlocked = true;
    preview.value.returnToDutyCause = "violation";
    const w = mountDrawer();
    await settle(w);
    expect(w.text()).toContain(RETURN_TO_DUTY_BLOCK.hireViolation);
    expect(w.text()).not.toContain(RETURN_TO_DUTY_BLOCK.hire);

    preview.value.returnToDutyCause = "admission";
    const v = mountDrawer();
    await settle(v);
    expect(v.text()).toContain(RETURN_TO_DUTY_BLOCK.hire);
  });
});
