import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { defaultInspectionItems, deriveInspectionOutcome, INSPECTION_ITEMS } from "@silvicom/shared";

/**
 * The inspection form's verdict (plan step A7's Done-when).
 *
 * ── WHAT THIS FILE IS FOR, AND IT IS ONLY ONE THING ────────────────────────────────────────────
 * The banner on this page must be the SERVER'S OWN answer. `deriveInspectionOutcome` is the function
 * the finalize route runs before it writes anything and the one that decides what the renderer
 * stamps; a banner computed any other way is a second answer to a regulatory question, and the first
 * time the two disagreed the inspector would believe the screen.
 *
 * So these tests do not assert "shows PASS" against a hand-written expectation. They compute the
 * expectation with the shared function and assert the page agrees — which fails if the page ever
 * grows its own opinion.
 */

interface Row {
  key: string;
  result: "ok" | "needs_repair" | "na";
  source: "default" | "inspector";
  repairedAt: string | null;
  note: string | null;
}

const items = (over: Record<string, string> = {}): Row[] =>
  defaultInspectionItems("tractor").map((i) => ({
    key: i.key,
    result: (over[i.key] ?? i.result) as Row["result"],
    source: "default",
    repairedAt: null,
    note: null,
  }));

const state = vi.hoisted(() => ({
  data: { value: null as unknown },
  patch: { mutate: vi.fn(), isPending: { value: false } },
  finalize: { mutate: vi.fn(), isPending: { value: false }, error: { value: null } },
}));

vi.mock("vue-router", () => ({ useRoute: () => ({ params: { id: "insp_1" } }) }));
vi.mock("@/features/maintenance/useAnnualInspections", () => ({
  useInspectionQuery: () => ({
    data: state.data,
    isLoading: ref(false),
    isError: ref(false),
    error: ref(null),
    refetch: vi.fn(),
  }),
  usePatchInspection: () => state.patch,
  useFinalizeInspection: () => state.finalize,
}));
vi.mock("@/lib/api", () => ({ fetchObjectUrl: vi.fn(async () => "blob:x") }));

const AnnualInspectionFormPage = (await import("@/pages/AnnualInspectionFormPage.vue")).default;

const inspection = (over: Record<string, unknown> = {}) => ({
  id: "insp_1",
  subject_type: "tractor",
  subject_id: "v-1",
  inspected_on: "2026-06-16",
  status: "draft",
  outcome: null,
  next_due_on: null,
  decal_serial: "610641628",
  inspector_id: "i-1",
  document_id: null,
  vehicle_identification_method: "vin",
  vehicle_identification_value: "3AKJHHDR7RSUX1186",
  inspection_agency_location: null,
  other_conditions: null,
  catalogue_version: "1.0.0",
  ...over,
});

const mountPage = (its: Row[], over: Record<string, unknown> = {}) => {
  state.data.value = { inspection: inspection(over), items: its };
  return mount(AnnualInspectionFormPage, {
    global: { stubs: { PageHeader: true, BaseModal: true, AppDateField: true } },
  });
};

describe("the verdict is the shared function's, not the page's", () => {
  it("agrees with deriveInspectionOutcome on a clean report", () => {
    const its = items();
    const expected = deriveInspectionOutcome(its, "tractor", "2026-06-16");
    expect(expected.ok && expected.outcome).toBe("pass");
    expect(mountPage(its).text()).toContain("PASS");
  });

  it("agrees with it on an unrepaired defect", () => {
    const its = items({ "brake.hose": "needs_repair" });
    const expected = deriveInspectionOutcome(its, "tractor", "2026-06-16");
    expect(expected.ok && expected.outcome).toBe("fail");
    const text = mountPage(its).text();
    expect(text).toContain("FAIL");
    expect(text).toContain("1 defect");
  });

  it("agrees with it once that defect carries a repair date", () => {
    const its = items().map((i) =>
      i.key === "brake.hose" ? { ...i, result: "needs_repair" as const, repairedAt: "2026-06-17" } : i,
    );
    const expected = deriveInspectionOutcome(its, "tractor", "2026-06-16");
    expect(expected.ok && expected.outcome).toBe("pass");
    expect(mountPage(its).text()).toContain("PASS");
  });

  it("says it is not ready when a component has no result, rather than guessing (D-AVI5)", () => {
    const its = items().slice(0, 40);
    expect(deriveInspectionOutcome(its, "tractor", "2026-06-16").ok).toBe(false);
    expect(mountPage(its).text()).toContain("Not ready to certify");
  });

  it("offers no control that SETS the verdict — there is no such field anywhere", () => {
    const w = mountPage(items());
    // Every button on the page is a component answer, the preview, or certify. None of them is
    // "mark this report as passed", and the day one appears this fails.
    const labels = w.findAll("button").map((b) => b.text());
    for (const label of labels) {
      expect(["OK", "Repair", "N/A", "Preview the printed page", "Certify this inspection"]).toContain(label);
    }
  });
});

describe("a certified report is read-only (D-AVI4)", () => {
  const final = { status: "final", outcome: "pass", next_due_on: "2027-06-16", document_id: "doc-1" };

  it("shows the filed verdict and says a correction is a new inspection", () => {
    const text = mountPage(items(), final).text();
    expect(text).toContain("Certified PASS");
    expect(text).toContain("cannot be edited");
  });

  it("disables every component control", () => {
    const w = mountPage(items(), final);
    const answers = w.findAll("button").filter((b) => ["OK", "Repair", "N/A"].includes(b.text()));
    expect(answers.length).toBe(INSPECTION_ITEMS.length * 3);
    expect(answers.every((b) => b.attributes("disabled") !== undefined)).toBe(true);
  });

  it("offers the filed report rather than a certify button", () => {
    const labels = mountPage(items(), final).findAll("button").map((b) => b.text());
    expect(labels).toContain("Print the filed report");
    expect(labels).not.toContain("Certify this inspection");
  });
});

describe("what the inspector is told about the pre-fill (D-AVI13)", () => {
  it("counts the components still carrying the answer the form opened with", () => {
    const text = mountPage(items()).text();
    expect(text).toMatch(/\d+ component\(s\) still on their default/);
  });

  it("stops counting them as they are answered", () => {
    const touched: Row[] = items().map((i, n) => (n < 10 ? { ...i, source: "inspector" } : i));
    const before = mountPage(items()).text().match(/(\d+) component\(s\) still on their default/)?.[1];
    const after = mountPage(touched).text().match(/(\d+) component\(s\) still on their default/)?.[1];
    expect(Number(after)).toBe(Number(before) - 10);
  });
});
