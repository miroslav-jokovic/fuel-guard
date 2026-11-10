import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { APPLICANT_FACTS, questionnaireForApplicant } from "@silvicom/shared";
import { emptyAddress } from "./draftShape";
import { blankRow, editableLists, factBlocks, rowColumns, rowRemovable } from "./factRowLists";
import { applicantFactRows } from "./applicantFactRows";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch, fetchObjectUrl: vi.fn() }));

/**
 * F3c part 2 (E2): the office adds a row to a list, or removes one, as ONE correction the driver
 * reads on 3.1. What is worth pinning: the new row is the driver's own shape (blanks `""`), its
 * questions are the catalogue's, the current home is never removable, and on a v2 link the licences
 * are not the draft's to change.
 */
const HOME = { line1: "1 Main St", line2: "", city: "Joliet", state: "IL", postal_code: "60431", from: "2023-01", to: "" };
const OLD = { line1: "9 Old Rd", line2: "", city: "Gary", state: "IN", postal_code: "46401", from: "2019-01", to: "2022-12" };
const OLDER = { ...OLD, city: "Hammond", from: "2015-01", to: "2018-12" };

describe("the lists' rows", () => {
  it("asks a new address the catalogue's questions, in its order", () => {
    const fromCatalogue = APPLICANT_FACTS.filter((f) => f.path.startsWith("application.addresses[].")).map((f) => f.path.split("[].")[1]);
    expect(rowColumns("addresses", 2).map((c) => c.column)).toEqual(fromCatalogue);
    expect(rowColumns("addresses", 2)[2]!.label).toBe("Address 3 · City");
  });

  it("⚠ opens a new row as the driver's own blank row: blanks are \"\", never null", () => {
    expect(blankRow("addresses")).toEqual(emptyAddress());
    expect(Object.values(blankRow("accidents") as Record<string, unknown>)).not.toContain(null);
    expect(blankRow("other_names")).toBe("");
  });

  it("⚠ never offers the current home for removal, wherever it sits", () => {
    expect(rowRemovable("addresses", 0, [HOME, OLD])).toBe(false);
    expect(rowRemovable("addresses", 1, [OLD, HOME])).toBe(false);
    expect(rowRemovable("addresses", 0, [OLD, HOME])).toBe(true);
    expect(rowRemovable("accidents", 0, [HOME])).toBe(true);
  });

  it("leaves the licences to Part 1 on a v2 link", () => {
    expect(editableLists(true)).not.toContain("additional_licences");
    expect(editableLists(false)).toContain("additional_licences");
  });

  it("keeps each row's answers together as one block", () => {
    const rows = applicantFactRows({
      payload: { addresses: [HOME, OLD] }, partOne: null, edits: [], questionnaire: questionnaireForApplicant(),
    });
    const items = factBlocks(rows).filter((b) => b.kind === "item" && b.list === "addresses");
    expect(items.map((b) => (b.kind === "item" ? [b.index, b.rows.length] : null))).toEqual([[0, 7], [1, 7]]);
  });
});

describe("the corrected mark after a removal", () => {
  it("follows a correction up when an earlier row is removed, and drops the removed row's own", () => {
    const rows = applicantFactRows({
      payload: { addresses: [HOME, OLDER] },
      partOne: null,
      questionnaire: questionnaireForApplicant(),
      edits: [
        { path: ["addresses", 2, "city"], before: "Ham", after: "Hammond", editedAt: "2026-11-10T10:00:00Z" },
        { path: ["addresses", 1, "city"], before: "G", after: "Gary", editedAt: "2026-11-10T10:01:00Z" },
        { path: ["addresses", 1], before: OLD, after: null, editedAt: "2026-11-10T10:02:00Z" },
      ],
    });
    const corrected = rows.filter((r) => r.corrected).map((r) => r.key);
    expect(corrected).toEqual(["addresses.1.city"]);
  });
});

// ── the card ───────────────────────────────────────────────────────────────────────────────────
const sessionHolder = vi.hoisted(() => ({ s: null as null | { role: string | null } }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("recruiter");
  sessionHolder.s = s;
  return { useSessionStore: () => s };
});
const ApplicantFactsCard = (await import("./ApplicantFactsCard.vue")).default;

const review = (over: Record<string, unknown> = {}) => ({
  invitationId: "inv-1", driverId: "drv-1", state: "awaiting_review", editable: true, revision: 7, signingStarted: false,
  payload: { first_name: "Susan", last_name: "Godfrey", addresses: [HOME, OLD], other_names: [], declares_no_accidents: false, accidents: [] },
  partOne: null, edits: [], ...over,
});
let pinia: ReturnType<typeof createPinia>;
const card = (r = review(), draftOpen = true) =>
  mount(ApplicantFactsCard, {
    props: { invitationId: "inv-1", review: r as never, draftOpen, recordOpen: draftOpen },
    global: { plugins: [VueQueryPlugin, pinia], stubs: { OfficeJobsSection: true } },
  });
const settle = async (w: ReturnType<typeof card>) => {
  for (let i = 0; i < 6; i++) { await w.vm.$nextTick(); await new Promise((r) => setTimeout(r, 0)); }
};
const sent = () => apiFetch.mock.calls.map((c) => (c[1] as { body?: unknown } | undefined)?.body);

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, data: { ok: true, revision: 8, payload: {} } });
});

describe("adding and removing on the card", () => {
  it("removes an earlier address as one remove_row naming its position and the revision read", async () => {
    const w = card();
    expect(w.find("[data-fact-remove='addresses.0']").exists()).toBe(false); // the current home
    const remove = w.find("[data-fact-remove='addresses.1']");
    await remove.find("button").trigger("click");
    const confirm = w.find("[data-fact-remove='addresses.1']").findAll("button").find((b) => b.text() === "Remove")!;
    await confirm.trigger("click");
    await settle(w);
    expect(sent()).toContainEqual({ op: "remove_row", list: "addresses", index: 1, revision: 7 });
  });

  it("adds a name as one add_row holding the whole row", async () => {
    const w = card();
    await w.find("[data-fact-add='other_names']").trigger("click");
    await w.find("[data-fact-adder='other_names'] input").setValue("Susan Smith");
    await w.find("[data-fact-adder='other_names']").findAll("button").find((b) => b.text() === "Add")!.trigger("click");
    await settle(w);
    expect(sent()).toContainEqual({ op: "add_row", list: "other_names", row: "Susan Smith", revision: 7 });
  });

  it("⚠ sends a new address in the driver's own shape — every blank \"\", never null", async () => {
    const w = card();
    await w.find("[data-fact-add='addresses']").trigger("click");
    await w.find("[data-fact-adder='addresses'] input").setValue("4 New St");
    await w.find("[data-fact-adder='addresses']").findAll("button").find((b) => b.text() === "Add")!.trigger("click");
    await settle(w);
    const body = sent().find((b) => (b as { op?: string })?.op === "add_row") as { row: Record<string, unknown> };
    expect(body.row).toEqual({ ...emptyAddress(), line1: "4 New St" });
  });

  it("keeps the form open with the API's reason when it refuses", async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { message: "They said they have had no accidents." } });
    const w = card();
    await w.find("[data-fact-add='accidents']").trigger("click");
    await w.find("[data-fact-adder='accidents']").findAll("button").find((b) => b.text() === "Add")!.trigger("click");
    await settle(w);
    expect(w.find("[data-fact-adder-problem]").text()).toContain("no accidents");
  });

  it("offers no add or remove once the draft's door is shut, and none for licences on a v2 link", async () => {
    const shut = card(review(), false);
    expect(shut.find("[data-fact-add]").exists()).toBe(false);
    expect(shut.find("[data-fact-remove]").exists()).toBe(false);
    const legacy = card();
    expect(legacy.find("[data-fact-add='additional_licences']").exists()).toBe(true);
  });
});
