import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { bolLineView, bolPrefill } from "./bolPrefill";
import { PAINT, PAINT_REF, ok, PRODUCTS, read } from "./bolPrefill.fixtures";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, status: 201, data: {} })) }));
const { useBolReviews } = await import("./useBolReviews");

/**
 * A person's acts must stay acted on (owner, 2026-10-19: "when I click this button it does something, but the
 * button appears again and won't let me go further"). Every act — on any field of any line, in any order —
 * keeps every earlier one.
 */
describe("useBolReviews keeps every act", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("a second, third and fourth act leave every earlier field settled", () => {
    const p = bolPrefill(read([
      { a: { ...PAINT, packageCount: 9 }, b: PAINT, table: ok(PAINT_REF) },
      { a: { ...PAINT, grossWeightLb: 999 }, b: PAINT, table: ok(PAINT_REF) },
    ]), PRODUCTS, "van")!;
    const [one, two] = p.lines as [typeof p.lines[0], typeof p.lines[0]];
    const reviews = useBolReviews();
    const pending = (l: typeof one) => Object.entries(bolLineView(l, l.form, reviews.acted.value).fields).filter(([, f]) => f.pending).map(([k]) => k).sort();
    expect(pending(one)).toContain("packageCount");
    expect(pending(two)).toContain("grossWeight");
    const order: Array<[typeof one, "product" | "packageType" | "packageCount" | "grossWeight" | "limitedQuantity"]> = [];
    for (const l of [one, two]) for (const k of pending(l) as typeof order[number][1][]) order.push([l, k]);
    for (const [l, k] of order) reviews.act(l, k);
    expect(pending(one)).toEqual([]);
    expect(pending(two)).toEqual([]);
  });
});
