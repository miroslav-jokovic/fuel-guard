import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { APPLY_CAPTURE_TITLES, APPLY_COPY } from "./strings";

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
// The real permission matrix over a fake who (F0, E10): the drawer asks `session.can("recruitment")`.
const sessionHolder = vi.hoisted(() => ({ s: null as null | { role: string | null } }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("recruiter");
  sessionHolder.s = s;
  return { useSessionStore: () => s };
});
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

/** F3: an answer's row on the Applicant facts card, and its Edit (absent when its door is closed). */
const factRow = (w: ReturnType<typeof drawer>, key: string) => w.find(`[data-fact='${key}']`);
const editOf = (w: ReturnType<typeof drawer>, key: string) => {
  const row = factRow(w, key);
  return row.exists() ? row.findAll("button").find((b) => b.text().trim() === "Edit") : undefined;
};
async function openFact(w: ReturnType<typeof drawer>, key: string): Promise<void> {
  await editOf(w, key)!.trigger("click");
  await settle(w);
}

beforeEach(() => {
  sessionHolder.s!.role = "recruiter";
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
  /**
   * F0 (APPLICATION-FIX-PLAN E10): `editable` says the application is still open, not that this reader
   * may change it. A `view` reader was shown Save and Approve, which the API then refused with 403.
   */
  it("⚠ offers a reader who may only view no corrections and no approval, and says why", async () => {
    sessionHolder.s!.role = "auditor";
    const w = drawer();
    await settle(w);
    expect(w.find("[data-testid='review-read-only']").exists()).toBe(true);
    expect(w.find("[data-applicant-facts]").exists()).toBe(false);
    expect(w.findAll("button").some((b) => b.text().startsWith("Approve"))).toBe(false);
  });

  /**
   * F0 (APPLICATION-FIX-PLAN, the 2026-11-09 audit): the summary was built from `captures: []`, so the
   * office read "None declared" beside a medical card the applicant had photographed.
   */
  it("⚠ lists the documents the applicant photographed as received, not as none declared", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      data: review({ captures: [{ slot: "medical_card", ordinal: 0, contentType: "image/jpeg", bytes: 1200, capturedAt: "2026-11-09T10:00:00Z" }] }),
    });
    const w = drawer();
    await settle(w);
    const title = APPLY_CAPTURE_TITLES.medical_card;
    const row = w.findAll("li, dl > div, tr, div").filter((n) => n.text().startsWith(title)).at(-1);
    expect(row, `no row for ${title}`).toBeDefined();
    expect(row!.text()).toContain(APPLY_COPY.documents.done);
    expect(row!.text()).not.toContain(APPLY_COPY.review.none);
  });

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
   * F3c part 2 (D-AM7): the jobs are the card's Employment group — every answer on the one card — and
   * still have ONE editor. Before this they were a second section of the drawer under the card.
   */
  it("draws the jobs once, inside the Applicant facts card's Employment group", async () => {
    const w = drawer();
    await settle(w);
    expect(w.findAll("[data-testid='employment-timeline']")).toHaveLength(1);
    const card = w.find("[data-applicant-facts]");
    expect(card.find("[data-testid='employment-timeline']").text()).toContain("Old Carrier");
    expect(card.findAll("button").some((b) => b.text().trim() === "Add a job")).toBe(true);
  });

  it("keeps a job found by the card's search, and leaves it out of a search for something else", async () => {
    const w = drawer();
    await settle(w);
    // The search field's own debounce is its business; the card's is what the query does.
    const search = w.findComponent({ name: "AppSearchField" });
    search.vm.$emit("update:modelValue", "old carrier");
    await settle(w);
    expect(w.find("[data-applicant-facts] [data-testid='employment-timeline']").exists()).toBe(true);
    expect(w.find("[data-fact='date_of_birth']").exists()).toBe(false);
    search.vm.$emit("update:modelValue", "date of birth");
    await settle(w);
    expect(w.find("[data-fact='date_of_birth']").exists()).toBe(true);
    expect(w.find("[data-testid='employment-timeline']").exists()).toBe(false);
  });

  it("⚠ still shows a view-only reader the jobs, read-only, without the card", async () => {
    sessionHolder.s!.role = "auditor";
    const w = drawer();
    await settle(w);
    expect(w.find("[data-applicant-facts]").exists()).toBe(false);
    expect(w.find("[data-testid='employment-timeline']").text()).toContain("Old Carrier");
    expect(w.findAll("button").some((b) => b.text().trim() === "Add a job")).toBe(false);
  });

  /**
   * §15.3 D-CQ2: the carrier's own questions print from the invitation's STAMP, the words this applicant
   * was asked — a question the carrier retired since still prints, and the skip reads as the applicant chose it.
   */
  it("prints the carrier's own questions from the invitation's stamp, with the answers given", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      data: review({
        payload: { ...PAYLOAD, carrier_answers: { "q-pet": true, "q-lane": "I'd rather not say" } },
        edits: [{ path: ["carrier_answers", "q-lane"], before: "East", after: "I'd rather not say", editedAt: "2026-11-11T12:00:00Z", editedBy: "Dana" }],
        carrierQuestions: [
          { id: "q-pet", wording: "Do you own a pet?", hint: null, kind: "boolean", choices: null, required: true },
          { id: "q-lane", wording: "Preferred lane", hint: null, kind: "select", choices: ["East", "West"], required: false },
        ],
      }),
    });
    const w = drawer();
    await settle(w);
    const text = w.text();
    expect(text).toContain("Do you own a pet?");
    expect(text).toContain("Preferred lane");
    expect(text).toMatch(/Do you own a pet\?\s*Yes/);
    expect(text).toMatch(/Preferred lane\s*I'd rather not say/);
    // F3c part 2, step 5: corrected on the card, one row per stamped question (until then not offered —
    // the draft does not carry the stamp, Q-CQ7; the review response does).
    expect(w.find("[data-fact='carrier_answers.q-pet']").text()).toContain("Do you own a pet?");
    expect(w.find("[data-fact='carrier_answers.q-lane']").exists()).toBe(true);
    // "What you changed" names the question by its stamped words, not "The carrier's own questions".
    expect(text).toMatch(/Preferred lane\s*East/);
    expect(text).not.toContain("The carrier's own questions East");
  });

  /**
   * C3c2c2 (Q-AW34): a v2 application is read as filing will compose it — Part 1's phone, not the draft's
   * retyped copy — with the applicant's note above the answers. F3: the card shows that phone once, and
   * corrects it through Part 1, where filing takes it from; a legacy link's phone is the draft's.
   */
  it("reads a v2 application as filing composes it, shows the note, and corrects Part 1's answers at Part 1", async () => {
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
    expect(factRow(w, "phone").text()).toContain("(312) 555-0142");

    await openFact(w, "phone");
    // E8: the box opens as a person types a phone, never Part 1's stored "+13125550142".
    expect((w.find("input#apply-phone").element as HTMLInputElement).value).toBe("(312) 555-0142");
    expect(button(w, "Save")!.attributes("disabled")).toBeDefined();
    await w.find("input#apply-phone").setValue("(312) 555-0199");
    apiFetch.mockResolvedValueOnce({ ok: true, data: { ok: true } });
    await button(w, "Save")!.trigger("click");
    await settle(w);
    const sent = apiFetch.mock.calls.find((c) => String(c[0]).endsWith("/part-one"));
    expect(sent?.[1].body).toMatchObject({ phone: "+13125550199", address_line1: "1 Main St", cdl_class: "A" });
    expect(apiFetch.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(false);

    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true, data: review({ payload: { ...PAYLOAD, phone: "555-0000" } }) });
    const legacy = drawer();
    await settle(legacy);
    expect(legacy.text()).toContain("555-0000");
    expect(legacy.find("[data-correction-note]").exists()).toBe(false);
    await openFact(legacy, "phone");
    await legacy.find("input#apply-phone").setValue("555-0001");
    await button(legacy, "Save")!.trigger("click");
    await settle(legacy);
    expect(apiFetch.mock.calls.find((c) => c[1]?.method === "PATCH")?.[1].body).toMatchObject({ path: ["phone"], value: "555-0001" });
  });

  /**
   * F0b: an applicant who opened their application with a code could not match the date of birth on
   * file — the date is what may be wrong, and the office corrects it (Q-AM13).
   */
  it("tells the office the date of birth on file may be wrong when the applicant used a code", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ unlockedByCodeAt: "2026-11-10T15:01:00Z" }) });
    const w = drawer();
    await settle(w);
    expect(w.find("[data-unlocked-by-code]").text()).toContain("The date of birth on file may be wrong.");
    expect(w.find("[data-unlocked-by-code]").text()).toContain("correct it under Applicant facts");

    apiFetch.mockResolvedValue({ ok: true, data: review({ unlockedByCodeAt: null }) });
    const never = drawer();
    await settle(never);
    expect(never.find("[data-unlocked-by-code]").exists()).toBe(false);
  });

  /**
   * Q-AW36 → F3: Part 1's answers are corrected while the office screens — before it has sent the form
   * (`editable` false) — and after approval, until filing or the first packet mark; a legacy link's
   * phone is a draft answer, so it follows the draft's window.
   */
  it("offers Part 1's answers for correction on a v2 application until it is filed or signing starts", async () => {
    const FACTS = {
      intake: { phone: "+13125550142", address_line1: "1 Main St", address_line2: null, city: "Joliet", state: "IL",
        postal_code: "60431", prior_positive_2y: false, cdl_class: "A" },
      licences: [{ position: 0, state_code: "IL", agency: null, licence_number: "IL123", expires_on: "2029-03-01" }],
      asOf: "2026-09-26",
    };
    for (const [over, offered] of [
      [{ partOne: FACTS }, true],
      [{ partOne: FACTS, state: "filling", editable: false }, true],
      [{ partOne: FACTS, state: "approved", editable: true }, true],
      [{ partOne: FACTS, state: "approved", editable: true, signingStarted: true }, false],
      [{ partOne: FACTS, state: "certified", editable: false }, false],
      [{ state: "filling", editable: false }, false],
    ] as const) {
      apiFetch.mockResolvedValue({ ok: true, data: review(over) });
      const w = drawer();
      await settle(w);
      expect(Boolean(editOf(w, "phone")), JSON.stringify(over).slice(0, 80)).toBe(offered);
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
  const dates = w.findAllComponents({ name: "AppTypedDate" });
  dates.find((d) => d.html().includes('id="office-employer-started_on"'))!.vm.$emit("update:modelValue", "2025-03-01");
  if (over.street !== false) await field(w, "address_line1").setValue("1 Frontier Rd");
  await field(w, "city").setValue("Omaha");
  w.findAllComponents({ name: "AppCombobox" }).find((c) => c.props("id") === "office-employer-state")!.vm.$emit("update:modelValue", "NE");
  await field(w, "reason_for_leaving").setValue("Moved");
  await settle(w);
  // F1 part 2: neither starts at Yes, so the office answers both before the (iv) pair.
  await field(w, "operated_cmv").findAll("input[type=radio]")[0]!.setValue(true);
  await field(w, "dot_regulated").findAll("input[type=radio]")[0]!.setValue(true);
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

    await openFact(w, "first_name");
    await w.find("input#apply-first_name").setValue("Suzan");
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

  /**
   * F0 (APPLICATION-FIX-PLAN E9): a refused correction used to clear the box, so the recruiter lost what
   * they had typed. It stays now, with Save still offered, the reason under it and the answer on file.
   */
  it("⚠ keeps what the recruiter typed when the correction is refused, beside the answer on file", async () => {
    const w = drawer();
    await settle(w);
    await openFact(w, "first_name");
    await w.find("input#apply-first_name").setValue("Suzan");
    await settle(w);
    apiFetch.mockResolvedValueOnce({ ok: false, status: 409, data: null, error: { message: "The applicant saved first." } });
    await button(w, "Save")!.trigger("click");
    await settle(w);

    expect((w.find("input#apply-first_name").element as HTMLInputElement).value).toBe("Suzan");
    expect(button(w, "Save")).toBeDefined();
    expect(w.text()).toContain("The applicant saved first.");
    expect(w.find("[data-fact-on-file]").text()).toContain("Susan");

    await button(w, "Cancel")!.trigger("click");
    await settle(w);
    expect(w.find("input#apply-first_name").exists()).toBe(false);
    expect(factRow(w, "first_name").text()).toContain("Susan");
  });

  /**
   * F3 (E1 → Q-AM13): the date of birth is the record's, so it is corrected through the identity writer —
   * with the licence it is written beside, as shown — and never as a draft edit, which would be replaced.
   */
  it("corrects the date of birth through the identity writer, with its own date control", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      data: review({ payload: { ...PAYLOAD, cdl_number: "IL123", cdl_state: "IL" } }),
    });
    const w = drawer();
    await settle(w);
    expect(factRow(w, "date_of_birth").text()).toContain("04/01/1980");
    await openFact(w, "date_of_birth");
    const box = w.find("input#apply-date_of_birth");
    await box.setValue("01041980");
    await box.trigger("blur");
    await settle(w);
    apiFetch.mockResolvedValueOnce({ ok: true, data: { ok: true } });
    await button(w, "Save")!.trigger("click");
    await settle(w);
    const call = apiFetch.mock.calls.find((c) => String(c[0]).endsWith("/identity"));
    expect(call?.[1].body).toEqual({ date_of_birth: "1980-01-04", cdl_number: "IL123", cdl_state: "IL" });
    expect(apiFetch.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(false);
  });

  it("offers nothing to save until something is actually different", async () => {
    // Sixty live Save buttons is sixty chances to record `"Joliet" → "Joliet"`, which the driver then
    // has to read past on the screen asking them what moved.
    const w = drawer();
    await settle(w);
    expect(button(w, "Save")).toBeUndefined();
    await openFact(w, "first_name");
    expect(button(w, "Save")!.attributes("disabled")).toBeDefined();
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

/** F3 (Q-AM13): the driver's own statements need a reason; the donor gender is replaced blind. */
describe("the owner's two exceptions", () => {
  const V2 = {
    partOne: PART_ONE,
    partOneAnswers: { dot_program_30d: true, dot_tested_6m: false, dot_random_12m: true, medical_card_pending: false, endorsements: [], donorGenderGiven: true },
  };

  it("keeps Save off on a drug-test statement until the office gives its reason, then sends it", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review(V2) });
    const w = drawer();
    await settle(w);
    await openFact(w, "dot_tested_6m");
    await factRow(w, "dot_tested_6m").findAll("input[type=radio]")[0]!.setValue(true);
    await settle(w);
    expect(button(w, "Save")!.attributes("disabled")).toBeDefined();
    await w.find("[data-fact-note]").setValue("Driver called: tested in May");
    await settle(w);
    apiFetch.mockResolvedValueOnce({ ok: true, data: { ok: true } });
    await button(w, "Save")!.trigger("click");
    await settle(w);
    const call = apiFetch.mock.calls.find((c) => String(c[0]).endsWith("/part-one/answer"));
    expect(call?.[1].body).toEqual({ key: "dot_tested_6m", value: true, note: "Driver called: tested in May" });
  });

  it("⚠ never shows the donor gender — says it was given, and opens the editor empty", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review(V2) });
    const w = drawer();
    await settle(w);
    expect(factRow(w, "donor_gender").text()).toContain("Given — not shown to the office");
    await openFact(w, "donor_gender");
    expect(w.find("[data-fact-blind]").exists()).toBe(true);
    expect(w.find("[data-fact-on-file]").exists()).toBe(false);
  });

  it("says a withheld correction was a replacement, never what to or from", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      data: review({ ...V2, edits: [{ path: ["donor_gender"], before: null, after: null, withheld: true, note: null, editedAt: "2026-11-10T12:00:00Z", editedBy: null }] }),
    });
    const w = drawer();
    await settle(w);
    expect(w.text()).toContain("Replaced — not shown to the office");
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
    expect(w.findAll("[data-fact] button").length).toBe(0);
    expect(button(w, "Approve")).toBeUndefined();
    // And says why, rather than simply having nothing there.
    expect(w.text()).toContain("started signing");
  });

  it("§9 P5 (EM-4): still offers corrections after approval, before signing — but no second approval", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ state: "approved", editable: true }) });
    const w = drawer();
    await settle(w);
    expect(editOf(w, "first_name")).toBeDefined();
    expect(button(w, "Approve")).toBeUndefined();
  });

  it("§9 P5 (EM-1): offers corrections while the applicant is still filling it in, and no approval", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: review({ state: "filling", editable: true }) });
    const w = drawer();
    await settle(w);
    expect(editOf(w, "first_name")).toBeDefined();
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

    // The review read twice — counted by its own path, since a reader who may see Recruiting also
    // loads the PSP suggestions beside the jobs (HW6b), which is a different question.
    expect(apiFetch.mock.calls.filter(([path]) => !String(path).includes("psp")).length).toBe(2);
    expect(w.text()).not.toContain("Could not load the application.");
    expect(w.text()).toContain("Applicant facts");
  });
});
