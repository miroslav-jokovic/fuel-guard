import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { RATHER_NOT_SAY } from "@silvicom/shared";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch, fetchObjectUrl: vi.fn() }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("recruiter");
  return { useSessionStore: () => s };
});

const ApplicantFactsCard = (await import("./ApplicantFactsCard.vue")).default;

/**
 * F3c part 2, step 5: the carrier's own questions on the Applicant facts card — worded from THIS
 * applicant's stamp, corrected with the control the form asked them with, an optional one's skip
 * offered as the form offers it (a box that puts the control away).
 */
const START = "q-start";
const STARTED = "q-started";
const STAMP = [
  { id: START, wording: "Can you start within two weeks?", hint: null, kind: "boolean", choices: null, required: false },
  { id: STARTED, wording: "When did you last drive?", hint: null, kind: "date", choices: null, required: true },
];
const review = (answers: Record<string, unknown>) => ({
  invitationId: "inv-1", driverId: "drv-1", state: "awaiting_review", editable: true, revision: 7, signingStarted: false,
  payload: { first_name: "Susan", last_name: "Godfrey", middle_name: "", addresses: [], carrier_answers: answers },
  partOne: null, edits: [], carrierQuestions: STAMP,
});
const card = (answers: Record<string, unknown>) =>
  mount(ApplicantFactsCard, {
    props: { invitationId: "inv-1", review: review(answers) as never, draftOpen: true, recordOpen: true },
    global: { plugins: [VueQueryPlugin, createPinia()], stubs: { OfficeJobsSection: true } },
  });
const settle = async (w: ReturnType<typeof card>) => {
  for (let i = 0; i < 6; i++) { await w.vm.$nextTick(); await new Promise((r) => setTimeout(r, 0)); }
};
const sent = () => apiFetch.mock.calls.map((c) => (c[1] as { body?: unknown } | undefined)?.body);
const click = async (w: ReturnType<typeof card>, scope: string, label: string) => {
  await w.find(scope).findAll("button").find((b) => b.text().trim() === label)!.trigger("click");
  await settle(w);
};

beforeEach(() => {
  setActivePinia(createPinia());
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, data: { ok: true, revision: 8, payload: {} } });
});

describe("the carrier's own questions on the card", () => {
  it("shows each by the words this applicant was asked, under the carrier's own questions", () => {
    const w = card({ [START]: true, [STARTED]: "03/01/2026" });
    expect(w.find(`[data-fact='carrier_answers.${START}']`).text()).toMatch(/Can you start within two weeks\?\s*Yes/);
    expect(w.find(`[data-fact='carrier_answers.${STARTED}']`).text()).toContain("03/01/2026");
  });

  it("opens a skipped answer with the skip ticked and the control put away; unticked, it is answered and sent", async () => {
    const w = card({ [START]: RATHER_NOT_SAY.value });
    const row = `[data-fact='carrier_answers.${START}']`;
    await click(w, row, "Edit");
    const skip = w.find(`${row} input[data-fact-skip]`);
    expect((skip.element as HTMLInputElement).checked).toBe(true);
    expect(w.find(`${row} fieldset`).exists()).toBe(false);
    // The question is still named while its yes/no is put away.
    expect(w.find(`${row} [data-fact-skip-question]`).text()).toBe("Can you start within two weeks?");
    await skip.setValue(false);
    await settle(w);
    await w.find(`${row} fieldset`).findAll("input[type='radio']")[0]!.setValue(true);
    await click(w, row, "Save");
    expect(sent()).toContainEqual({ path: ["carrier_answers", START], value: true, revision: 7 });
  });

  it("sends the skip's own words when the office ticks it", async () => {
    const w = card({ [START]: false });
    const row = `[data-fact='carrier_answers.${START}']`;
    await click(w, row, "Edit");
    await w.find(`${row} input[data-fact-skip]`).setValue(true);
    await settle(w);
    await click(w, row, "Save");
    expect(sent()).toContainEqual({ path: ["carrier_answers", START], value: RATHER_NOT_SAY.value, revision: 7 });
  });

  it("corrects a date in the plain box the form typed it into, and offers no skip on a required question", async () => {
    const w = card({ [STARTED]: "03/01/2026" });
    const row = `[data-fact='carrier_answers.${STARTED}']`;
    await click(w, row, "Edit");
    expect(w.find(`${row} [data-fact-skip]`).exists()).toBe(false);
    await w.find(`input#apply-carrier_answers-${STARTED}`).setValue("04/01/2026");
    await click(w, row, "Save");
    expect(sent()).toContainEqual({ path: ["carrier_answers", STARTED], value: "04/01/2026", revision: 7 });
  });
});
