import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";

/**
 * The office removing a job and explaining a gap (HIRING-WORKFLOW-AUDIT-2026-10-31 §9 P5, AF-4, Q-AX7),
 * on the one timeline with the one employer form's panel since HW5b.
 * ⚠ Asserts the BODY sent: the row by its key and the revision the drawer read are the whole point —
 * a position would re-point every correction after it, and no revision would write over the phone.
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
const confirmAnswer = vi.hoisted(() => ({ value: true, asked: [] as unknown[] }));
vi.mock("@silvicom/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@silvicom/ui")>()),
  useConfirm: () => async (request: unknown) => {
    confirmAnswer.asked.push(request);
    return confirmAnswer.value;
  },
}));
// Signed out unless a test says otherwise, so the PSP read (HW6b) stays off for the tests above it.
const sessionHolder = vi.hoisted(() => ({ s: null as null | { role: string | null } }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession(null);
  sessionHolder.s = s;
  return { useSessionStore: () => s };
});
const OfficeJobsSection = (await import("./OfficeJobsSection.vue")).default;

const KEY_A = "40000000-0000-4000-8000-00000000000a";
const KEY_B = "40000000-0000-4000-8000-00000000000b";
const job = (key: string, name: string, started_on: string, ended_on: string) => ({
  key, employer_name: name, usdot_number: "", address_line1: "1 Rd", city: "Joliet", state: "IL", phone: "", email: "",
  position_held: "Driver", started_on, ended_on, operated_cmv: true, dot_regulated: true, reason_for_leaving: "Moved",
  subject_to_fmcsr: true, safety_sensitive: true,
});

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 8; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
// Jobs up to a year ago, then nothing: a gap at the end of the three years, whatever today is.
const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
const mountIt = (employers = [job(KEY_A, "Old Carrier", "2015-01-01", yearAgo), { key: KEY_B, employer_name: "" }]) =>
  mount(OfficeJobsSection, {
    props: { invitationId: "inv-1", driverId: "drv-1", employers, givenGaps: [], revision: 7, v2: true, editable: true },
    global: {
      plugins: [VueQueryPlugin],
      stubs: { SlideOver: { template: "<div v-if='open'><slot /><slot name='footer' /></div>", props: ["open", "title", "size", "description"] } },
    },
  });
/** Open a job's panel from its card on the timeline, and press the panel's Remove. */
async function removeFromPanel(w: ReturnType<typeof mountIt>, key: string): Promise<void> {
  await w.get(`[data-job="${key}"] button`).trigger("click");
  await settle(w);
  await w.findAll("button").find((b) => b.text() === "Remove this job")!.trigger("click");
  await settle(w);
}
const patches = () => apiFetch.mock.calls.filter((c) => c[1]?.method === "PATCH").map((c) => c[1].body);

beforeEach(() => {
  setActivePinia(createPinia());
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, data: { ok: true } });
  confirmAnswer.value = true;
  confirmAnswer.asked = [];
  sessionHolder.s!.role = null;
});

describe("removing a job (AF-4, Q-AX7)", () => {
  it("names a blank row so it can be found, and removes it by its key after a confirm", async () => {
    const w = mountIt();
    await settle(w);
    expect(w.get('[data-testid="jobs"]').text()).toContain("A job with no name");
    await removeFromPanel(w, KEY_B);
    expect(confirmAnswer.asked).toHaveLength(1);
    expect(patches()).toEqual([{ op: "remove_employer", key: KEY_B, revision: 7 }]);
  });

  it("removes nothing when the confirm is declined", async () => {
    confirmAnswer.value = false;
    const w = mountIt();
    await settle(w);
    await removeFromPanel(w, KEY_A);
    expect(confirmAnswer.asked).toHaveLength(1);
    expect(patches()).toEqual([]);
  });

  it("offers no removal for a row with no key yet — it cannot be named safely", async () => {
    const w = mountIt([{ employer_name: "Legacy" } as never]);
    await settle(w);
    await w.get('[data-job="row-0"] button').trigger("click");
    await settle(w);
    expect(w.text()).toContain("Save this job");
    expect(w.findAll("button").filter((b) => b.text() === "Remove this job")).toHaveLength(0);
  });
});

describe("explaining a gap", () => {
  it("lists the gap a filing will ask about, and sends the explanation with the revision", async () => {
    const w = mountIt();
    await settle(w);
    const gaps = w.get(`[data-gap="${yearAgo}"]`);
    expect(gaps.text()).toContain("days");
    await gaps.get("input").setValue("Caring for a parent");
    await settle(w);
    await gaps.findAll("button").find((b) => b.text() === "Explain this gap")!.trigger("click");
    await settle(w);
    const body = patches()[0];
    expect(body).toMatchObject({ op: "explain_gap", revision: 7, gap: { explanation: "Caring for a parent", from: yearAgo } });
  });
});

describe("a gap, on the timeline", () => {
  it("opens the one form with the gap's dates in it from Add a job here", async () => {
    const w = mountIt();
    await settle(w);
    await w.get(`[data-gap="${yearAgo}"]`).findAll("button").find((b) => b.text() === "Add a job here")!.trigger("click");
    await settle(w);
    const from = w.findAllComponents({ name: "AppDateField" }).find((d) => d.html().includes('id="office-employer-started_on"'))!;
    expect(from.props("modelValue")).toBe(yearAgo);
  });
});

describe("HW6b: what the applicant's PSP record suggests", () => {
  const SUGGESTIONS = {
    report: { requestId: "psp-1", pulledOn: "2026-08-20" },
    unlisted: [
      { usdotNumber: "113529", carrierName: "ACME HAULING", firstSeen: "2024-10-06", lastSeen: "2025-04-03", inspections: 2, crashes: 0, owedTo: "b10" },
    ],
    employers: [
      { key: KEY_A, index: 0, match: "corroborated", inspections: 1, crashes: 0 },
      { key: KEY_B, index: 1, match: "no_psp_activity", inspections: 0, crashes: 0 },
    ],
    inspectionWindowStart: "2023-08-20",
    crashWindowStart: "2021-08-20",
  };
  const pspReads = () => apiFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("psp-employment"));
  const answering = (body: unknown) =>
    apiFetch.mockImplementation(async (url: string) =>
      url.includes("psp-employment") ? { ok: true, data: body } : { ok: true, data: { ok: true } });

  it("asks for the DRAFT's suggestions, and names the carrier the list does not, with its dates and an honest limit", async () => {
    sessionHolder.s!.role = "recruiter";
    answering(SUGGESTIONS);
    const w = mountIt();
    await settle(w);
    expect(pspReads()).toEqual(["/api/recruitment/drivers/drv-1/psp-employment?invitationId=inv-1"]);
    const block = w.get('[data-testid="psp-suggestions"]').text();
    expect(block).toContain(
      "PSP shows 2 inspections under ACME HAULING, DOT 113529, between 10/06/2024 and 04/03/2025 — not on their list.",
    );
    expect(block).toContain("PSP report of 08/20/2026.");
    expect(block).toContain("Most drivers have more jobs than this.");
    expect(block).toContain("Inside the last 3 years, so it belongs on the list.");
  });

  it("marks the job PSP backs up, and only that one", async () => {
    sessionHolder.s!.role = "recruiter";
    answering(SUGGESTIONS);
    const w = mountIt();
    await settle(w);
    expect(w.find(`[data-job="${KEY_A}"] [data-seen-in-psp]`).exists()).toBe(true);
    expect(w.find(`[data-job="${KEY_B}"] [data-seen-in-psp]`).exists()).toBe(false);
  });

  it("finds a keyless job from before AW1 by its position", async () => {
    sessionHolder.s!.role = "recruiter";
    answering({ ...SUGGESTIONS, employers: [{ key: null, index: 0, match: "corroborated", inspections: 1, crashes: 0 }] });
    const w = mountIt([{ employer_name: "Legacy", started_on: "2020-01-01" } as never]);
    await settle(w);
    expect(w.find('[data-job="row-0"] [data-seen-in-psp]').exists()).toBe(true);
  });

  it("'Add as a job' opens the one employer form with the carrier in it, and writes nothing by itself", async () => {
    sessionHolder.s!.role = "recruiter";
    answering(SUGGESTIONS);
    const w = mountIt();
    await settle(w);
    await w.get('[data-psp-carrier="113529"]').findAll("button").find((b) => b.text() === "Add as a job")!.trigger("click");
    await settle(w);
    expect((w.get("#office-employer-employer_name").element as HTMLInputElement).value).toBe("ACME HAULING");
    expect((w.get("#office-employer-usdot_number").element as HTMLInputElement).value).toBe("113529");
    const date = (id: string) =>
      w.findAllComponents({ name: "AppDateField" }).find((d) => d.html().includes(`id="office-employer-${id}"`))!.props("modelValue");
    expect([date("started_on"), date("ended_on")]).toEqual(["2024-10-06", "2025-04-03"]);
    expect(patches()).toEqual([]);
  });

  it("offers no Add once the window has closed", async () => {
    sessionHolder.s!.role = "recruiter";
    answering(SUGGESTIONS);
    const w = mount(OfficeJobsSection, {
      props: { invitationId: "inv-1", driverId: "drv-1", employers: [], givenGaps: [], revision: 7, v2: true, editable: false },
      global: { plugins: [VueQueryPlugin] },
    });
    await settle(w);
    expect(w.get('[data-testid="psp-suggestions"]').text()).toContain("ACME HAULING");
    expect(w.findAll("button").some((b) => b.text() === "Add as a job")).toBe(false);
  });

  it("never shows one applicant's PSP carriers over another's", async () => {
    sessionHolder.s!.role = "recruiter";
    answering(SUGGESTIONS);
    const w = mountIt();
    await settle(w);
    expect(w.find('[data-testid="psp-suggestions"]').exists()).toBe(true);
    // The next applicant, at the SAME revision number: only the driver and the invitation tell the two
    // apart, so a cache keyed on anything less hands back the first applicant's carriers.
    answering({ report: null, unlisted: [], employers: [], inspectionWindowStart: null, crashWindowStart: null });
    await w.setProps({ driverId: "drv-2", invitationId: "inv-2" });
    await settle(w);
    expect(pspReads()).toContain("/api/recruitment/drivers/drv-2/psp-employment?invitationId=inv-2");
    expect(w.find('[data-testid="psp-suggestions"]').exists()).toBe(false);
  });

  it("never asks for a fleet manager, who may not read a PSP report", async () => {
    sessionHolder.s!.role = "fleet_manager";
    answering(SUGGESTIONS);
    const w = mountIt();
    await settle(w);
    expect(pspReads()).toEqual([]);
    expect(w.find('[data-testid="psp-suggestions"]').exists()).toBe(false);
  });

  it("shows nothing when there is no machine-readable report", async () => {
    sessionHolder.s!.role = "recruiter";
    answering({ report: null, unlisted: [], employers: [], inspectionWindowStart: null, crashWindowStart: null });
    const w = mountIt();
    await settle(w);
    expect(pspReads()).toHaveLength(1);
    expect(w.find('[data-testid="psp-suggestions"]').exists()).toBe(false);
  });
});
