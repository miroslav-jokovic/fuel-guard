import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { MEDSTOP_PORTAL_URL, type MedstopPersonTests } from "@silvicom/shared";
import MedstopTestCard from "@/features/recruitment/MedstopTestCard.vue";

/**
 * The drug-test step as Med-Stop sees it (MS2c, F-4). Pinned: a recruiter-shaped answer (outcome
 * null) shows the stage and "expected by" and no result; the DER's shows the result; a carrier
 * without Med-Stop sees nothing at all; an unmatched applicant is told why there is nothing.
 * UX4: the order roles get "Order pre-employment test" for an applicant Med-Stop holds as one, and
 * "Add this applicant in Med-Stop first" for one it does not; a role that cannot order gets neither.
 */
const answer = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => ({ ok: true, data: answer.value })),
}));
const who = vi.hoisted(() => ({ role: "recruiter" as string | null }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => who }));

const tests = (outcome: "negative" | null): MedstopPersonTests => ({
  connected: true,
  matched: true,
  applicantMedstopId: null,
  outcomesVisible: outcome !== null,
  orders: [{ requestId: "r3", kind: "drug", reason: "PRE-EMPLOYMENT", requestedOn: "2026-10-12", status: "OPEN" }],
  tests: [
    { testId: "t2", kind: "drug", reason: "PRE-EMPLOYMENT", stage: "At the lab", collectedOn: "2026-10-09", expectedOn: "2026-10-13", outcome: outcome === null ? null : "pending" },
    { testId: "t1", kind: "drug", reason: "PRE-EMPLOYMENT", stage: "Result reported", collectedOn: "2026-09-01", expectedOn: null, outcome },
  ],
});

const render = async () => {
  const w = mount(MedstopTestCard, { props: { driverId: "d1" }, global: { plugins: [VueQueryPlugin] } });
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
  return w;
};

describe("MedstopTestCard", () => {
  beforeEach(() => {
    answer.value = null;
    who.role = "recruiter";
  });

  it("shows a recruiter the order, the stage and when the result is due — never a result", async () => {
    answer.value = tests(null);
    const w = await render();
    expect(w.text()).toContain("ordered 10/12/2026, not collected yet");
    expect(w.text()).toContain("At the lab");
    expect(w.text()).toContain("result expected by 10/13/2026");
    expect(w.text()).toContain("Result reported");
    expect(w.text()).not.toMatch(/Negative|Positive|Pending/);
  });

  it("shows the DER the result", async () => {
    answer.value = tests("negative");
    const w = await render();
    expect(w.text()).toContain("Negative");
    expect(w.text()).not.toContain("Pending");
  });

  it("renders nothing for a carrier that has not connected Med-Stop", async () => {
    answer.value = { connected: false, matched: false, applicantMedstopId: null, orders: [], tests: [], outcomesVisible: false };
    const w = await render();
    expect(w.text()).toBe("");
  });

  it("says why there is nothing when Med-Stop has no matched record", async () => {
    answer.value = { connected: true, matched: false, applicantMedstopId: null, orders: [], tests: [], outcomesVisible: false };
    const w = await render();
    expect(w.text()).toContain("no record matched to this applicant");
    expect(w.text()).toContain("Add this applicant in Med-Stop first");
    expect(w.find("a").attributes("href")).toBe(MEDSTOP_PORTAL_URL);
  });

  it("offers the recruiter a pre-employment order for an applicant Med-Stop holds, and emits its Med-Stop id", async () => {
    answer.value = { ...tests(null), applicantMedstopId: "EE-APP" };
    const w = await render();
    const order = w.findAll("button").find((b) => b.text() === "Order pre-employment test");
    expect(order).toBeDefined();
    await order!.trigger("click");
    expect(w.emitted("order")).toEqual([["EE-APP"]]);
  });

  it("offers no order when Med-Stop holds the person on its active roster, not as an applicant", async () => {
    answer.value = tests(null);
    const w = await render();
    expect(w.text()).not.toContain("Order pre-employment test");
  });

  it("offers a role outside the order roles neither the order nor the way to add the applicant", async () => {
    who.role = "dispatcher";
    answer.value = { ...tests(null), applicantMedstopId: "EE-APP" };
    expect((await render()).text()).not.toContain("Order pre-employment test");
    answer.value = { connected: true, matched: false, applicantMedstopId: null, orders: [], tests: [], outcomesVisible: false };
    expect((await render()).text()).not.toContain("Add this applicant in Med-Stop first");
  });
});
