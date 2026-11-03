import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { MEDSTOP_PORTAL_URL, type MedstopStepTests } from "@silvicom/shared";
import MedstopTestCard from "@/features/recruitment/MedstopTestCard.vue";

/**
 * The drug-test step as Med-Stop sees it (MS2c, F-4). Pinned: a recruiter-shaped answer (outcome
 * null) shows the stage and "expected by" and no result; the DER's shows the result; a carrier
 * without Med-Stop sees nothing at all; an unmatched applicant is told why there is nothing.
 * UX4: the order roles get "Order pre-employment test" for an applicant Med-Stop holds as one, and
 * "Add this applicant in Med-Stop first" for one it does not; a role that cannot order gets neither.
 * MSO1: an open drug order replaces the Order button with where and by when, and the order carries the
 * applicant's Part 1 home ZIP to the drawer.
 */
const answer = vi.hoisted(() => ({ value: null as unknown, appointments: [] as unknown[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) =>
    path.includes("drug-test-appointments")
      ? { ok: true, data: { appointments: answer.appointments, timeZone: "America/Chicago" } }
      : { ok: true, data: answer.value }),
}));
const who = vi.hoisted(() => ({ role: "recruiter" as string | null }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => who }));

const tests = (outcome: "negative" | null): MedstopStepTests => ({
  connected: true,
  matched: true,
  applicantMedstopId: null, applicantCreate: null,
  homeZip: "60601",
  outcomesVisible: outcome !== null,
  orders: [{ requestId: "r3", kind: "drug", reason: "PRE-EMPLOYMENT", requestedOn: "2026-10-12", status: "OPEN", site: null, goBy: null }],
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
    answer.appointments = [];
    who.role = "recruiter";
  });

  it("shows a recruiter the order, the stage and when the result is due — never a result", async () => {
    answer.value = tests(null);
    const w = await render();
    expect(w.text()).toContain("ordered 10/12/2026 · not collected yet");
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
    answer.value = { connected: false, matched: false, applicantMedstopId: null, applicantCreate: null, homeZip: null, orders: [], tests: [], outcomesVisible: false };
    const w = await render();
    expect(w.text()).toBe("");
  });

  it("says why there is nothing when Med-Stop has no matched record", async () => {
    answer.value = { connected: true, matched: false, applicantMedstopId: null, applicantCreate: null, orders: [], tests: [], outcomesVisible: false };
    const w = await render();
    expect(w.text()).toContain("no record matched to this applicant");
    expect(w.text()).toContain("Add this applicant in Med-Stop first");
    expect(w.find("a").attributes("href")).toBe(MEDSTOP_PORTAL_URL);
  });

  it("says what creating the applicant in Med-Stop from Part 1 came to, until Med-Stop's roster shows them (UX5c)", async () => {
    const none = { connected: true, matched: false, applicantMedstopId: null, orders: [], tests: [], outcomesVisible: false };
    answer.value = { ...none, applicantCreate: { outcome: "created", message: null, at: "2026-10-13T20:00:00Z" } };
    expect((await render()).text()).toContain("Added to Med-Stop from Part 1");
    answer.value = { ...none, applicantCreate: { outcome: "refused", message: "Licence already on file", at: "2026-10-13T20:00:00Z" } };
    const refused = (await render()).text();
    expect(refused).toContain("did not accept this applicant from Part 1: Licence already on file");
    expect(refused).not.toContain("Add this applicant in Med-Stop first");
  });

  it("offers the recruiter a pre-employment order for an applicant Med-Stop holds, and emits its Med-Stop id and Part 1 home ZIP", async () => {
    answer.value = { ...tests(null), orders: [], applicantMedstopId: "EE-APP" };
    const w = await render();
    const order = w.findAll("button").find((b) => b.text() === "Order pre-employment test");
    expect(order).toBeDefined();
    await order!.trigger("click");
    expect(w.emitted("order")).toEqual([[{ medstopId: "EE-APP", zip: "60601" }]]);
  });

  it("shows an open drug order's site and go-by INSTEAD of the Order button — Med-Stop refuses a second (MSO1, G5)", async () => {
    const open = { requestId: "r9", kind: "drug", reason: "PRE-EMPLOYMENT", requestedOn: "2026-11-04", status: "OPEN", site: "Concentra Joliet", goBy: "2026-11-04T16:00" };
    answer.value = { ...tests(null), tests: [], orders: [open], applicantMedstopId: "EE-APP" };
    answer.appointments = [{ id: "a1", siteName: "Concentra Joliet", siteAddress: "1 Main St", sitePhone: null, windowStart: "2026-11-03T18:00:00Z", windowEnd: "2026-11-04T22:00:00Z", donorReference: "C-1", arrangedAt: "2026-11-03T18:00:00Z", sentToDriverAt: null, cancelledAt: null }];
    const w = await render();
    expect(w.text()).toContain("Concentra Joliet · go by 11/04/2026 4:00 PM · not collected yet");
    expect(w.text()).not.toContain("Order pre-employment test");
    expect(w.text()).toContain("The appointment above holds where to go and the code");
  });

  it("does not claim the order filled an appointment when there is none (an order placed in Med-Stop's portal)", async () => {
    const open = { requestId: "r9", kind: "drug", reason: "PRE-EMPLOYMENT", requestedOn: "2026-11-04", status: "OPEN", site: "Concentra Joliet", goBy: "2026-11-04T16:00" };
    answer.value = { ...tests(null), tests: [], orders: [open], applicantMedstopId: "EE-APP" };
    const w = await render();
    expect(w.text()).toContain("Write where to go in the appointment above");
    expect(w.text()).not.toContain("holds where to go");
  });

  it("offers the order roles 'Didn't go — mark no-show' and 'Cancel order' on the open order, and emits which (MSO2)", async () => {
    const open = { requestId: "r9", kind: "drug", reason: "PRE-EMPLOYMENT", requestedOn: "2026-11-04", status: "OPEN", site: "Concentra Joliet", goBy: "2026-11-04T16:00" };
    answer.value = { ...tests(null), tests: [], orders: [open], applicantMedstopId: "EE-APP" };
    const w = await render();
    await w.findAll("button").find((b) => b.text() === "Didn't go — mark no-show")!.trigger("click");
    await w.findAll("button").find((b) => b.text() === "Cancel order")!.trigger("click");
    expect(w.emitted("closeOrder")).toEqual([[{ requestId: "r9", status: "NO SHOW" }], [{ requestId: "r9", status: "CANCELED" }]]);
    who.role = "dispatcher";
    expect((await render()).text()).not.toContain("mark no-show");
  });

  it("still offers the drug order beside an open ALCOHOL order", async () => {
    const alcohol = { requestId: "r8", kind: "alcohol", reason: "PRE-EMPLOYMENT", requestedOn: "2026-11-04", status: "OPEN", site: null, goBy: null };
    answer.value = { ...tests(null), tests: [], orders: [alcohol], applicantMedstopId: "EE-APP" };
    expect((await render()).text()).toContain("Order pre-employment test");
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
    answer.value = { connected: true, matched: false, applicantMedstopId: null, applicantCreate: null, orders: [], tests: [], outcomesVisible: false };
    expect((await render()).text()).not.toContain("Add this applicant in Med-Stop first");
  });

  it("offers the DER 'Order a recollection' on a negative-dilute pre-employment result, and emits that test (MSO3)", async () => {
    who.role = "safety_manager";
    const dilute = { testId: "t7", kind: "drug", reason: "PRE-EMPLOYMENT", stage: "Result reported", collectedOn: "2026-10-30", expectedOn: null, outcome: "negative_dilute" };
    answer.value = { ...tests("negative"), orders: [], tests: [dilute], applicantMedstopId: "EE-APP" };
    const w = await render();
    await w.findAll("button").find((b) => b.text() === "Order a recollection")!.trigger("click");
    expect(w.emitted("recollect")).toEqual([[{ testId: "t7", medstopId: "EE-APP", collectedOn: "2026-10-30", zip: "60601" }]]);
    // A recruiter is never SENT the outcome (personTests.ts), so the same test offers nothing.
    who.role = "recruiter";
    answer.value = { ...tests(null), orders: [], tests: [{ ...dilute, outcome: null }], applicantMedstopId: "EE-APP" };
    expect((await render()).text()).not.toContain("Order a recollection");
  });
});

