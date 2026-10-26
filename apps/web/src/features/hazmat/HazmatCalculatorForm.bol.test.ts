import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { DIESEL, DIESEL_REF, ok, pagesAudit, PAINT, PAINT_REF, PRODUCTS, read } from "./bolRead/bolPrefill.fixtures";

/**
 * The calculator form taking a BOL read (§7A N6). What must hold: the products come from the exact-ref
 * lookup and nowhere else, every filled line shows where its values came from, a second read replaces the
 * first read's lines instead of adding its weight again while a typed line stays, a failed lookup changes
 * nothing, and the paper's non-hazmat freight answers the "rest of the load" question.
 */
const api = vi.hoisted(() => ({ calls: [] as string[], fail: false, posts: [] as { url: string; body: unknown }[], reviewAudit: null as unknown }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    api.calls.push(url);
    if (opts?.method === "POST") api.posts.push({ url, body: opts.body });
    if (url.endsWith("/reviews")) return { ok: true, status: 201, data: { recorded: 1, paperAudit: api.reviewAudit } };
    if (url.endsWith("/calc")) return new Promise(() => {}); // the placards are not what these tests check
    if (url.includes("refs=")) {
      if (api.fail) return { ok: false, status: 503, error: { code: "x", message: "Busy" } };
      const refs = decodeURIComponent(url.split("refs=")[1]!).split(",");
      return { ok: true, status: 200, data: { datasetVersion: "t", products: PRODUCTS.filter((p) => refs.includes(p.hmtRef)) } };
    }
    return { ok: true, status: 200, data: { datasetVersion: "t", products: [] } };
  }),
}));

const { default: HazmatCalculatorForm } = await import("./HazmatCalculatorForm.vue");

function mountForm() {
  return mount(HazmatCalculatorForm, { props: { bolRead: null }, global: { plugins: [VueQueryPlugin] } });
}
const lines = (w: ReturnType<typeof mountForm>) => w.findAll("[data-testid='bol-line']").map((l) => l.text());

describe("HazmatCalculatorForm with a BOL read", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    api.calls = [];
    api.posts = [];
    api.fail = false;
    api.reviewAudit = null;
  });

  it("fills one line per product, each from the exact-ref lookup and saying where it came from", async () => {
    const w = mountForm();
    await w.setProps({ bolRead: read([{ a: DIESEL, table: ok(DIESEL_REF) }, { a: PAINT, b: { ...PAINT, packageCount: 9 }, table: ok(PAINT_REF) }]) });
    await flushPromises();
    expect(api.calls.filter((c) => c.includes("refs="))).toEqual([`/api/hazmat/products?refs=${encodeURIComponent(`${DIESEL_REF},${PAINT_REF}`)}`]);
    expect(lines(w)).toEqual(["From the BOL: NA1993, Diesel fuel, Combustible liquid, PG III", "From the BOL: UN1263, PAINT, 3, II"]);
    expect(w.text()).toContain(DIESEL_REF);
    expect(w.text()).toContain("The two readers disagree: 6 or 9. Check the page.");
    expect(w.find("[data-testid='bol-prefill']").text()).toMatch(/^Filled 2 products from the BOL/);
    // A person's correction replaces the reader's account of that field, and of no other.
    await w.findAll("input[placeholder='1056']").at(-1)!.setValue("7");
    expect(w.findAll("[data-testid='bol-field-note']").filter((n) => n.text() === "Changed by you.")).toHaveLength(1);
  });

  it("replaces an earlier read's lines on the next read, and keeps a line a person typed", async () => {
    const w = mountForm();
    await w.setProps({ bolRead: read([{ a: PAINT, table: ok(PAINT_REF) }]) });
    await flushPromises();
    await w.findAll("button").find((b) => b.text().includes("Add product"))!.trigger("click");
    await w.findAll("input[placeholder='44307']").at(-1)!.setValue("100");
    await w.setProps({ bolRead: read([{ a: DIESEL, table: ok(DIESEL_REF) }]) });
    await flushPromises();
    expect(lines(w)).toEqual(["From the BOL: NA1993, Diesel fuel, Combustible liquid, PG III"]);
    expect(w.text()).not.toContain(PAINT_REF);
    expect((w.findAll("input[placeholder='44307']").map((i) => (i.element as HTMLInputElement).value))).toEqual(["100", "59500"]);
  });

  it("shows the paper audit above the lines, and clears it on Reset", async () => {
    const w = mountForm();
    const paperAudit = { datasetVersion: "t", results: [{ ruleId: "paper_quantity_present", outcome: "fail" as const, reason: "missing", lineIndex: 0, facts: { lineLabel: "UN1263" } }] };
    await w.setProps({ bolRead: read([{ a: PAINT, table: ok(PAINT_REF) }], { paperAudit }) });
    await flushPromises();
    expect(w.find("[data-testid='bol-finding-wrong'] p").text()).toBe("UN1263 shows no total quantity.");
    await w.findAll("button").find((b) => b.text() === "Reset")!.trigger("click");
    expect(w.find("[data-testid='bol-findings']").exists()).toBe(false);
  });

  it("never leaves an earlier read's audit up when the next read cannot be used", async () => {
    const w = mountForm();
    const paperAudit = { datasetVersion: "t", results: [{ ruleId: "paper_quantity_present", outcome: "fail" as const, reason: "missing", lineIndex: 0, facts: { lineLabel: "UN1263" } }] };
    await w.setProps({ bolRead: read([{ a: PAINT, table: ok(PAINT_REF) }], { paperAudit }) });
    await flushPromises();
    api.fail = true;
    await w.setProps({ bolRead: read([{ a: DIESEL, table: ok(DIESEL_REF) }], { paperAudit }) });
    await flushPromises();
    expect(w.find("[data-testid='bol-findings']").exists()).toBe(false);
  });

  it("changes nothing when the products cannot be looked up, and says so", async () => {
    api.fail = true;
    const w = mountForm();
    await w.setProps({ bolRead: read([{ a: PAINT, table: ok(PAINT_REF) }]) });
    await flushPromises();
    expect(lines(w)).toEqual([]);
    expect(w.find("[data-testid='bol-prefill']").text()).toBe("The products on the BOL could not be looked up: Busy.");
    expect(w.find("[data-testid='bol-findings']").exists()).toBe(false);
  });

  it("says a BOL with no hazmat line has none, instead of an audit that checked nothing — the owner's produce BOL", async () => {
    const w = mountForm();
    const paperAudit = { datasetVersion: "t", results: [{ ruleId: "paper_er_phone", outcome: "pass" as const, reason: "present", lineIndex: null, facts: {} }, ...pagesAudit("pass").results] };
    await w.setProps({ bolRead: read([{ a: PAINT, table: ok(PAINT_REF) }]) });
    await flushPromises();
    await w.setProps({ bolRead: read([], { otherLines: ["4ZRG - RED & GREEN LETTUCE 4OZ", "4ZGL - GREEN LEAF LETTUCE 4OZ"], paperAudit, scan: [] }) });
    await flushPromises();
    const note = w.find("[data-testid='bol-prefill']").text();
    expect(note).toContain("No hazardous materials on this BOL.");
    expect(note).toContain("Both readers read it and found no hazmat line, only: 4ZRG - RED & GREEN LETTUCE 4OZ; 4ZGL - GREEN LEAF LETTUCE 4OZ.");
    expect(note).toContain("The page scan found no UN or NA number and no HM mark, and every page is here. Nothing on this BOL needs a placard.");
    expect(w.find("[data-testid='bol-findings']").exists()).toBe(false);
    // The earlier read's paint line is gone: this read is the BOL on screen.
    expect(lines(w)).toEqual([]);
    expect(w.text()).not.toContain(PAINT_REF);
  });

  it("does not say both readers looked when only one did", async () => {
    const w = mountForm();
    const solo = read([], { paperAudit: pagesAudit("pass"), scan: [] });
    solo.evidence = solo.evidence.map((e) => ({ ...e, sources: e.sources.filter((s) => s.reader !== "passB") }));
    await w.setProps({ bolRead: solo });
    await flushPromises();
    const note = w.find("[data-testid='bol-prefill']").text();
    expect(note).toContain("No hazardous materials read on this BOL — check the page.");
    expect(note).toContain("Only one reader read it");
    expect(note).not.toContain("needs a placard");
  });

  it("says check the page, and why, when both readers agree but the page scan or the page count does not back them", async () => {
    const w = mountForm();
    const note = async (over: Parameters<typeof read>[1]) => {
      await w.setProps({ bolRead: read([], over) });
      await flushPromises();
      return w.find("[data-testid='bol-prefill']").text();
    };
    const missed = await note({ paperAudit: pagesAudit("pass"), scan: ["UN1993", "RQ"] });
    expect(missed).toContain("No hazardous materials read on this BOL — check the page.");
    expect(missed).toContain("The page scan found UN1993, RQ on page 1 — a hazmat line the readers may have missed.");
    expect(missed).not.toContain("needs a placard");
    expect(await note({ paperAudit: pagesAudit("pass") })).toContain("The page was not scanned for UN or NA numbers, so nothing backs the readers.");
    const partial = await note({ paperAudit: pagesAudit("fail"), scan: [] });
    expect(partial).toContain("It cannot be confirmed that every page of this BOL is here — check its page numbers.");
    expect(partial).not.toContain("needs a placard");
  });

  it("still fills a line only the second reader saw — that BOL is not a no-hazmat BOL", async () => {
    const w = mountForm();
    await w.setProps({ bolRead: read([{ a: null, b: PAINT, table: ok(PAINT_REF) }]) });
    await flushPromises();
    expect(w.find("[data-testid='bol-prefill']").text()).not.toContain("No hazardous materials");
    expect(lines(w)).toHaveLength(1);
  });

  it("accepts a BOL's decimal weight — 40,972.8 lb, the owner's UN3082 read — so Calculate is not blocked by the browser", async () => {
    const w = mountForm();
    await w.setProps({ bolRead: read([{ a: { ...PAINT, grossWeightLb: 40972.8 }, table: ok(PAINT_REF) }]) });
    await flushPromises();
    const gross = w.findAll("input[placeholder='44307']").at(-1)!.element as HTMLInputElement;
    expect(gross.value).toBe("40972.8");
    // A number input without `step` steps by 1: the browser marks 40972.8 invalid and refuses to submit.
    expect(gross.validity.stepMismatch).toBe(false);
    expect(gross.validity.valid).toBe(true);
  });

  it("lets every decimal field on the calculator take a decimal", async () => {
    const w = mountForm();
    await w.setProps({ bolRead: read([{ a: PAINT, table: ok(PAINT_REF) }]) });
    await flushPromises();
    const decimals = w.findAll("input[type='number'][inputmode='decimal']");
    expect(decimals.length).toBeGreaterThan(0);
    for (const d of decimals) {
      (d.element as HTMLInputElement).value = "12.5";
      expect((d.element as HTMLInputElement).validity.stepMismatch, d.attributes("placeholder")).toBe(false);
    }
  });

  it("counts a line the table did not match, and answers the rest-of-load question from the paper", async () => {
    const w = mountForm();
    await w.setProps({
      bolRead: read([{ a: PAINT, table: ok(PAINT_REF) }, { a: { ...PAINT, idText: "5503615" }, table: { consistent: false, reason: "id_not_found" } }], { otherLines: ["Paper products"] }),
    });
    await flushPromises();
    expect(w.find("[data-testid='bol-prefill']").text()).toContain("1 line is not matched to the Hazardous Materials Table");
    expect(w.text()).toContain("The UN/NA number is not in the Hazardous Materials Table.");
    expect(w.html()).toContain("Yes — other freight rides along (mixed load)");
  });

  it("keeps an unmatched line's count and weight when the equipment is picked after the read (owner's test, 2026-10-19)", async () => {
    const w = mountForm();
    await w.setProps({ bolRead: read([{ a: { ...PAINT, idText: "5503615" }, table: { consistent: false, reason: "id_not_found" } }]) });
    await flushPromises();
    const values = () => ["1056", "44307"].map((ph) => (w.findAll(`input[placeholder='${ph}']`).at(-1)!.element as HTMLInputElement).value);
    const before = values();
    expect(before.every((v) => v !== "")).toBe(true);
    const picker = w.findAllComponents({ name: "AppCombobox" }).find((c) => c.props("placeholder") === "Select…")!;
    picker.vm.$emit("update:modelValue", "van");
    await flushPromises();
    expect(values()).toEqual(before);
    expect(w.findAll("[data-testid='bol-field-note']").some((n) => n.text() === "Changed by you.")).toBe(false);
  });

  it("keeps every 'Yes, the page says …' the person clicked, so Calculate unlocks after the last (owner, 2026-10-19)", async () => {
    const w = mountForm();
    // Two lines only the second reader saw: every field waits on a person, none has readings to pick.
    await w.setProps({ bolRead: read([{ a: null, b: PAINT, table: ok(PAINT_REF) }, { a: null, b: { ...PAINT, grossWeightLb: 1200 }, table: ok(PAINT_REF) }]) });
    await flushPromises();
    const picker = w.findAllComponents({ name: "AppCombobox" }).find((c) => c.props("placeholder") === "Select…")!;
    picker.vm.$emit("update:modelValue", "van");
    await flushPromises();
    const confirms = () => w.findAll("[data-testid='bol-field-confirm']");
    const total = confirms().length;
    expect(total).toBeGreaterThan(3);
    expect(confirms()[0]!.text()).toMatch(/^Yes, the page says /);
    for (let k = 0; k < total; k++) {
      await confirms()[0]!.trigger("click");
      expect(confirms()).toHaveLength(total - k - 1);
    }
    expect(w.find("[data-testid='bol-pending']").exists()).toBe(false);
    expect(w.find("button[type='submit']").attributes("disabled")).toBeUndefined();
  });

  // D-DR24 — the external audit of 2026-10-14: Calculate took a disputed count as pass A's value, and no
  // review was ever recorded.
  describe("a disputed field and the review a Calculate press records (D-DR24)", () => {
    const disputed = () => read([{ a: { ...PAINT, packageCount: 9 }, b: PAINT, table: ok(PAINT_REF) }]);
    const submit = (w: ReturnType<typeof mountForm>) => w.find("button[type='submit']");
    async function withEquipment() {
      const w = mountForm();
      await w.setProps({ bolRead: disputed() });
      await flushPromises();
      const picker = w.findAllComponents({ name: "AppCombobox" }).find((c) => c.props("placeholder") === "Select…")!;
      picker.vm.$emit("update:modelValue", "van");
      await flushPromises();
      return w;
    }

    it("keeps Calculate disabled, and says why, until a person picks one of the two readings", async () => {
      const w = await withEquipment();
      expect(submit(w).attributes("disabled")).toBeDefined();
      expect(w.find("[data-testid='bol-pending']").text()).toMatch(/^1 field filled from the BOL needs a check against the page/);
      const use = w.findAll("[data-testid='bol-field-choose']");
      expect(use.map((b) => b.text())).toEqual(["Use 9", "Use 6"]);
      await use[1]!.trigger("click");
      expect((w.findAll("input[placeholder='1056']").at(-1)!.element as HTMLInputElement).value).toBe("6");
      expect(w.find("[data-testid='bol-pending']").exists()).toBe(false);
      expect(submit(w).attributes("disabled")).toBeUndefined();
    });

    it("counts picking pass A's own reading as an act: the value does not change, the review says explicit", async () => {
      const w = await withEquipment();
      await w.findAll("[data-testid='bol-field-choose']")[0]!.trigger("click");
      expect(w.find("[data-testid='bol-pending']").exists()).toBe(false);
      await w.find("form").trigger("submit");
      await flushPromises();
      const body = api.posts.find((p) => p.url.endsWith("/reviews"))!.body as { reviews: { path: string; action: string; explicit: boolean }[] };
      expect(body.reviews.find((r) => r.path.endsWith("packageCount"))).toMatchObject({ action: "confirmed", explicit: true });
    });

    it("refuses a submitted form while a field waits, and records nothing", async () => {
      const w = await withEquipment();
      await w.find("form").trigger("submit");
      await flushPromises();
      expect(api.posts).toEqual([]);
    });

    it("records a picked count as it is picked, then one Calculate batch without it, and none for a repeat press (Q-RC5)", async () => {
      const w = await withEquipment();
      await w.findAll("[data-testid='bol-field-choose']")[1]!.trigger("click");
      await flushPromises();
      type Body = { consumer: string; reviews: { path: string; action: string; explicit: boolean; newValue: unknown }[] };
      const reviews = () => api.posts.filter((p) => p.url.endsWith("/reviews"));
      // The pick is the person saying what the page prints: recorded now, so the paper audit takes it.
      expect(reviews().map((p) => p.url)).toEqual([`/api/documents/reads/${disputed().id}/reviews`]);
      expect((reviews()[0]!.body as Body).consumer).toBe("paper_check");
      expect((reviews()[0]!.body as Body).reviews).toEqual([
        { path: "hazmat.lines[0].packageCount", action: "corrected", oldValue: 9, newValue: 6, explicit: true },
      ]);
      await w.find("form").trigger("submit");
      await flushPromises();
      expect(reviews()).toHaveLength(2);
      const batch = reviews()[1]!.body as Body;
      expect(batch.consumer).toBe("hazmat_calculator");
      // One act is one row: the count recorded at the pick is not recorded again.
      expect(batch.reviews.find((r) => r.path.endsWith("packageCount"))).toBeUndefined();
      expect(batch.reviews.find((r) => r.path.endsWith("idText"))).toMatchObject({ action: "confirmed", explicit: false });
      expect(api.posts.some((p) => p.url.endsWith("/calc"))).toBe(true);
      await w.find("form").trigger("submit");
      await flushPromises();
      expect(reviews()).toHaveLength(2);
    });

    it("shows the paper audit a recorded check answers with, and offers the readings under a check it waits on (Q-RC5)", async () => {
      const unconfirmed = { ruleId: "paper_certification", outcome: "cannot_tell" as const, reason: "field_unconfirmed", lineIndex: null, facts: { unconfirmed: ["hazmat.shipperCertification"] } };
      const r = read([{ a: PAINT, table: ok(PAINT_REF) }], { paperAudit: { datasetVersion: "t", results: [unconfirmed] } });
      r.evidence.push({ path: "hazmat.shipperCertification", value: null, status: "check", ruleVersion: "12", sources: [
        { reader: "passA", page: null, bbox: null, value: null }, { reader: "passB", page: null, bbox: null, value: true }] });
      api.reviewAudit = { datasetVersion: "t", results: [{ ...unconfirmed, outcome: "pass", reason: "present", facts: {} }] };
      const w = mountForm();
      await w.setProps({ bolRead: r });
      await flushPromises();
      const choice = w.find("[data-testid='bol-finding-choice']");
      expect(choice.text()).toContain("What does the page show for the shipper's certification?");
      await choice.findAll("button").find((b) => b.text() === "Yes, it is printed")!.trigger("click");
      await flushPromises();
      expect((api.posts.at(-1)!.body as { consumer: string }).consumer).toBe("paper_check");
      expect((api.posts.at(-1)!.body as { reviews: unknown[] }).reviews).toEqual([
        { path: "hazmat.shipperCertification", action: "corrected", oldValue: null, newValue: true, explicit: true },
      ]);
      expect(w.find("[data-testid='bol-finding-choice']").exists()).toBe(false);
      expect(w.find("[data-testid='bol-findings-clean']").exists()).toBe(true);
    });
  });
});
