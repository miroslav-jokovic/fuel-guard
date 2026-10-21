import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { toRaw } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import type { ReadResponse } from "@silvicom/shared";
import { DIESEL, DIESEL_REF, ok, PAINT, PAINT_REF, PRODUCTS, read, type Line } from "./bolRead/bolPrefill.fixtures";
import { FORM_VALUE } from "./bolRead/bolReview";
import type { BolLineView, PrefillKey } from "./bolRead/bolPrefill";
import { EQUIPMENT_OPTIONS, type CalcLineForm } from "./calcModel";

/**
 * RC4 (READER-CORRECTNESS-PLAN §5): a value a BOL read put on the calculator changes only by a person's act.
 *
 * The form's single-case tests each pin one way this broke — picking the equipment after a read blanked an
 * unmatched line's count and weight (owner, 2026-10-19), a second read added its weight on top of the first —
 * and each was found by the owner, by hand. This drives the real form through seeded random sequences of
 * everything a dispatcher can do to it (the equipment, a fleet trailer and the tab between the two, add and
 * remove a line, type a count or weight, pick or clear a product, tick Limited Quantity, pick a reading,
 * confirm a field, Reset, another read, a read whose lookup fails, a read with no hazmat line) and after every
 * act holds, against a model of the form:
 *
 *   - every line is the line the model expects, in order — nothing a read filled vanishes but by Remove, Reset
 *     or the next read (which replaces it: one BOL's weight never counts twice), and a line a person typed
 *     survives the next read;
 *   - each field a read filled holds the read's value until the person changes, picks or clears that field;
 *   - a count, weight or product a person typed on their own line holds what they typed.
 *
 * A person's edit is made the way `v-model` makes it, by writing the line's field; everything else goes
 * through the events the child components emit, so the form's own handlers run.
 */

const api = vi.hoisted(() => ({ fail: false, reviews: [] as string[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    if (url.endsWith("/reviews")) {
      api.reviews.push(url);
      return { ok: true, status: 201, data: { recorded: 1 } };
    }
    if (url.endsWith("/calc")) return new Promise(() => {});
    if (url.includes("refs=")) {
      if (api.fail) return { ok: false, status: 503, error: { code: "x", message: "Busy" } };
      const refs = decodeURIComponent(url.split("refs=")[1]!).split(",");
      return { ok: true, status: 200, data: { datasetVersion: "t", products: PRODUCTS.filter((p) => refs.includes(p.hmtRef)) } };
    }
    return { ok: true, status: 200, data: { datasetVersion: "t", products: [] } };
  }),
}));
const TRAILERS = [
  { id: "t-tank", unit_number: "T1", trailer_type: "tanker", cargo_capacity_gal: 9200, cargo_compartments: null },
  { id: "t-van", unit_number: "T2", trailer_type: "dry_van", cargo_capacity_gal: null, cargo_compartments: null },
  { id: "t-unset", unit_number: "T3", trailer_type: null, cargo_capacity_gal: null, cargo_compartments: null },
];
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: () => ({ order: async () => ({ data: TRAILERS, error: null }) }) }) },
}));

const { default: HazmatCalculatorForm } = await import("./HazmatCalculatorForm.vue");
const { default: HazmatProductLines } = await import("./HazmatProductLines.vue");

/** The reads a sequence draws from, each with the number of lines it puts on the form. */
const TEMPLATE: Line = { ...PAINT, packageCount: null, grossWeightLb: null, quantity: { value: null, unit: null }, packaging: null };
const READS: { make: () => ReadResponse; lines: number; fails?: boolean }[] = [
  { make: () => read([{ a: DIESEL, table: ok(DIESEL_REF) }, { a: PAINT, b: { ...PAINT, packageCount: 9 }, table: ok(PAINT_REF) }]), lines: 2 },
  { make: () => read([{ a: PAINT, b: { ...PAINT, grossWeightLb: 4000 }, table: ok(PAINT_REF) }]), lines: 1 },
  { make: () => read([{ a: { ...PAINT, idText: "5503615" }, table: { consistent: false, reason: "id_not_found" } }, { a: PAINT, table: ok(PAINT_REF) }]), lines: 2 },
  { make: () => read([{ a: DIESEL, table: ok(DIESEL_REF) }, { a: null, b: PAINT, table: ok(PAINT_REF) }]), lines: 2 },
  { make: () => read([{ a: { ...PAINT, idText: "UN1236" }, b: PAINT, table: { consistent: false, reason: "psn_no_match", passB: ok(PAINT_REF) } }]), lines: 1 },
  { make: () => read([{ a: { ...PAINT, marks: ["LTD QTY"] }, table: ok(PAINT_REF) }, { a: TEMPLATE, table: ok(PAINT_REF) }]), lines: 1 },
  { make: () => read([], { otherLines: ["Paper products"], scan: [] }), lines: 0 },
  // The table refused the number and the paper prints only a volume: no product, count or weight — a line the
  // equipment picker would take for an empty one — but its package type is the read's.
  { make: () => read([{ a: { ...PAINT, idText: "5503615", packageCount: null, grossWeightLb: null, quantity: { value: 275, unit: "GAL" }, packaging: "1 TOTE" }, table: { consistent: false, reason: "id_not_found" } }]), lines: 1 },
  { make: () => read([{ a: DIESEL, table: ok(DIESEL_REF) }]), lines: 1, fails: true },
];

/** What the model expects of one line on the form. */
interface Expected {
  line: object;
  fromRead: boolean;
  values: Partial<Record<PrefillKey, unknown>>;
  /** What the read put in each field (a read's line only). */
  filled: Partial<Record<PrefillKey, unknown>>;
  /** Whether each field waited on a person when the read filled it: it stops waiting only by an act or a change. */
  pending: Partial<Record<PrefillKey, boolean>>;
  /** Fields a person confirmed or picked a reading on: none of them may ask again. */
  acted: Set<PrefillKey>;
  /** The read that filled the line: a Calculate press records its review against that read and no other. */
  readId: string | null;
}

/** How often each act ran over the whole file — a sequence that never reaches an act proves nothing about it. */
const ran = new Map<string, number>();

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const untouched = (l: CalcLineForm) => l.product === null && l.packageCount === "" && l.grossWeightValue === "";
const KEYS: PrefillKey[] = ["product", "packageType", "packageCount", "grossWeight", "limitedQuantity"];

async function runSequence(seed: number, fleet: boolean, steps: number): Promise<void> {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const w: VueWrapper = mount(HazmatCalculatorForm, { props: { bolRead: null, fleet }, global: { plugins: [VueQueryPlugin] } });
  await flushPromises();
  const productLines = () => w.findComponent(HazmatProductLines);
  const formLines = () => productLines().props("lines") as CalcLineForm[];
  const viewOf = (l: CalcLineForm) => (productLines().props("bolView") as (l: CalcLineForm) => BolLineView | null)(l);
  const typed = (l: CalcLineForm): Expected => ({ line: toRaw(l), fromRead: false, values: {}, filled: {}, pending: {}, acted: new Set(), readId: null });
  const filled = (l: CalcLineForm, readId: string): Expected => {
    const view = viewOf(l)!;
    const values = Object.fromEntries(KEYS.map((k) => [k, FORM_VALUE[k](l)]));
    return { line: toRaw(l), fromRead: true, values, filled: { ...values }, pending: Object.fromEntries(KEYS.map((k) => [k, view.fields[k].pending === true])), acted: new Set(), readId };
  };
  let model: Expected[] = formLines().map(typed);
  const log: string[] = [];
  let reads = 0;
  const did = (what: string) => { log.push(what); const kind = what.split(" ")[0]!; ran.set(kind, (ran.get(kind) ?? 0) + 1); };

  const check = () => {
    const at = `seed ${seed}${fleet ? " (fleet)" : ""} after: ${log.join(" → ")}`;
    const lines = formLines();
    expect(lines.map((l) => toRaw(l)), at).toEqual(model.map((m) => m.line));
    lines.forEach((l, i) => {
      const e = model[i]!;
      for (const [k, v] of Object.entries(e.values)) expect(FORM_VALUE[k as PrefillKey](l), `${at} — line ${i + 1}, ${k}`).toEqual(v);
      if (!e.fromRead) return;
      const view = viewOf(l);
      expect(view, `${at} — line ${i + 1} lost the account of where its values came from`).not.toBeNull();
      for (const k of KEYS) {
        const pending = view!.fields[k].pending === true;
        if (e.acted.has(k)) expect(pending, `${at} — line ${i + 1}, ${k} asks again after the person acted on it`).toBe(false);
        else if (FORM_VALUE[k](l) === e.filled[k]) expect(pending, `${at} — line ${i + 1}, ${k} stopped or started waiting with no act`).toBe(e.pending[k]);
      }
    });
  };
  const equipmentPicker = () =>
    w.findAllComponents({ name: "AppCombobox" }).find((c) => (c.props("options") as { value: string }[]).some((o) => o.value === "van"));

  /** Press Calculate when it is enabled: any review it posts goes to the read whose lines are on the form. */
  async function calculate() {
    if (w.find("button[type='submit']").attributes("disabled") !== undefined) return;
    did("calculate");
    api.reviews = [];
    await w.find("form").trigger("submit");
    await flushPromises();
    const from = [...new Set(model.filter((e) => e.fromRead).map((e) => e.readId))];
    expect(from.length, `seed ${seed}: the form holds lines of one read at most`).toBeLessThanOrEqual(1);
    for (const url of api.reviews) expect(url, `seed ${seed} after: ${log.join(" → ")}`).toBe(`/api/documents/reads/${from[0]}/reviews`);
  }

  for (let step = 0; step < steps; step++) {
    const lines = formLines();
    const i = Math.floor(r() * lines.length);
    const line = lines[i]!;
    const m = model[i]!;
    const roll = r();
    if (roll < 0.14) {
      const spec = pick(READS);
      api.fail = spec.fails === true;
      did(`read#${READS.indexOf(spec)}`);
      const made = { ...spec.make(), id: `00000000-0000-4000-8000-${String(++reads).padStart(12, "0")}` };
      await w.setProps({ bolRead: made });
      await flushPromises();
      if (!spec.fails) {
        const kept = model.filter((e) => !e.fromRead && !untouched(e.line as CalcLineForm));
        const now = formLines();
        const added = now.slice(kept.length).map((l) => (spec.lines > 0 ? filled(l, made.id) : typed(l)));
        expect(added, `seed ${seed}: read ${READS.indexOf(spec)} added ${added.length} lines`).toHaveLength(spec.lines || (kept.length ? 0 : 1));
        model = [...kept, ...added];
      }
    } else if (roll < 0.24) {
      const picker = equipmentPicker();
      if (!picker) continue;
      const value = pick(EQUIPMENT_OPTIONS).value;
      did(`equipment ${value}`);
      picker.vm.$emit("update:modelValue", value);
    } else if (roll < 0.3 && fleet) {
      const trailer = w.findAllComponents({ name: "AppCombobox" }).find((c) => c.props("placeholder") === "Search trailers…");
      if (trailer) {
        const id = pick(["", ...TRAILERS.map((t) => t.id)]);
        did(`trailer ${id || "none"}`);
        trailer.vm.$emit("update:modelValue", id);
      } else {
        did("tab fleet");
        w.findComponent({ name: "AppTabs" }).vm.$emit("update:modelValue", "fleet");
      }
    } else if (roll < 0.33 && fleet) {
      did("tab manual");
      w.findComponent({ name: "AppTabs" }).vm.$emit("update:modelValue", "manual");
    } else if (roll < 0.4) {
      did("add");
      productLines().vm.$emit("addLine");
      await flushPromises();
      const added = formLines().at(-1)!;
      model.push(typed(added));
    } else if (roll < 0.46) {
      if (lines.length < 2) continue; // the Remove button shows only beside two or more lines
      did(`remove ${i + 1}`);
      productLines().vm.$emit("removeLine", i);
      model.splice(i, 1);
    } else if (roll < 0.58) {
      const key = pick(["packageCount", "grossWeight"] as const);
      const v = String(1 + Math.floor(r() * 5000));
      did(`type ${key} ${v} on ${i + 1}`);
      if (key === "packageCount") line.packageCount = v;
      else line.grossWeightValue = v;
      m.values[key] = FORM_VALUE[key](line);
    } else if (roll < 0.63) {
      if (!m.fromRead) continue;
      did(`package type on ${i + 1}`);
      line.packageType = pick(["drum", "tote", "box", "cylinder"]);
      m.values.packageType = line.packageType;
    } else if (roll < 0.67) {
      if (!m.fromRead) continue;
      did(`LQ on ${i + 1}`);
      line.isLimitedQuantity = !line.isLimitedQuantity;
      m.values.limitedQuantity = line.isLimitedQuantity;
    } else if (roll < 0.73) {
      const product = r() < 0.4 ? null : pick(PRODUCTS);
      did(`${product ? "product" : "clear"} ${product?.hmtRef ?? ""} on ${i + 1}`);
      if (product) productLines().vm.$emit("selectProduct", i, product);
      else productLines().vm.$emit("clearProduct", i);
      m.values.product = product?.hmtRef ?? null;
    } else if (roll < 0.85) {
      const view = viewOf(line);
      const choosable = view ? KEYS.filter((k) => view.fields[k].choices?.length) : [];
      if (!choosable.length) continue;
      const key = pick(choosable);
      const value = pick(view!.fields[key].choices!);
      did(`choose ${key} ${value} on ${i + 1}`);
      productLines().vm.$emit("chooseReading", i, key, value);
      m.values[key] = key === "packageCount" ? String(value) : `${value} lb`;
      m.acted.add(key);
    } else if (roll < 0.94) {
      const view = viewOf(line);
      const confirmable = view ? KEYS.filter((k) => view.fields[k].confirmable) : [];
      if (!confirmable.length) continue;
      const key = pick(confirmable);
      did(`confirm ${key} on ${i + 1}`);
      productLines().vm.$emit("confirmField", i, key);
      m.acted.add(key);
    } else if (roll < 0.95) {
      // A person working down the list: every field still waiting gets its reading picked, its confirm, or a product.
      did("settle");
      for (const [j, l] of formLines().entries()) {
        const view = viewOf(l);
        if (!view) continue;
        for (const k of KEYS) {
          const f = view.fields[k];
          if (!f.pending) continue;
          if (f.choices?.length) {
            productLines().vm.$emit("chooseReading", j, k, f.choices[0]!);
            model[j]!.values[k] = k === "packageCount" ? String(f.choices[0]) : `${f.choices[0]} lb`;
          } else if (f.confirmable) productLines().vm.$emit("confirmField", j, k);
          else if (k === "product") {
            productLines().vm.$emit("selectProduct", j, PRODUCTS[0]!);
            model[j]!.values.product = PRODUCTS[0]!.hmtRef;
            continue;
          } else continue;
          model[j]!.acted.add(k);
        }
      }
      // …and answers what Calculate still needs: the equipment, and a product on some line.
      if (fleet) w.findComponent({ name: "AppTabs" }).vm.$emit("update:modelValue", "manual");
      await flushPromises();
      if (equipmentPicker()?.props("modelValue") === "") equipmentPicker()!.vm.$emit("update:modelValue", "van");
      if (!formLines().some((l) => l.product)) {
        productLines().vm.$emit("selectProduct", 0, PRODUCTS[1]!);
        model[0]!.values.product = PRODUCTS[1]!.hmtRef;
      }
      await flushPromises();
      if (r() < 0.7) await calculate();
    } else if (roll < 0.98) {
      await calculate();
    } else {
      did("reset");
      await w.findAll("button").find((b) => b.text() === "Reset")!.trigger("click");
      await flushPromises();
      model = formLines().map(typed);
      expect(model, `seed ${seed}: Reset leaves one empty line`).toHaveLength(1);
    }
    await flushPromises();
    check();
  }
  w.unmount();
}

describe("HazmatCalculatorForm — a read's value changes only by a person's act (RC4)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    api.fail = false;
  });

  for (const fleet of [false, true]) {
    for (let batch = 0; batch < 4; batch++) {
      it(`holds over 40 seeded sequences of 14 acts${fleet ? " on the fleet calculator" : ""} (batch ${batch + 1})`, async () => {
        for (let k = 0; k < 40; k++) {
          setActivePinia(createPinia());
          api.fail = false;
          await runSequence(1000 * batch + k + (fleet ? 500_000 : 0), fleet, 14);
        }
      }, 60_000);
    }
  }

  it("reached every act, every read, and the acts that settle a disputed field, many times over", () => {
    const kinds = ["settle", "calculate", "equipment", "trailer", "tab", "add", "remove", "type", "package", "LQ", "product", "clear", "choose", "confirm", "reset", ...READS.map((_, k) => `read#${k}`)];
    for (const kind of kinds) expect(ran.get(kind) ?? 0, kind).toBeGreaterThanOrEqual(20);
  });
});
