import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { useToastStore } from "@/stores/toast";
import { APPLICANT_FACTS, LICENCE_KINDS, questionnaireForApplicant } from "@silvicom/shared";
import { emptyAddress } from "./draftShape";
import { blankRow, editableLists, factBlocks, rowChange, rowColumns, rowRemovable } from "./factRowLists";
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

  it("opens each list with its own door: a v2 link's licences with Part 1's, every other list with the draft's", () => {
    expect(editableLists(true, { draft: false, partOne: true })).toEqual(["additional_licences"]);
    expect(editableLists(true, { draft: true, partOne: false })).not.toContain("additional_licences");
    expect(editableLists(false, { draft: true, partOne: false })).toContain("additional_licences");
    expect(editableLists(false, { draft: false, partOne: true })).toEqual([]);
  });

  /** P3 (F2c part 2): Part 1 asks every other licence's type now, so the card's adder asks it in the same four words. */
  it("asks an other licence's type, from the same four answers the driver's screen offers", () => {
    const kind = rowColumns("additional_licences", 0).find((c) => c.column === "kind");
    expect(kind?.input).toBe("choice");
    expect(kind?.choices?.map((c) => c.value)).toEqual([...LICENCE_KINDS]);
    expect(kind?.choices?.find((c) => c.value === "clp")?.label).toBe("Commercial learner's permit (CLP)");
  });

  it("keeps each row's answers together as one block", () => {
    const rows = applicantFactRows({
      payload: { addresses: [HOME, OLD] }, partOne: null, edits: [], questionnaire: questionnaireForApplicant(),
    });
    const items = factBlocks(rows).filter((b) => b.kind === "item" && b.list === "addresses");
    expect(items.map((b) => (b.kind === "item" ? [b.index, b.rows.length] : null))).toEqual([[0, 7], [1, 7]]);
  });
});

const PART_ONE = {
  intake: { phone: "+13125550142", address_line1: "1 Main St", address_line2: null, city: "Joliet", state: "IL", postal_code: "60431", prior_positive_2y: false, cdl_class: "A" },
  licences: [
    { position: 0, state_code: "IL", agency: null, licence_number: "IL123", expires_on: "2029-03-01" },
    { position: 1, state_code: "IN", agency: null, licence_number: "IN-9", expires_on: "2027-01-01" },
  ],
  asOf: "2026-11-10",
} as const;

describe("the request a row change takes", () => {
  const ctx = { revision: 7, partOne: PART_ONE as never, addresses: [HOME] };
  it("sends a v2 licence through Part 1's whole set, the current CDL kept first", () => {
    const added = rowChange("additional_licences", { add: { issuing_authority: "WI", number: "W-1", expires_at: "2028-01-01", kind: "" } }, ctx);
    expect(added).toMatchObject({ door: "part_one" });
    if (!("body" in added)) throw new Error("no body");
    expect(added.body.licences.map((l) => l.licence_number)).toEqual(["IL123", "IN-9", "W-1"]);
    const removed = rowChange("additional_licences", { remove: 0 }, ctx);
    if (!("body" in removed)) throw new Error("no body");
    expect(removed.body.licences.map((l) => l.licence_number)).toEqual(["IL123"]);
  });

  it("refuses a v2 licence without its expiry before anything is sent", () => {
    expect(rowChange("additional_licences", { add: { issuing_authority: "WI", number: "W-1", expires_at: "" } }, ctx)).toHaveProperty("problem");
  });

  it("sends every other list, and a legacy link's licences, through the draft", () => {
    expect(rowChange("addresses", { remove: 1 }, ctx)).toEqual({ door: "draft", edit: { op: "remove_row", list: "addresses", index: 1, revision: 7 } });
    expect(rowChange("additional_licences", { remove: 0 }, { ...ctx, partOne: null })).toMatchObject({ door: "draft" });
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
const card = (r = review(), draftOpen = true, recordOpen = true) =>
  mount(ApplicantFactsCard, {
    props: { invitationId: "inv-1", review: r as never, draftOpen, recordOpen },
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
    const shut = card(review(), false, false);
    expect(shut.find("[data-fact-add]").exists()).toBe(false);
    expect(shut.find("[data-fact-remove]").exists()).toBe(false);
    const legacy = card();
    expect(legacy.find("[data-fact-add='additional_licences']").exists()).toBe(true);
  });

  it("removes a v2 licence through Part 1's correction, open while the office screens", async () => {
    const w = card(review({ partOne: PART_ONE }), false);
    expect(w.find("[data-fact-add='addresses']").exists()).toBe(false); // the draft's door is shut
    await w.find("[data-fact-remove='additional_licences.0'] button").trigger("click");
    await w.find("[data-fact-remove='additional_licences.0']").findAll("button").find((b) => b.text() === "Remove")!.trigger("click");
    await settle(w);
    const call = apiFetch.mock.calls.find((c) => String(c[0]).endsWith("/part-one"));
    expect((call?.[1] as { body: { licences: Array<{ licence_number: string }> } }).body.licences.map((l) => l.licence_number)).toEqual(["IL123"]);
  });
});

describe("a corrected email on the card (E3)", () => {
  it("says before Save where emails go, and after Save that they moved", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { ok: true, revision: 8, payload: {}, contact: { emailMoved: true } } });
    const w = card(review({ payload: { ...review().payload, email: "old@example.test" }, contact: { email: "old@example.test", phoneTexted: false } }));
    await w.find("[data-fact='email']").findAll("button").find((b) => b.text() === "Edit")!.trigger("click");
    await settle(w);
    expect(w.find("[data-fact-contact]").text()).toContain("go to old@example.test");
    await w.find("[data-fact='email'] input").setValue("new@example.test");
    await w.find("[data-fact='email']").findAll("button").find((b) => b.text() === "Save")!.trigger("click");
    await settle(w);
    const said = useToastStore().toasts.map((t) => JSON.stringify(t)).join(" ");
    expect(said).toContain("emails now go to the new address");
  });
});
