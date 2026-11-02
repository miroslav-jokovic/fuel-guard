import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";

/**
 * The office's review of an application (F4, D-AX11–13).
 *
 * ⚠ What is worth pinning is the WINDOW and the ACCOUNT. An office that can still change an answer
 * after the driver has been told to sign it, or that changes one without the driver being able to see
 * what moved, turns this feature from a control into a problem — and neither looks wrong in a diff.
 * Everything else here is a screen rendering a list.
 */

const apiFetch = vi.hoisted(() => vi.fn());
const fetchObjectUrl = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch, fetchObjectUrl }));
const openPdf = vi.hoisted(() => vi.fn());
vi.mock("@/lib/documentDownload", () => ({ openPdf, downloadPdf: vi.fn(), saveObjectUrl: vi.fn() }));

/**
 * ⚠ `DocumentPreview` is mounted for real here, with only its `BaseModal` stubbed — HeadlessUI's
 * `Dialog` throws under this repo's jsdom, as `DocumentPreview.test.ts`
 * notes. Stubbing the VIEWER instead would leave the path this drawer hands it unasserted, which
 * is the one thing about this wiring that can be wrong.
 */
const BaseModalStub = {
  template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "printable"],
};

/** Renders both slots inline, footer included — Approve lives in `#footer`. */
const SlideOverStub = {
  template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "description"],
};

const ApplicationReviewDrawer = (await import("./ApplicationReviewDrawer.vue")).default;

const PAYLOAD = {
  first_name: "Susan",
  last_name: "Godfrey",
  date_of_birth: "1980-04-01",
  employers: [
    {
      employer_name: "Old Carrier", usdot_number: "", address_line1: "", city: "Jolliet", state: "IL",
      phone: "", email: "", position_held: "Driver", started_on: "2023-01-01", ended_on: "2025-06-30",
      operated_cmv: true, dot_regulated: true, reason_for_leaving: "", subject_to_fmcsr: true,
      safety_sensitive: true,
    },
  ],
  declares_no_accidents: true,
  questionnaire: { position: "Line-haul driver" },
};

const review = (over: Record<string, unknown> = {}) => ({
  ok: true,
  invitationId: "inv-1",
  driverId: "drv-1",
  state: "awaiting_review",
  editable: true,
  payload: PAYLOAD,
  revision: 7,
  edits: [],
  ...over,
});

/**
 * ⚠ The SAME pinia the test activates, not a fresh one per mount. A second instance gives the
 * component its own toast store, so `useToastStore()` here would read an empty list forever and any
 * assertion about what the office was told would pass while saying nothing.
 */
let pinia: ReturnType<typeof createPinia>;

const drawer = () =>
  mount(ApplicationReviewDrawer, {
    props: { open: true, invitationId: "inv-1" },
    global: {
      plugins: [VueQueryPlugin, pinia],
      stubs: { SlideOver: SlideOverStub, BaseModal: BaseModalStub },
    },
  });

const settle = async (w: ReturnType<typeof drawer>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

const button = (w: ReturnType<typeof drawer>, label: string) =>
  w.findAll("button").find((b) => b.text().trim().startsWith(label));

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  apiFetch.mockReset();
  fetchObjectUrl.mockReset();
  fetchObjectUrl.mockResolvedValue("blob:preview-1");
  apiFetch.mockResolvedValue({ ok: true, data: review() });
});

// jsdom implements neither half of the object-URL API; the viewer revokes on close.
URL.revokeObjectURL = vi.fn();

describe("what the office reads", () => {
  it("shows the answers themselves, in the words the driver was asked them in", async () => {
    const w = drawer();
    await settle(w);
    expect(w.text()).toContain("Susan Godfrey");
    expect(w.text()).toContain("Old Carrier");
    // HW5b: the jobs are on the one timeline, and corrected in the one employer form — not offered a
    // second time, cell by cell, in the correction list.
    expect(w.find("[data-testid='employment-timeline']").text()).toContain("Old Carrier");
    expect(w.find("input#apply-employers-0-city").exists()).toBe(false);
  });

  /**
   * C3c2c2 (Q-AW34): a v2 application is read as filing will compose it — Part 1's phone, not the draft's
   * retyped copy — with the applicant's note above the answers, and no box offered for an answer filing
   * takes from Part 1 (the correction would be filed over).
   */
  it("reads a v2 application as filing composes it, shows the note, and offers no Part 1 answer to correct", async () => {
    const FACTS = {
      intake: {
        phone: "+13125550142", address_line1: "1 Main St", address_line2: null, city: "Joliet", state: "IL",
        postal_code: "60431", prior_positive_2y: false, cdl_class: "A",
      },
      licences: [{ position: 0, state_code: "IL", agency: null, licence_number: "IL123", expires_on: "2029-03-01" }],
      asOf: "2026-09-26",
    };
    const payload = { ...PAYLOAD, phone: "555-0000", correction_note: "My phone ends in 42." };
    apiFetch.mockResolvedValue({ ok: true, data: review({ payload, partOne: FACTS }) });
    const w = drawer();
    await settle(w);
    expect(w.text()).toContain("+13125550142");
    expect(w.text()).not.toContain("555-0000");
    expect(w.find("[data-correction-note]").text()).toContain("My phone ends in 42.");
    expect(w.find("input#apply-phone").exists()).toBe(false);

    apiFetch.mockResolvedValue({ ok: true, data: review({ payload: { ...PAYLOAD, phone: "555-0000" } }) });
    const legacy = drawer();
    await settle(legacy);
    expect(legacy.text()).toContain("555-0000");
    expect(legacy.find("[data-correction-note]").exists()).toBe(false);
    expect(legacy.find("input#apply-phone").exists()).toBe(true);
  });

  /** Q-AW36: the correction the note asks for sits under it — on a v2 application, until filing (§9 P5). */
  it("offers the Part 1 correction on a v2 application until it is filed, and never on a legacy one", async () => {
    const FACTS = {
      intake: { phone: "+13125550142", address_line1: "1 Main St", address_line2: null, city: "Joliet", state: "IL",
        postal_code: "60431", prior_positive_2y: false, cdl_class: "A" },
      licences: [{ position: 0, state_code: "IL", agency: null, licence_number: "IL123", expires_on: "2029-03-01" }],
      asOf: "2026-09-26",
    };
    for (const [over, shown] of [
      [{ partOne: FACTS }, true],
      [{ partOne: FACTS, state: "filling", editable: false }, true],
      [{ partOne: FACTS, state: "approved", editable: true }, true],
      [{ partOne: FACTS, state: "certified", editable: false }, false],
      [{}, false],
    ] as const) {
      apiFetch.mockResolvedValue({ ok: true, data: review(over) });
      const w = drawer();
      await settle(w);
      expect(w.find("[data-part-one-correction]").exists(), JSON.stringify(over).slice(0, 60)).toBe(shown);
    }
  });

  it("says where the application has got to", async () => {
    const w = drawer();
    await settle(w);
    expect(w.text()).toContain("Waiting for you");
  });
});

/**
 * ⚠ The correction an office visit is actually for, and it is an ADDITION.
 *
 * The owner, 2026-09-14: *"the only critical part is previous companies he has worked and they
 * usually don't remember companies or dates, so we can go together and update this."* Since HW5b the
 * office adds, changes and fills a job in the applicant's own form (`EmployerFormDrawer`), on P5's
 * transport: one `add_employer`, or one `set` per changed answer, each naming the revision it follows.
 */
const PART_ONE = {
  intake: { phone: "+13125550142", address_line1: "1 Main St", address_line2: null, city: "Joliet", state: "IL",
    postal_code: "60431", prior_positive_2y: false, cdl_class: "A" },
  licences: [{ position: 0, state_code: "IL", agency: null, licence_number: "IL123", expires_on: "2029-03-01" }],
  asOf: "2026-09-26",
};

const field = (w: ReturnType<typeof drawer>, name: string) => w.find(`#office-employer-${name}`);
const patches = () => apiFetch.mock.calls.filter((c) => c[1]?.method === "PATCH").map((c) => c[1].body);

/** Fill the one form, as the office would across the desk. */
async function fillJob(w: ReturnType<typeof drawer>, over: { street?: boolean; tested?: boolean } = {}): Promise<void> {
  await field(w, "employer_name").setValue("Werner");
  const dates = w.findAllComponents({ name: "AppDateField" });
  dates.find((d) => d.html().includes('id="office-employer-started_on"'))!.vm.$emit("update:modelValue", "2025-03-01");
  if (over.street !== false) await field(w, "address_line1").setValue("1 Frontier Rd");
  await field(w, "city").setValue("Omaha");
  w.findAllComponents({ name: "AppCombobox" }).find((c) => c.props("id") === "office-employer-state")!.vm.$emit("update:modelValue", "NE");
  await field(w, "reason_for_leaving").setValue("Moved");
  await settle(w);
  await field(w, "subject_to_fmcsr").findAll("input[type=radio]")[0]!.setValue(true);
  if (over.tested !== false) await field(w, "safety_sensitive").findAll("input[type=radio]")[1]!.setValue(true);
  await settle(w);
}

describe("adding a job the applicant left out (HW5b, the one form)", () => {
  it("EM-3: will not add a job without its street on a v2 application, and says so under the box", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ partOne: PART_ONE }) });
    const w = drawer();
    await settle(w);
    await button(w, "Add a job")!.trigger("click");
    await settle(w);
    await fillJob(w, { street: false });
    await button(w, "Save this job")!.trigger("click");
    await settle(w);
    expect(patches()).toHaveLength(0);
    expect(field(w, "address_line1").attributes("aria-invalid")).toBe("true");
  });

  it("will not add a job in the last three years until both (b)(10)(iv) questions are answered", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ partOne: PART_ONE }) });
    const w = drawer();
    await settle(w);
    await button(w, "Add a job")!.trigger("click");
    await settle(w);
    await fillJob(w, { tested: false });
    await button(w, "Save this job")!.trigger("click");
    await settle(w);
    expect(patches()).toHaveLength(0);
    expect(w.text()).toContain("Say whether this job was subject to DOT drug and alcohol testing");
  });

  it("appends at the end of the list, by its own key, with the revision the drawer read", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ partOne: PART_ONE }) });
    const w = drawer();
    await settle(w);
    await button(w, "Add a job")!.trigger("click");
    await settle(w);
    await fillJob(w);
    apiFetch.mockResolvedValueOnce({ ok: true, data: { ok: true, revision: 8 } });
    await button(w, "Save this job")!.trigger("click");
    await settle(w);

    const [body] = patches();
    expect(body).toMatchObject({ op: "add_employer", revision: 7 });
    expect(typeof body.employer.key).toBe("string");
    expect(body.employer).toMatchObject({
      employer_name: "Werner",
      // EM-3: the street — no longer a hard-coded "".
      address_line1: "1 Frontier Rd",
      // EM-5: the applicant's defaults, on the office's add too.
      operated_cmv: true,
      dot_regulated: true,
      // Q-AW33: what was chosen, each on its own.
      subject_to_fmcsr: true,
      safety_sensitive: false,
    });
  });

  it("changes a job as one correction per changed answer, each on the revision the last one returned", async () => {
    const w = drawer();
    await settle(w);
    await w.find("[data-job] button").trigger("click");
    await settle(w);
    await field(w, "city").setValue("Joliet");
    await field(w, "reason_for_leaving").setValue("Closer to home");
    // The applicant's job has no key (a draft from before AW1): the first write gives it one.
    apiFetch.mockResolvedValueOnce({ ok: true, data: { ok: true, revision: 12, payload: { employers: [{ key: "k-minted" }] } } });
    apiFetch.mockResolvedValueOnce({ ok: true, data: { ok: true, revision: 13, payload: {} } });
    await button(w, "Save this job")!.trigger("click");
    await settle(w);

    expect(patches()).toEqual([
      { path: ["employers", 0, "city"], value: "Joliet", revision: 7 },
      { path: ["employers", "k-minted", "reason_for_leaving"], value: "Closer to home", revision: 12 },
    ]);
  });

  it("offers nothing to add or change once the applicant has started signing", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ state: "approved", editable: false }) });
    const w = drawer();
    await settle(w);
    expect(w.find("[data-testid='employment-timeline']").text()).toContain("Old Carrier");
    expect(button(w, "Add a job")).toBeUndefined();
    expect(w.find("[data-job] button").exists()).toBe(false);
  });
});

describe("correcting one answer", () => {
  it("sends the contract path and the new value, and nothing else", async () => {
    const w = drawer();
    await settle(w);

    const name = w.find("input#apply-first_name");
    await name.setValue("Suzan");
    await settle(w);
    apiFetch.mockResolvedValueOnce({ ok: true, data: { ok: true } });
    await button(w, "Save")!.trigger("click");
    await settle(w);

    const call = apiFetch.mock.calls.find((c) => c[1]?.method === "PATCH");
    expect(call?.[0]).toBe("/api/recruitment/applications/inv-1/answer");
    // ⚠ The object, never a JSON string — `apiFetch` serialises it, and a double-encoded body is
    // refused by express and surfaces as a generic 500 with no audit row.
    expect(typeof call?.[1].body).toBe("object");
    expect(call?.[1].body.path).toEqual(["first_name"]);
    expect(call?.[1].body.value).toBe("Suzan");
    // §8.1 / §9 P5: the revision the drawer read, so the API can refuse a write over a newer save.
    expect(call?.[1].body.revision).toBe(7);
  });

  it("offers nothing to save until something is actually different", async () => {
    // Sixty live Save buttons is sixty chances to record `"Joliet" → "Joliet"`, which the driver then
    // has to read past on the screen asking them what moved.
    const w = drawer();
    await settle(w);
    expect(button(w, "Save")).toBeUndefined();
  });

  it("shows every correction, with what the answer was before it", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      data: review({
        edits: [
          { path: ["first_name"], before: "Suzan", after: "Susan", editedAt: "2026-09-11T12:00:00Z", editedBy: "Dana" },
        ],
      }),
    });
    const w = drawer();
    await settle(w);
    expect(w.text()).toContain("Suzan");
    expect(w.text()).toContain("Corrected");
  });
});

/**
 * ⚠ The window. It would be easy to leave the controls up until the driver signs — the draft is still
 * a draft. It must not be: approval is what tells the driver *this document, now, please sign it*.
 */
describe("when the answers may still be changed", () => {
  it("offers no correction and no approval once the applicant has started signing", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ state: "approved", editable: false }) });
    const w = drawer();
    await settle(w);
    expect(w.find("input#apply-first_name").exists()).toBe(false);
    expect(button(w, "Approve")).toBeUndefined();
    // And says why, rather than simply having nothing there.
    expect(w.text()).toContain("started signing");
  });

  it("§9 P5 (EM-4): still offers corrections after approval, before signing — but no second approval", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ state: "approved", editable: true }) });
    const w = drawer();
    await settle(w);
    expect(w.find("input#apply-first_name").exists()).toBe(true);
    expect(button(w, "Approve")).toBeUndefined();
  });

  it("§9 P5 (EM-1): offers corrections while the applicant is still filling it in, and no approval", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ state: "filling", editable: true }) });
    const w = drawer();
    await settle(w);
    expect(w.find("input#apply-first_name").exists()).toBe(true);
    expect(button(w, "Approve")).toBeUndefined();
    expect(w.text()).toContain("type in what they tell you on the phone");
  });

  it("offers no correction while the driver is still filling it in", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ state: "filling", editable: false, payload: null }) });
    const w = drawer();
    await settle(w);
    expect(button(w, "Approve")).toBeUndefined();
    expect(w.text()).toContain("still filling this in");
  });

  it("says the answers are part of the qualification file once they are signed", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ state: "certified", editable: false }) });
    const w = drawer();
    await settle(w);
    expect(w.text()).toContain("Signed and filed");
  });
});

describe("approving it", () => {
  it("asks the server to approve it", async () => {
    const w = drawer();
    await settle(w);
    apiFetch.mockResolvedValueOnce({ ok: true, data: { ok: true } });
    await button(w, "Approve")!.trigger("click");
    await settle(w);

    const call = apiFetch.mock.calls.find((c) => c[1]?.method === "POST");
    expect(call?.[0]).toBe("/api/recruitment/applications/inv-1/approve");
  });
});

/**
 * The printable preview (F6).
 *
 * ⚠ The one thing worth pinning is that it DISAPPEARS once the application is filed. The copy in the
 * qualification file is hashed and cited by its §391.51(b)(1) record and is offered on this same page;
 * a second, uncited rendering of a filed federal record is the thing this button must never produce.
 */
describe("printing it", () => {
  it("opens the rendered application BESIDE the record, at the invitation it belongs to", async () => {
    const w = drawer();
    await settle(w);

    const viewer = w.findComponent({ name: "DocumentPreview" });
    expect(viewer.props("open")).toBe(false);

    await button(w, "Open as a PDF")!.trigger("click");
    await settle(w);

    expect(viewer.props("open")).toBe(true);
    expect((viewer.props("rendered") as { path: string }).path).toBe(
      "/api/recruitment/applications/inv-1/preview.pdf",
    );
    // ⚠ B8's done-when, and the reason this replaced `openPdf`: the record the reviewer is reading
    // the document AGAINST is still on the screen underneath it, and nothing reached for a new tab.
    expect(w.text()).toContain("Susan Godfrey");
    expect(openPdf).not.toHaveBeenCalled();
  });

  it("offers it while the driver is still filling it in — that is what it is for", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ state: "filling", editable: false }) });
    const w = drawer();
    await settle(w);
    expect(button(w, "Open as a PDF")).toBeDefined();
  });

  it("offers nothing to print on a link nobody has typed into", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ state: "filling", editable: false, payload: null }) });
    const w = drawer();
    await settle(w);
    expect(button(w, "Open as a PDF")).toBeUndefined();
  });

  it("does not offer a preview of an application that is already filed", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ state: "certified", editable: false }) });
    const w = drawer();
    await settle(w);
    expect(button(w, "Open as a PDF")).toBeUndefined();
  });

  /**
   * ⚠ The refusal is no longer this drawer's to report — the viewer fetches the bytes now, so the
   * API's own sentence is pinned in `DocumentPreview.test.ts` ("says the API's own sentence when the
   * render is refused"). What is still this drawer's is WHICH document the viewer is left holding.
   */
  it("starts on the record, not on the last applicant's PDF, when it moves to another one", async () => {
    const w = drawer();
    await settle(w);
    await button(w, "Open as a PDF")!.trigger("click");
    await settle(w);
    expect(w.findComponent({ name: "DocumentPreview" }).props("open")).toBe(true);

    await w.setProps({ invitationId: "inv-2" });
    await settle(w);

    const viewer = w.findComponent({ name: "DocumentPreview" });
    expect(viewer.props("open")).toBe(false);
    expect((viewer.props("rendered") as { path: string }).path).toBe(
      "/api/recruitment/applications/inv-2/preview.pdf",
    );
  });
});

/**
 * D-US5: a failed read is said, with a Retry. Before it fell through to `state`'s default and told the
 * reviewer "The applicant is still filling this in" — a sentence about the applicant that was really
 * about the network, and one that sends an office to chase a driver who may have finished days ago.
 */
describe("when the application cannot be read (D-US5)", () => {
  it("says so instead of saying the applicant is still filling it in, and Retry asks again", async () => {
    apiFetch.mockResolvedValueOnce({ ok: false, status: 500, data: null, error: { message: "The API is down." } });
    const { QueryClient } = await import("@tanstack/vue-query");
    const w = mount(ApplicationReviewDrawer, {
      props: { open: true, invitationId: "inv-1" },
      global: {
        plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }], pinia],
        stubs: { SlideOver: SlideOverStub, BaseModal: BaseModalStub },
      },
    });
    await settle(w);
    expect(w.text()).toContain("Could not load the application.");
    expect(w.text()).not.toContain("still filling this in");

    await w.findAll("button").find((b) => b.text().trim() === "Retry")!.trigger("click");
    await settle(w);

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(w.text()).not.toContain("Could not load the application.");
    expect(w.text()).toContain("Correct an answer");
  });
});
