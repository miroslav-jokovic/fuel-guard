import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { ROAD_TEST_ITEMS, sectionAccess } from "@silvicom/shared";
import RoadTestPanel from "@/features/recruitment/RoadTestPanel.vue";
import { apiFetch } from "@/lib/api";
import { ymd } from "@/lib/dateWindow";

/**
 * The road test's screen (D2 RT3; HIRING-WORKFLOW-AUDIT-2026-10-31 §9 P1, RT-A1…A10). ⚠ Asserts the
 * BODY the API receives — the server re-decides everything, so a panel that posted the wrong shape
 * would be refused, and only the body says so.
 */
const EXAMINER = "44444444-5555-4666-8777-888888888888";
const TRUCK = "55555555-6666-4777-8888-999999999999";
const SHOP_TRUCK = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const SOLD_TRUCK = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const ARVIDERA = { id: EXAMINER, full_name: "Arvidera Gakhal", title: "Maintenance manager", created_at: "" };
const state = vi.hoisted(() => ({
  examiners: [] as unknown[],
  posts: [] as Array<{ url: string; body: unknown }>,
  records: [] as unknown[],
  documents: [] as unknown[],
  copies: [] as unknown[],
  /** What POST …/road-test answers. */
  recordAnswer: null as null | { ok: boolean; data?: unknown; error?: { message: string } },
  /** The examiner list never answers — the panel as it is while the read is in flight. */
  examinersPending: false,
  examinerReads: 0,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    if (opts?.method === "POST") {
      state.posts.push({ url, body: opts.body });
      if (url.endsWith("/paper-copy")) {
        // As the API would: the next read of the copies reports the handover.
        state.copies = [{ recordId: "r1", given: true, downloadedAt: null, handedOverAt: "2026-09-29T15:30:00Z" }];
        return { ok: true, data: { copy: state.copies[0] } };
      }
      if (url.endsWith("/road-test")) {
        return state.recordAnswer ?? { ok: true, data: { passed: true, formDocumentId: "f", certificateDocumentId: "c", recordId: "r" } };
      }
      return { ok: true, data: { examiner: ARVIDERA } };
    }
    if (url.includes("road-test-examiners")) {
      state.examinerReads++;
      if (state.examinersPending) return new Promise(() => {});
      return { ok: true, data: { examiners: state.examiners } };
    }
    if (url.endsWith("/road-test/copies")) return { ok: true, data: { copies: state.copies } };
    if (url.includes("/api/compliance/documents")) return { ok: true, data: { documents: state.documents } };
    return { ok: true, data: { records: state.records } };
  }),
}));
// The session, put in one role's shoes from the shared matrix (`AuthorizationsPanel.test.ts`'s idiom).
const session = vi.hoisted(() => ({ role: "admin" as string, can: (_s: string): boolean => true }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));
const actAs = (role: string) => {
  session.role = role;
  session.can = (s: string) => sectionAccess(role as never, s as never) === "manage";
};
const vehicles = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: { value: vehicles.rows }, isLoading: { value: false }, isError: { value: false } }),
}));

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
/** A RouterLink that shows where it points, so a link's destination can be asserted without a router. */
const RouterLinkStub = { props: ["to"], template: '<a :data-to="to"><slot /></a>' };
type PanelProps = {
  done?: boolean;
  invitationId?: string | null;
  identity?: { cdl_number?: string | null } | null;
  advisedFirst?: string | null;
};
const mountPanel = (props: PanelProps = {}) =>
  mount(RoadTestPanel, {
    props: { driverId: "d1", done: false, identity: { cdl_number: "P123-4567" }, ...props },
    global: { plugins: [VueQueryPlugin], stubs: { RouterLink: RouterLinkStub } },
  });

beforeEach(() => {
  setActivePinia(createPinia());
  actAs("admin");
  state.examinersPending = false;
  state.examinerReads = 0;
  state.posts = [];
  state.records = [];
  state.documents = [];
  state.copies = [];
  state.recordAnswer = null;
  state.examiners = [ARVIDERA];
  vehicles.rows = [{ id: TRUCK, unit_number: "1432", year: 2024, make: "FRHT", status: "active" }];
});

const fill = async (w: ReturnType<typeof mount>, rating = "satisfactory", miles = "15") => {
  const combos = w.findAllComponents({ name: "AppCombobox" });
  combos[0]!.vm.$emit("update:modelValue", EXAMINER);
  combos[1]!.vm.$emit("update:modelValue", TRUCK);
  combos[2]!.vm.$emit("update:modelValue", "reefer");
  w.findComponent({ name: "AppDateField" }).vm.$emit("update:modelValue", "2026-09-20");
  await w.find('input[type="number"]').setValue(miles);
  const segments = w.findAllComponents({ name: "AppSegmentedControl" });
  segments.slice(0, ROAD_TEST_ITEMS.length).forEach((s, i) =>
    s.vm.$emit("update:modelValue", i === 2 ? rating : "satisfactory"));
  segments[ROAD_TEST_ITEMS.length]!.vm.$emit("update:modelValue", "satisfactory");
  await settle(w);
};
const button = (w: ReturnType<typeof mount>) => w.findAll("button").find((b) => b.text().includes("Record the road test"))!;
const byText = (w: ReturnType<typeof mount>, text: string) => w.findAll("button").find((b) => b.text().trim() === text);

describe("with no examiner on file (Q-RT2)", () => {
  it("asks for the examiner and their signature before anything else", async () => {
    state.examiners = [];
    const w = mountPanel();
    await settle(w);
    expect(w.text()).toContain("Add an examiner");
    expect(w.text()).not.toContain("The road test given includes");
  });

  it("puts the examiner just added in the Examiner field", async () => {
    state.examiners = [];
    const w = mountPanel();
    await settle(w);
    const inputs = w.findAll("input:not([type=file])");
    await inputs[0]!.setValue("Arvidera Gakhal");
    await inputs[1]!.setValue("Maintenance manager");
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    w.findComponent({ name: "SignaturePad" }).vm.$emit("change", png);
    await settle(w);
    // The api now lists them, as it would after the add.
    state.examiners = [ARVIDERA];
    await byText(w, "Add examiner")!.trigger("click");
    await settle(w);
    expect(state.posts.map((p) => p.url)).toEqual(["/api/recruitment/road-test-examiners"]);
    expect(w.findAllComponents({ name: "AppCombobox" })[0]!.props("modelValue")).toBe(EXAMINER);
  });
});

/**
 * Q-AW19 (owner, 2026-09-29): only the admin adds an examiner. A recruiter holds `recruitment: manage`
 * and a fleet manager `settings: manage` too, and neither is offered the form — they are told who adds one.
 * D-5 / RT-A3 (§9 P1): a further examiner is a Settings act, so the panel links there instead of a form.
 */
describe("who may add an examiner", () => {
  for (const role of ["recruiter", "fleet_manager"]) {
    it(`tells a ${role} to ask an administrator, in Settings → Recruiting, and offers no form`, async () => {
      actAs(role);
      state.examiners = [];
      const w = mountPanel();
      await settle(w);
      expect(w.text()).toContain("Ask an administrator to add one in Settings → Recruiting");
      expect(w.findComponent({ name: "SignatoryAddForm" }).exists()).toBe(false);
    });

    it(`offers a ${role} no link to the register beside the examiners on file, only who to ask`, async () => {
      actAs(role);
      const w = mountPanel();
      await settle(w);
      expect(w.text()).toContain("The road test given includes");
      expect(w.find('[data-to="/settings/recruiting"]').exists()).toBe(false);
      expect(w.text()).toContain("Ask an administrator to add them in Settings → Recruiting");
    });
  }

  it("offers a recruiter no form while the examiner list is still loading", async () => {
    actAs("recruiter");
    state.examinersPending = true;
    const w = mountPanel();
    await settle(w);
    expect(w.findComponent({ name: "SignatoryAddForm" }).exists()).toBe(false);
  });

  it("D-5: links the admin to Settings → Recruiting for another examiner, with no form inside the test", async () => {
    const w = mountPanel();
    await settle(w);
    expect(w.get('[data-to="/settings/recruiting"]').text()).toContain("Settings → Recruiting");
    expect(w.findComponent({ name: "SignatoryAddForm" }).exists()).toBe(false);
  });
});

describe("recording a test", () => {
  it("lets a recruiter record the test itself — only adding an examiner is the admin's", async () => {
    actAs("recruiter");
    const w = mountPanel();
    await settle(w);
    await fill(w);
    await button(w).trigger("click");
    await settle(w);
    expect(state.posts.at(-1)!.url).toBe("/api/recruitment/applicants/d1/road-test");
  });

  it("rates all nine items and posts exactly what the API takes", async () => {
    const w = mountPanel();
    await settle(w);
    expect(w.findAllComponents({ name: "AppSegmentedControl" })).toHaveLength(ROAD_TEST_ITEMS.length + 1);
    expect(button(w).attributes("disabled")).toBeDefined();
    await fill(w);
    expect(w.text()).toContain("files the road-test form and the certificate");
    await button(w).trigger("click");
    await settle(w);
    const post = state.posts.at(-1)!;
    expect(post.url).toBe("/api/recruitment/applicants/d1/road-test");
    expect(post.body).toMatchObject({
      examiner_id: EXAMINER, vehicle_id: TRUCK, trailer_type: "reefer", tested_on: "2026-09-20", miles: 15,
      general_performance: "satisfactory",
    });
    expect(Object.keys((post.body as { items: object }).items)).toHaveLength(ROAD_TEST_ITEMS.length);
  });

  it("says before the press that a Needs training item issues no certificate", async () => {
    const w = mountPanel();
    await settle(w);
    await fill(w, "needs_training");
    expect(w.text()).toContain("Not a pass");
  });
});

describe("§9 P1 — the road test defects (RT-A1…A10)", () => {
  it("RT-A1: a pass with no licence number on file says so before the press, and opens the correction in place", async () => {
    const w = mountPanel({ invitationId: "inv1", identity: { cdl_number: null } });
    await settle(w);
    await fill(w);
    expect(w.get('[data-testid="licence-missing"]').text()).toContain("Add the licence number first");
    expect(button(w).attributes("disabled")).toBeDefined();
    expect(w.get('[data-testid="still-needed"]').text()).toContain("the licence number");
    await byText(w, "Add the licence number")!.trigger("click");
    await settle(w);
    expect(w.findComponent({ name: "ApplicantIdentityCorrection" }).exists()).toBe(true);
  });

  it("RT-A1: a fail needs no licence number — it files the form only", async () => {
    const w = mountPanel({ invitationId: "inv1", identity: { cdl_number: null } });
    await settle(w);
    await fill(w, "unsatisfactory");
    expect(w.find('[data-testid="licence-missing"]').exists()).toBe(false);
    expect(button(w).attributes("disabled")).toBeUndefined();
  });

  it("RT-A2: after a recorded fail the form starts empty — the next attempt inherits nothing", async () => {
    state.recordAnswer = { ok: true, data: { passed: false, formDocumentId: "f", certificateDocumentId: null, recordId: null } };
    const w = mountPanel();
    await settle(w);
    await fill(w, "unsatisfactory");
    await button(w).trigger("click");
    await settle(w);
    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe("");
    const segments = w.findAllComponents({ name: "AppSegmentedControl" });
    expect(segments.every((s) => s.props("modelValue") === "")).toBe(true);
  });

  it("RT-A2: offers no second recording once a pass is on file", async () => {
    state.records = [{ id: "r1", kind: "road_test", occurred_on: "2026-09-25", performed_by: "Arvidera Gakhal", detail: { source: "road_test" } }];
    const w = mountPanel({ done: true });
    await settle(w);
    expect(byText(w, "Record a road test")).toBeUndefined();
    expect(w.text()).not.toContain("The road test given includes");
  });

  it("RT-A2/RT-A7: a step done by the licence equivalency says so, and still offers a road test", async () => {
    state.records = [{ id: "e1", kind: "cdl_equivalency", occurred_on: "2026-09-25", performed_by: null, detail: {} }];
    const w = mountPanel({ done: true });
    await settle(w);
    expect(w.get('[data-testid="equivalency"]').text()).toContain("licence equivalency (§391.33)");
    expect(w.text()).not.toContain("No road test passed yet");
    expect(byText(w, "Record a road test")).toBeDefined();
  });

  it("RT-A3: an examiner the server no longer has is cleared, the list asked for again, and the error shown", async () => {
    state.recordAnswer = { ok: false, error: { message: "That examiner is no longer on file. Choose another examiner." } };
    const w = mountPanel();
    await settle(w);
    await fill(w);
    const before = state.examinerReads;
    await button(w).trigger("click");
    await settle(w);
    expect(state.examinerReads).toBeGreaterThan(before);
    expect(w.findAllComponents({ name: "AppCombobox" })[0]!.props("modelValue")).toBe("");
  });

  it("RT-A4: miles the contract refuses are the field's own error, and the press waits", async () => {
    const w = mountPanel();
    await settle(w);
    await fill(w, "satisfactory", "12.5");
    expect(w.text()).toContain("whole number");
    expect(button(w).attributes("disabled")).toBeDefined();
    await w.find('input[type="number"]').setValue("1500");
    await settle(w);
    expect(w.text()).toContain("1,000 miles or fewer");
    expect(button(w).attributes("disabled")).toBeDefined();
  });

  it("RT-A4: the date cannot be after today, and a future date is the field's error", async () => {
    const w = mountPanel();
    await settle(w);
    expect(w.findComponent({ name: "AppDateField" }).props("maxDate")).toBe(ymd(new Date()));
    await fill(w);
    w.findComponent({ name: "AppDateField" }).vm.$emit("update:modelValue", "2999-01-01");
    await settle(w);
    expect(w.text()).toContain("That date is in the future.");
    expect(button(w).attributes("disabled")).toBeDefined();
  });

  it("RT-A5: a failed attempt's form is listed under Attempts; a pass's own form is not", async () => {
    state.records = [{ id: "r1", kind: "road_test", occurred_on: "2026-09-25", performed_by: "A", document_id: "cert1", detail: { source: "road_test", form_document_id: "form-pass" } }];
    const doc = (id: string, createdAt: string) => ({ id, kind: "road_test", variant: "original", createdAt, url: `https://signed/${id}` });
    state.documents = [doc("form-fail", "2026-09-20T15:00:00Z"), doc("form-pass", "2026-09-25T15:00:00Z"), doc("cert1", "2026-09-25T15:00:01Z")];
    const w = mountPanel({ done: true });
    await settle(w);
    const attempts = w.get('[data-testid="attempts"]');
    expect(attempts.findAll("li")).toHaveLength(1);
    expect(attempts.text()).toContain("09/20/2026");
    expect(attempts.get("a").attributes("href")).toBe("https://signed/form-fail");
  });

  it("RT-A6: a truck in the shop can be chosen, and a sold one cannot", async () => {
    vehicles.rows = [
      { id: TRUCK, unit_number: "1432", year: 2024, make: "FRHT", status: "active" },
      { id: SHOP_TRUCK, unit_number: "1500", year: 2022, make: "VOLV", status: "maintenance" },
      { id: SOLD_TRUCK, unit_number: "900", year: 2015, make: "INTL", status: "retired" },
    ];
    const w = mountPanel();
    await settle(w);
    const options = w.findAllComponents({ name: "AppCombobox" })[1]!.props("options") as Array<{ value: string; label: string }>;
    expect(options.map((o) => o.value)).toEqual([TRUCK, SHOP_TRUCK]);
    expect(options[1]!.label).toContain("in the shop");
  });

  it("RT-A6: an empty roster says so where the truck is chosen", async () => {
    vehicles.rows = [];
    const w = mountPanel();
    await settle(w);
    expect(w.text()).toContain("No trucks on the roster yet");
  });

  it("RT-A7: each row says what the checklist counted it as", async () => {
    state.records = [
      { id: "r1", kind: "road_test", occurred_on: "2026-09-25", performed_by: "A", detail: { source: "road_test" } },
      { id: "r2", kind: "road_test", occurred_on: "2026-09-01", performed_by: "B", detail: {} },
    ];
    const w = mountPanel({ done: true });
    await settle(w);
    const rows = w.findAll('[data-testid="road-test-row"]').map((r) => r.text());
    expect(rows[0]).toContain("· Passed ·");
    expect(rows[1]).toContain("not counted as a pass");
  });

  it("RT-A8: Mark all satisfactory rates the nine, and Still needed names what is left", async () => {
    const w = mountPanel();
    await settle(w);
    expect(w.get('[data-testid="still-needed"]').text()).toContain("9 items to rate");
    await byText(w, "Mark all satisfactory")!.trigger("click");
    await settle(w);
    const segments = w.findAllComponents({ name: "AppSegmentedControl" }).slice(0, ROAD_TEST_ITEMS.length);
    expect(segments.every((s) => s.props("modelValue") === "satisfactory")).toBe(true);
    expect(w.get('[data-testid="still-needed"]').text()).not.toContain("to rate");
  });

  it("RT-A8: the nine are grouped Before driving, then On the road", async () => {
    const w = mountPanel();
    await settle(w);
    expect(w.get('[data-testid="group-before_driving"]').text()).toContain("Before driving");
    expect(w.get('[data-testid="group-before_driving"]').findAll("li")).toHaveLength(3);
    expect(w.get('[data-testid="group-on_the_road"]').findAll("li")).toHaveLength(6);
  });

  it("RT-A9: ratings read in sentence case, and General performance is a heading, not a label for a div", async () => {
    const w = mountPanel();
    await settle(w);
    const options = w.findAllComponents({ name: "AppSegmentedControl" })[0]!.props("options") as Array<{ label: string }>;
    expect(options.map((o) => o.label)).toContain("Needs training");
    expect(w.findAll("label").some((l) => l.text().includes("General performance"))).toBe(false);
  });

  it("RT-A10: the drug test still open is advice above the form, never a refusal", async () => {
    const w = mountPanel({ advisedFirst: "Drug test" });
    await settle(w);
    expect(w.get('[data-testid="advised-first"]').text()).toContain("drug test result is not in yet");
    await fill(w);
    expect(button(w).attributes("disabled")).toBeUndefined();
  });
});

/** G-10 (Q-AW19, owner 2026-09-29): whether the driver has had their copy of each certificate. */
describe("the driver's copy of the certificate", () => {
  const passed = (id: string) => ({ id, kind: "road_test", occurred_on: "2026-09-25", performed_by: "Arvidera Gakhal, Maintenance manager", detail: { source: "road_test" } });
  const paperButton = (w: ReturnType<typeof mount>) => byText(w, "Handed a paper copy");

  it("offers the paper-copy press on a certificate nobody has had, and posts it for that certificate", async () => {
    state.records = [passed("r1")];
    state.copies = [{ recordId: "r1", given: false, downloadedAt: null, handedOverAt: null }];
    const w = mountPanel({ done: true });
    await settle(w);
    expect(w.text()).toContain("has not had their copy");
    await paperButton(w)!.trigger("click");
    await settle(w);
    expect(state.posts.map((p) => p.url)).toEqual(["/api/recruitment/applicants/d1/road-test/r1/paper-copy"]);
    // The press refetched the copies, so the row now says how it was given.
    expect(w.get('[data-testid="copy-given"]').text()).toContain("paper copy handed over 09/29/2026");
    expect(paperButton(w)).toBeUndefined();
  });

  it("counts a download from the driver's link as given, and offers no press", async () => {
    state.records = [passed("r1")];
    state.copies = [{ recordId: "r1", given: true, downloadedAt: "2026-09-26T15:00:00Z", handedOverAt: null }];
    const w = mountPanel({ done: true });
    await settle(w);
    expect(w.get('[data-testid="copy-given"]').text()).toContain("downloaded from their link 09/26/2026");
    expect(paperButton(w)).toBeUndefined();
  });

  it("says nothing about a copy for a road test this product did not certify", async () => {
    state.records = [passed("r-roster")];
    state.copies = [];
    const w = mountPanel({ done: true });
    await settle(w);
    expect(w.text()).not.toContain("copy");
    expect(paperButton(w)).toBeUndefined();
  });
});

/**
 * D-US5: a read of the file that fails says so in a sentence and offers a Retry that asks the API again.
 * Before, the failure was a tinted line with no way back but the browser's reload, which resets
 * everything else the recruiter had open. `retry: false` so the first failure is the one shown.
 */
describe("when the read of the file fails (D-US5)", () => {
  it("says what could not be loaded, and Retry asks the API again", async () => {
    const real = vi.mocked(apiFetch).getMockImplementation()!;
    let failing = true;
    const asked = (): number =>
      vi.mocked(apiFetch).mock.calls.filter(([u, o]) => String(u).includes("/api/compliance/qualification-records") && !(o as { method?: string } | undefined)?.method).length;
    vi.mocked(apiFetch).mockImplementation(((url: string, opts?: { method?: string }) =>
      failing && !opts?.method && url.includes("/api/compliance/qualification-records")
        ? Promise.resolve({ ok: false, status: 500, data: null, error: { message: "The API is down." } })
        : real(url as never, opts as never)) as never);
    try {
      const w = mount(RoadTestPanel, {
        props: { driverId: "d1", done: false },
        global: {
          plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]],
          stubs: { RouterLink: RouterLinkStub },
        },
      });
      await settle(w as never);
      expect(w.text()).toContain("Could not load the road tests on file.");
      const before = asked();
      failing = false;
      await w.findAll("button").find((b) => b.text().trim() === "Retry")!.trigger("click");
      await settle(w as never);
      expect(asked()).toBe(before + 1);
      expect(w.text()).not.toContain("Could not load the road tests on file.");
    } finally {
      vi.mocked(apiFetch).mockImplementation(real);
    }
  });
});
