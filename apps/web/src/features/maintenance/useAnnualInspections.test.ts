import { describe, expect, it, vi } from "vitest";

/**
 * The request bodies these hooks send.
 *
 * ── WHY A TEST ABOUT A BODY SHAPE EXISTS AT ALL (2026-09-01) ───────────────────────────────────
 * `apiFetch` serialises the body itself. The delete hook shipped passing `JSON.stringify({ reason })`
 * — so the body was encoded TWICE, `express.json()` (strict) rejected a top-level JSON string, and
 * body-parser's error surfaced to the office as **"Unexpected server error"** on a request that
 * never reached its handler. Nothing was deleted, no audit row was written, and every layer below
 * was innocent and provably working.
 *
 * `apiFetch`'s `body` is now typed `object | null`, so the same mistake is a compile error rather
 * than a 500 — this test is the belt to that braces, and the reason the failure is named here is
 * that the identical bug was already sitting in `useDispositions` where nothing had tripped it yet.
 */

const apiFetch = vi.hoisted(() => vi.fn(async () => ({ ok: true, status: 200, data: { id: "x", itemsDeleted: 0 } })));
vi.mock("@/lib/api", () => ({ apiFetch, fetchObjectUrl: vi.fn() }));
vi.mock("@tanstack/vue-query", () => ({
  useQuery: () => ({}),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), removeQueries: vi.fn() }),
  keepPreviousData: undefined,
  // Hand back the mutationFn so the test can invoke it directly — what is under test is the request
  // it builds, not vue-query's plumbing.
  useMutation: (opts: { mutationFn: (v: unknown) => Promise<unknown> }) => ({
    mutateAsync: opts.mutationFn,
    isPending: { value: false },
  }),
}));

const { useDeleteInspectionRecord } = await import("./useAnnualInspections");

describe("the delete request body", () => {
  it("passes an OBJECT, because apiFetch is what serialises it", async () => {
    apiFetch.mockClear();
    await useDeleteInspectionRecord().mutateAsync({ id: "insp-1", reason: "wrong unit" } as never);
    const [path, options] = apiFetch.mock.calls[0] as unknown as [string, { method: string; body: unknown }];
    expect(path).toBe("/api/maintenance/inspections/insp-1/delete-record");
    expect(options.method).toBe("POST");
    expect(typeof options.body).toBe("object");
    expect(options.body).toEqual({ reason: "wrong unit" });
  });

  it("never hands apiFetch a pre-serialised string", async () => {
    apiFetch.mockClear();
    await useDeleteInspectionRecord().mutateAsync({ id: "insp-1", reason: "wrong unit" } as never);
    const [, options] = apiFetch.mock.calls[0] as unknown as [string, { body: unknown }];
    // The exact shape that produced "Unexpected server error" in production.
    expect(typeof options.body).not.toBe("string");
  });
});
