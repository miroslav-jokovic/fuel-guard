import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { questionnaireForApplicant } from "@silvicom/shared";
import { applicantFactRows } from "./applicantFactRows";
import { identityFrom, identityIncomplete } from "./identityTogether";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch, fetchObjectUrl: vi.fn() }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("recruiter");
  return { useSessionStore: () => s };
});
const ApplicantFactsCard = (await import("./ApplicantFactsCard.vue")).default;

/**
 * F3c part 2, step 6: the card is the one editor of the date of birth and licence. So it shows them from
 * the applicant's RECORD (the draft may not hold them yet), enters all three together while any is
 * missing, and opens at them when a hiring step sends the office there.
 */
const ON_RECORD = { date_of_birth: "1980-04-01", cdl_number: "IL123", cdl_state: "IL" };
const rowsOf = (payload: Record<string, unknown> | null, identity?: Record<string, string>) =>
  applicantFactRows({ payload, partOne: null, edits: [], questionnaire: questionnaireForApplicant(), identity });
const shown = (rows: ReturnType<typeof rowsOf>) =>
  Object.fromEntries(rows.filter((r) => r.door === "identity").map((r) => [r.key, r.value]));

describe("the identity on the card", () => {
  it("⚠ shows the record's identity when there is no draft yet, not \"Not answered\"", () => {
    expect(shown(rowsOf(null, ON_RECORD))).toEqual(ON_RECORD);
    expect(shown(rowsOf(null))).toEqual({ date_of_birth: null, cdl_number: null, cdl_state: null });
  });

  it("lays the record over a stale draft copy, as filing does — but never a missing value over an answer", () => {
    const draft = { date_of_birth: "1980-01-01", cdl_number: "OLD1", cdl_state: "WI" };
    expect(shown(rowsOf(draft, ON_RECORD))).toEqual(ON_RECORD);
    expect(shown(rowsOf(draft, { cdl_number: "IL123" }))).toEqual({ ...draft, cdl_number: "IL123" });
  });

  it("is entered together while any of the three is missing", () => {
    expect(identityIncomplete(rowsOf(null, ON_RECORD))).toBe(false);
    expect(identityIncomplete(rowsOf(null, { date_of_birth: "1980-04-01" }))).toBe(true);
    expect(identityFrom({ ...ON_RECORD })).toEqual({ identity: ON_RECORD });
    expect(identityFrom({ ...ON_RECORD, cdl_number: "" })).toHaveProperty("problem");
  });
});

const review = (identity: Record<string, string>) => ({
  invitationId: "inv-1", driverId: "drv-1", state: "filling", editable: true, revision: 0, signingStarted: false,
  payload: null, partOne: null, edits: [], identity,
});
const card = (identity: Record<string, string>, focus?: string) =>
  mount(ApplicantFactsCard, {
    props: { invitationId: "inv-1", review: review(identity) as never, draftOpen: true, recordOpen: true, focus },
    global: { plugins: [VueQueryPlugin, createPinia()], stubs: { OfficeJobsSection: true } },
    attachTo: document.body,
  });
const settle = async (w: ReturnType<typeof card>) => {
  for (let i = 0; i < 6; i++) { await w.vm.$nextTick(); await new Promise((r) => setTimeout(r, 0)); }
};
const click = async (w: ReturnType<typeof card>, scope: string, label: string) => {
  await w.find(scope).findAll("button").find((b) => b.text().trim() === label)!.trigger("click");
  await settle(w);
};

beforeEach(() => {
  setActivePinia(createPinia());
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, data: { ok: true } });
  document.body.innerHTML = "";
});

describe("on the card", () => {
  it("enters the date of birth and licence together when the licence is missing, through the identity route", async () => {
    const w = card({ date_of_birth: "1980-04-01", cdl_state: "IL" });
    await click(w, "[data-fact='cdl_number']", "Edit");
    const editor = w.get("[data-identity-together]");
    // All three open, holding what is on file.
    expect(editor.findAll("label").map((l) => l.text())).toHaveLength(3);
    await editor.get("input#apply-identity-cdl_number").setValue("  IL999  ");
    await click(w, "[data-identity-together]", "Save");
    const call = apiFetch.mock.calls.find((c) => String(c[0]).endsWith("/identity"));
    expect(call?.[1]).toMatchObject({ method: "POST", body: { date_of_birth: "1980-04-01", cdl_number: "IL999", cdl_state: "IL" } });
  });

  it("corrects one answer at a time once all three are on file", async () => {
    const w = card(ON_RECORD);
    await click(w, "[data-fact='cdl_number']", "Edit");
    expect(w.find("[data-identity-together]").exists()).toBe(false);
    expect(w.find("input#apply-cdl_number").exists()).toBe(true);
  });

  it("brings the row a hiring step asked for into view", async () => {
    const seen: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) { seen.push(this.getAttribute("data-fact") ?? ""); };
    const w = card(ON_RECORD, "date_of_birth");
    await settle(w);
    expect(seen).toEqual(["date_of_birth"]);
    card(ON_RECORD);
    await settle(w);
    expect(seen).toEqual(["date_of_birth"]);
  });
});
