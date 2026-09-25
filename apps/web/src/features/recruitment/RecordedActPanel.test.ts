import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { canReadRestrictedKind, type HiringRecordedActStep } from "@silvicom/shared";
import RecordedActPanel from "@/features/recruitment/RecordedActPanel.vue";

/**
 * Recording the MVR, the Clearinghouse query and the drug test from the hire — D1, D-HM6.
 *
 * ── THE THREE PROMISES ────────────────────────────────────────────────────────────────────────
 * The act is filed through the RECRUITMENT door (the compliance one gates on `roster` manage, which
 * a recruiter does not hold); a role §382.401(a) keeps the testing file from is told who does hold
 * it rather than shown a form that 403s; and a step that is already green is not asked for again
 * (D-HUI5).
 *
 * ⚠ The session mock derives its answer from `canReadRestrictedKind` rather than hard-coding one per
 * role. A hand-written `canReadKind: () => false` would keep this suite green through a change to
 * the §382.401(a) list, which is the one rule these assertions are about.
 */

const RECORDS = [
  {
    id: "r-mvr",
    driver_id: "d1",
    kind: "mvr",
    occurred_on: "2026-09-10",
    covers_until: null,
    result: "clean",
    performed_by: "SambaSafety",
    reference: "MVR-771",
    document_id: "doc-1",
    detail: { source: "recorded_act", jurisdiction: "Indiana BMV" },
    created_at: "2026-09-10T00:00:00Z",
  },
  // A different kind on the same driver — the panel shows its own act and nothing else.
  {
    id: "r-drug",
    driver_id: "d1",
    kind: "drug_test",
    occurred_on: "2026-09-11",
    covers_until: null,
    result: "negative",
    performed_by: "Medstop",
    reference: "LAB-42",
    document_id: null,
    detail: {},
    created_at: "2026-09-11T00:00:00Z",
  },
];

/**
 * ⚠ **`clearinghouse_full`, and the row is here because a mutation survived without it.** The step
 * key and the record kind are the same word for two of D1's three acts, so a panel that filed the
 * STEP as the kind passed every assertion in this file: only the Clearinghouse tells them apart.
 * With the step key as the kind, this row never appears and `canReadRestrictedKind("clearinghouse")`
 * — which is not a `TESTING_RECORD_KINDS` member — answers YES to a recruiter §382.401(a) refuses.
 */
const CLEARINGHOUSE = {
  id: "r-clear",
  driver_id: "d1",
  kind: "clearinghouse_full",
  occurred_on: "2026-09-09",
  covers_until: null,
  result: "no violations",
  performed_by: "FMCSA portal",
  reference: "CH-9001",
  document_id: null,
  detail: {},
  created_at: "2026-09-09T00:00:00Z",
};

const DOCUMENTS = [{ id: "doc-1", kind: "mvr", url: "https://storage.example/signed/doc-1.pdf" }];

const calls = vi.hoisted(() => ({ list: [] as Array<{ url: string; body?: unknown }> }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    if (opts?.method === "POST") {
      calls.list.push({ url, body: opts.body });
      return url.endsWith("/document")
        ? { ok: true, data: { documentId: "doc-9", uploadUrl: "u", token: "t", storagePath: "p" } }
        : { ok: true, data: { recordId: "rec-9", documentId: null, kind: "mvr" } };
    }
    return url.startsWith("/api/compliance/documents")
      ? { ok: true, data: { documents: DOCUMENTS } }
      : { ok: true, data: { records: [...RECORDS, CLEARINGHOUSE] } };
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: { from: () => ({ uploadToSignedUrl: async () => ({ error: null }) }) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
  DEV_BYPASS: false,
}));

const role = vi.hoisted(() => ({ value: "recruiter" as string }));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({
    get role() {
      return role.value;
    },
    canReadKind: (kind: string) => canReadRestrictedKind(kind, role.value as never),
  }),
}));

const mountPanel = (step: HiringRecordedActStep, done = false, outstandingJurisdictions: string[] = []) =>
  mount(RecordedActPanel, {
    props: { driverId: "00000000-0000-4000-8000-0000000000d1", step, done, outstandingJurisdictions },
    global: { plugins: [VueQueryPlugin] },
  });

const settle = async (w: ReturnType<typeof mountPanel>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

const button = (w: ReturnType<typeof mountPanel>, text: string) =>
  w.findAll("button").find((b) => b.text().includes(text));

/**
 * ⚠ The date field is a vue-datepicker whose visible input is formatted `mm/dd/yyyy`, so
 * `setValue("2026-09-12")` sets a string the component never parses and the model stays empty —
 * which looks exactly like a submit that was refused. Emit the model update, as
 * `RequirementDrawer.test.ts` does.
 */
const setDate = (w: ReturnType<typeof mountPanel>, iso: string) =>
  w.findComponent({ name: "AppDateField" }).vm.$emit("update:modelValue", iso);

describe("what is already on file", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    role.value = "admin";
    calls.list = [];
  });

  it("shows this act's records and nothing else in the file", async () => {
    const w = mountPanel("mvr");
    await settle(w);
    expect(w.text()).toContain("MVR-771");
    // The drug test is in the same response and belongs to a different step's panel.
    expect(w.text()).not.toContain("LAB-42");
  });

  it("offers the scan, and says so when a filed one will not sign", async () => {
    const w = mountPanel("mvr");
    await settle(w);
    const link = w.findAll("a").find((a) => a.text().includes("Open the scan"));
    expect(link?.attributes("href")).toBe("https://storage.example/signed/doc-1.pdf");
    // `drug_test`'s row cites no document at all, which is a different sentence from a dead link.
    const other = mountPanel("drug_test");
    await settle(other);
    expect(other.text()).toContain("No scan");
  });

  it("says nothing is on file rather than showing an empty list", async () => {
    // ⚠ A kind with no rows at all, so the empty state is about absence and not about the filter.
    const w = mountPanel("drug_test");
    await settle(w);
    expect(w.text()).toContain("LAB-42");
    const other = mountPanel("mvr");
    await settle(other);
    expect(other.text()).not.toContain("Nothing yet");
  });

  /**
   * ⚠ **The Clearinghouse is the only one of the three whose step key and record kind differ**
   * (`clearinghouse` → `clearinghouse_full`), which makes it the only fixture that can tell a
   * derived kind from the step key. A mutation that returned the step key survived this whole file
   * until this test existed.
   */
  it("names the state each filed MVR came from (AF7)", async () => {
    const w = mountPanel("mvr");
    await settle(w);
    expect(w.text()).toContain("Indiana BMV");
  });

  it("reads the Clearinghouse history under the kind the catalogue names, not the step key", async () => {
    const w = mountPanel("clearinghouse");
    await settle(w);
    expect(w.text()).toContain("CH-9001");
  });
});

describe("recording one", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    role.value = "admin";
    calls.list = [];
  });

  it("refuses to submit without a date, which is the one fact a record cannot lack", async () => {
    const w = mountPanel("mvr");
    await settle(w);
    expect(button(w, "Record it")?.attributes("disabled")).toBeDefined();
  });

  /**
   * ⚠ **The whole reason this component exists.** It must post to the recruitment door with the STEP
   * in the path — `/api/compliance/qualification-records` refuses a recruiter, and the kind is
   * composed server-side from this segment. A test asserting only that "something was posted" would
   * go green against the door that cannot serve the role the board was built for.
   */
  /**
   * ⚠ AF7: an MVR with no state covers no declared licence, so saving one would file a row and leave
   * the step as open as it was. The hint names what is still needed as written, because the fold
   * compares after trim and case only.
   */
  it("asks an MVR which state it came from, and will not save one without it", async () => {
    const w = mountPanel("mvr", false, ["IL", "Indiana BMV"]);
    await settle(w);
    expect(w.text()).toContain("Still needed: IL, Indiana BMV.");
    setDate(w, "2026-09-12");
    await settle(w);
    expect(button(w, "Record it")?.attributes("disabled")).toBeDefined();

    await w.find('input[maxlength="60"]').setValue("  IL ");
    await button(w, "Record it")!.trigger("click");
    await settle(w);
    expect(calls.list.at(-1)!.body).toMatchObject({ occurred_on: "2026-09-12", jurisdiction: "IL" });
  });

  it("asks no state for the other two acts, and sends none", async () => {
    const w = mountPanel("clearinghouse");
    await settle(w);
    expect(w.find('input[maxlength="60"]').exists()).toBe(false);
    setDate(w, "2026-09-12");
    await settle(w);
    await button(w, "Record it")!.trigger("click");
    await settle(w);
    expect(calls.list.at(-1)!.body).toMatchObject({ jurisdiction: null });
  });

  it("files through the recruitment door, naming the step in the path", async () => {
    const w = mountPanel("clearinghouse");
    await settle(w);
    setDate(w, "2026-09-12");
    await settle(w);
    await button(w, "Record it")!.trigger("click");
    await settle(w);
    expect(calls.list).toHaveLength(1);
    expect(calls.list[0]!.url).toBe(
      "/api/recruitment/applicants/00000000-0000-4000-8000-0000000000d1/records/clearinghouse",
    );
    expect(calls.list[0]!.body).toMatchObject({ occurred_on: "2026-09-12", document_id: null });
  });

  /**
   * ⚠ No scan means no registration call. An act is recordable before its printout is to hand, and a
   * register-then-file pair sent for every filing would leave a document row citing bytes that never
   * arrived — a citation to nothing.
   */
  /**
   * ⚠ **The row is two things at once, and forgetting the second is a defect with no error message.**
   * It is evidence in the §391.51 file (`["compliance"]`) AND the thing that moves a step of the
   * hire, which is folded SERVER-side — so a mutation that refreshed only the first would leave the
   * checklist row reading *"Waiting on you"* over a record the office just filed, until something
   * else happened to refetch it.
   */
  it("refreshes the checklist the fold serves, not only the qualification file", async () => {
    const qc = new QueryClient();
    const invalidated: unknown[] = [];
    vi.spyOn(qc, "invalidateQueries").mockImplementation(async (filters?: unknown) => {
      invalidated.push((filters as { queryKey?: unknown })?.queryKey);
    });
    const w = mount(RecordedActPanel, {
      props: { driverId: "00000000-0000-4000-8000-0000000000d1", step: "mvr", done: false },
      global: { plugins: [[VueQueryPlugin, { queryClient: qc }]] },
    });
    await settle(w as ReturnType<typeof mountPanel>);
    setDate(w as ReturnType<typeof mountPanel>, "2026-09-12");
    await w.find('input[maxlength="60"]').setValue("IL");
    await settle(w as ReturnType<typeof mountPanel>);
    await button(w as ReturnType<typeof mountPanel>, "Record it")!.trigger("click");
    await settle(w as ReturnType<typeof mountPanel>);
    expect(invalidated).toContainEqual(["compliance"]);
    expect(invalidated).toContainEqual([
      "recruitment", "checklist", "00000000-0000-4000-8000-0000000000d1",
    ]);
  });

  it("registers no document when there is no scan", async () => {
    const w = mountPanel("mvr");
    await settle(w);
    setDate(w, "2026-09-12");
    await w.find('input[maxlength="60"]').setValue("IL");
    await settle(w);
    await button(w, "Record it")!.trigger("click");
    await settle(w);
    expect(calls.list.map((c) => c.url.endsWith("/document"))).toEqual([false]);
  });
});

describe("who may record it", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    calls.list = [];
  });

  /**
   * ⚠ §382.401(a). The recruiter is refused the testing kinds by the API, by 0211's policies and by
   * the list read here — so the panel names who holds the file instead of rendering a form. It must
   * NOT read as a permission apology: what the recruiter needs is who to ask.
   */
  it("shows a recruiter who holds the drug-test file, and no form", async () => {
    role.value = "recruiter";
    const w = mountPanel("drug_test");
    await settle(w);
    expect(w.text()).toContain("A safety manager or an admin records this one");
    expect(button(w, "Record it")).toBeUndefined();
    // And not the result either: the list of filed records is theirs to read, not this role's.
    expect(w.text()).not.toContain("LAB-42");
  });

  it("gives the same recruiter the driving record, which is their own step", async () => {
    role.value = "recruiter";
    const w = mountPanel("mvr");
    await settle(w);
    expect(button(w, "Record it")).toBeDefined();
    expect(w.text()).toContain("MVR-771");
  });

  /**
   * ⚠ Same mutation, the other half: with the step key as the kind, `canReadRestrictedKind` is asked
   * about `"clearinghouse"` — not a `TESTING_RECORD_KINDS` member — and hands a recruiter a form the
   * API answers with a 403.
   */
  it("refuses a recruiter the Clearinghouse query, whose kind is not its step key", async () => {
    role.value = "recruiter";
    const w = mountPanel("clearinghouse");
    await settle(w);
    expect(button(w, "Record it")).toBeUndefined();
    expect(w.text()).toContain("A safety manager or an admin records this one");
  });

  it("gives the safety manager the drug test", async () => {
    role.value = "safety_manager";
    const w = mountPanel("drug_test");
    await settle(w);
    expect(button(w, "Record it")).toBeDefined();
  });
});

describe("a step that is already done", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    role.value = "admin";
    calls.list = [];
  });

  /** D-HUI5: the checklist never asks for something already done. */
  it("does not ask for it again", async () => {
    const w = mountPanel("mvr", true);
    await settle(w);
    expect(button(w, "Record it")).toBeUndefined();
    expect(w.text()).toContain("MVR-771");
  });

  /** ...and a correction is still possible, because the table is append-only. One deliberate click. */
  it("opens the form on Record another", async () => {
    const w = mountPanel("mvr", true);
    await settle(w);
    await button(w, "Record another")!.trigger("click");
    await settle(w);
    expect(button(w, "Record it")).toBeDefined();
  });
});
