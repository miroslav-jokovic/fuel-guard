import { describe, expect, it, vi } from "vitest";
import { ref, unref } from "vue";

/**
 * R2 (DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md §5). vue-query runs a query again only when its key
 * changes, so the scan counter has to BE in the key — a second scan of the same label otherwise sets
 * `code` to the value it already holds, and the screen keeps the quantity from before. Asserted on
 * the key itself, because the page test mocks this hook and cannot see what the key is made of.
 */

const captured = vi.hoisted(() => ({ key: null as unknown[] | null }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("@tanstack/vue-query", () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    captured.key = opts.queryKey;
    return {};
  },
}));

const { useScanQuery } = await import("./useScan");

describe("useScanQuery", () => {
  it("keys every scan, so the same label scanned twice is a new key", () => {
    const code = ref("SIL1:BIN:7K3M9P");
    const seq = ref(1);
    useScanQuery(code, seq);

    const first = captured.key!.map(unref);
    seq.value += 1;
    const second = captured.key!.map(unref);

    expect(second).not.toEqual(first);
    expect(second.slice(0, 3)).toEqual(first.slice(0, 3));
  });
});
