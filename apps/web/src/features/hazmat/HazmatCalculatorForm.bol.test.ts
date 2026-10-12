import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { DIESEL, DIESEL_REF, ok, PAINT, PAINT_REF, PRODUCTS, read } from "./bolRead/bolPrefill.fixtures";

/**
 * The calculator form taking a BOL read (§7A N6). What must hold: the products come from the exact-ref
 * lookup and nowhere else, every filled line shows where its values came from, a second read replaces the
 * first read's lines instead of adding its weight again while a typed line stays, a failed lookup changes
 * nothing, and the paper's non-hazmat freight answers the "rest of the load" question.
 */
const api = vi.hoisted(() => ({ calls: [] as string[], fail: false }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    api.calls.push(url);
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
    api.fail = false;
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

  it("changes nothing when the products cannot be looked up, and says so", async () => {
    api.fail = true;
    const w = mountForm();
    await w.setProps({ bolRead: read([{ a: PAINT, table: ok(PAINT_REF) }]) });
    await flushPromises();
    expect(lines(w)).toEqual([]);
    expect(w.find("[data-testid='bol-prefill']").text()).toBe("The products on the BOL could not be looked up: Busy.");
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
});
