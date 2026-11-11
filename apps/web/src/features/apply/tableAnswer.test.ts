import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { addableTables, tableRowText } from "./tableAnswer";
import { describeField } from "./fieldLabels";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch, fetchObjectUrl: vi.fn() }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("recruiter");
  return { useSessionStore: () => s };
});
const ApplicantFactsCard = (await import("./ApplicantFactsCard.vue")).default;

/**
 * F3c part 2, step 4: education and references on the Applicant facts card — each row corrected whole
 * (a cell would be four path segments), added up to the question's limit, removed, and named on 3.1.
 */
const REF = { full_name: "Ann Lee", years_known: "5", phone: "3125550100" };
const review = (refs: unknown[] = [REF]) => ({
  invitationId: "inv-1", driverId: "drv-1", state: "awaiting_review", editable: true, revision: 7, signingStarted: false,
  payload: { first_name: "Susan", last_name: "Godfrey", middle_name: "", addresses: [], questionnaire: { position: "Driver", references: refs } },
  partOne: null, edits: [],
});
const card = (r = review()) =>
  mount(ApplicantFactsCard, {
    props: { invitationId: "inv-1", review: r as never, draftOpen: true, recordOpen: true },
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

describe("a table answer's row", () => {
  it("reads as its answered columns with their labels", () => {
    const cols = [{ id: "full_name", label: "Full name", input: "text" as const }, { id: "graduated", label: "Graduated", input: "yesno" as const }];
    expect(tableRowText(cols, { full_name: "Ann", graduated: true })).toBe("Full name: Ann · Graduated: Yes");
    expect(tableRowText(cols, { full_name: " ", graduated: false })).toBe("Not answered");
  });

  it("is named on 3.1 by its question and number — and a carrier question by its words, not the draft's key", () => {
    expect(describeField(["questionnaire", "references", 1])).toBe("Three personal references · 2");
    expect(describeField(["questionnaire", "position"])).not.toBe("questionnaire");
  });

  it("stops offering an add at the question's own limit", () => {
    const refs = (n: number) => ({ questionnaire: { references: Array.from({ length: n }, () => REF) } });
    expect(addableTables(refs(2), "questions").map((t) => t.question.id)).toContain("references");
    expect(addableTables(refs(3), "questions").map((t) => t.question.id)).not.toContain("references");
  });
});

describe("on the card", () => {
  it("corrects a reference as the whole row, at its place, with the revision read", async () => {
    const w = card();
    await click(w, "[data-fact='questionnaire.references.0']", "Edit");
    await w.find("input#apply-questionnaire-references-0-phone").setValue("3125550199");
    await click(w, "[data-fact='questionnaire.references.0']", "Save");
    expect(sent()).toContainEqual({ path: ["questionnaire", "references", 0], value: { ...REF, phone: "3125550199" }, revision: 7 });
  });

  it("adds a reference at the next place, in the driver's own blank shape", async () => {
    const w = card();
    await w.find("[data-table-add='references']").trigger("click");
    await settle(w);
    await w.find("input#apply-questionnaire-references-1-full_name").setValue("  Bo Diaz  ");
    await click(w, "[data-table-adder='references']", "Save");
    expect(sent()).toContainEqual({ path: ["questionnaire", "references", 1], value: { full_name: "Bo Diaz", years_known: "", phone: "" }, revision: 7 });
  });

  it("removes a reference by its place", async () => {
    const w = card();
    await click(w, "[data-fact='questionnaire.references.0']", "Edit");
    await click(w, "[data-fact='questionnaire.references.0']", "Remove this row");
    expect(sent()).toContainEqual({ op: "remove_answer_row", question: "references", index: 0, revision: 7 });
  });

  it("⚠ never tells the office an ordinary answer is hidden from them (the PR 2221 v-else)", async () => {
    const w = card();
    await click(w, "[data-fact='questionnaire.position']", "Edit");
    expect(w.find("[data-fact='questionnaire.position'] [data-fact-blind]").exists()).toBe(false);
    expect(w.find("[data-fact='questionnaire.position'] [data-fact-on-file]").exists()).toBe(true);
  });
});
