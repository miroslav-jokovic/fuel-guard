import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

/**
 * The requests these hooks build (INVENTORY-PLAN.md I4).
 *
 * Two things are worth a test here and neither is vue-query's plumbing.
 *
 * **The body is an OBJECT.** `apiFetch` serialises it, and a pre-serialised one is not a type error
 * in a template — it is a 500: `express.json()` runs strict, rejects a top-level JSON string, and
 * body-parser's error surfaces as "Unexpected server error" on a request that never reached its
 * handler. That shipped twice already, in `useAnnualInspections` and `useDispositions`.
 *
 * **`/low-stock` asks for the whole list.** The endpoint takes no `limit` and no `offset` on
 * purpose: a list of what to order that stops at a page says "nothing more to order" and is
 * believed. That defect shipped once, as a flag on `listStock`, and the 2026-09-09 review removed
 * it — adding a page size on this side would put it straight back one layer up.
 */

const apiFetch = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, status: 200, data: { part: { id: "p1" }, lines: [], total: 0 } })),
);
vi.mock("@/lib/api", () => ({ apiFetch, fetchObjectUrl: vi.fn() }));
vi.mock("@tanstack/vue-query", () => ({
  useQuery: (opts: { queryFn: () => Promise<unknown> }) => ({ queryFn: opts.queryFn }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  keepPreviousData: undefined,
  // Hand back the mutationFn so the test can invoke it directly — what is under test is the request
  // it builds.
  useMutation: (opts: { mutationFn: (v: unknown) => Promise<unknown> }) => ({
    mutateAsync: opts.mutationFn,
    isPending: { value: false },
  }),
}));

const {
  useCloseCountSession,
  useCreateLocation,
  useCreatePart,
  useLocationsQuery,
  useLowStockQuery,
  useMovementsQuery,
  usePartsQuery,
  useOpenCountSession,
  useRecordMovement,
  useUpdateStockLine,
} = await import("./useInventory");

/** The mocked `useQuery` hands the query function straight back. */
const runQuery = (q: { queryFn: () => Promise<unknown> }) => q.queryFn();
const lastPath = () => (apiFetch.mock.calls[0] as unknown as [string])[0];

describe("the low-stock request", () => {
  it("asks for the whole list — no limit, no offset", async () => {
    apiFetch.mockClear();
    await runQuery(useLowStockQuery() as never);
    expect(lastPath()).toBe("/api/maintenance/inventory/low-stock");
    expect(lastPath()).not.toContain("limit");
    expect(lastPath()).not.toContain("offset");
  });
});

describe("the paginated reads", () => {
  it("pages the catalogue by fifty and passes the search through", async () => {
    apiFetch.mockClear();
    await runQuery(usePartsQuery(ref({ search: "filter", page: 3 })) as never);
    const url = new URL(lastPath(), "https://example.test");
    expect(url.pathname).toBe("/api/maintenance/inventory/parts");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("offset")).toBe("100");
    expect(url.searchParams.get("search")).toBe("filter");
  });

  it("scopes the ledger to one part, and to a start instant when it is given one", async () => {
    apiFetch.mockClear();
    await runQuery(useMovementsQuery(ref({ partId: "p1", since: "2026-09-09T05:00:00.000Z", page: 1 })) as never);
    const url = new URL(lastPath(), "https://example.test");
    expect(url.pathname).toBe("/api/maintenance/inventory/movements");
    expect(url.searchParams.get("partId")).toBe("p1");
    expect(url.searchParams.get("since")).toBe("2026-09-09T05:00:00.000Z");
    expect(url.searchParams.get("offset")).toBe("0");
  });
});

/**
 * A picker offers OPEN locations; the ledger has to name closed ones too.
 *
 * `record_part_movement` refuses a movement into an inactive location (`IV012`), so a picker that
 * offered one would be building an error the form could have prevented. But a movement made into a
 * bay that has since closed still happened, and resolving its name from an active-only list renders
 * it as "—" — which erases exactly the evidence the ledger exists for.
 */
describe("the locations request", () => {
  it("asks for active locations by default", async () => {
    apiFetch.mockClear();
    await runQuery(useLocationsQuery() as never);
    expect(lastPath()).toBe("/api/maintenance/inventory/locations");
  });

  it("asks for the closed ones too when told to", async () => {
    apiFetch.mockClear();
    await runQuery(useLocationsQuery(true) as never);
    expect(lastPath()).toBe("/api/maintenance/inventory/locations?includeInactive=true");
  });
});

/**
 * The five desk verbs are five routes, and the reason is the path — not a field in the body.
 * `partMovementInputSchema` is a discriminated union so a screen built for receiving cannot post
 * `reason: "adjusted"`; the hook must send each reason to its own endpoint or the API's whole
 * five-route shape does nothing.
 */
describe("the movement verbs", () => {
  const base = { id: "m-1", partId: "p1", locationId: "l1", occurredAt: "2026-09-09T10:00:00.000Z", note: null };

  it("posts each reason to its own route", async () => {
    const cases: Array<[string, string]> = [
      ["received", "receive"],
      ["issued", "issue"],
      ["adjusted", "adjust"],
      ["transferred", "transfer"],
      ["returned", "return"],
      ["counted", "count"],
    ];
    for (const [reason, path] of cases) {
      apiFetch.mockClear();
      await useRecordMovement().mutateAsync({ ...base, reason } as never);
      expect(lastPath()).toBe(`/api/maintenance/inventory/${path}`);
    }
  });

  /**
   * ⚠ D-INV27, at the layer where it is easiest to break. The id is the idempotency key, so the hook
   * must send the one it was GIVEN — a hook that generated its own would mint one per attempt, every
   * retry would become a second movement, and the shelf would drift by exactly the number of times
   * the network was bad. Nothing else in the stack would notice.
   */
  it("sends the id it was given and never invents one", async () => {
    apiFetch.mockClear();
    await useRecordMovement().mutateAsync({ ...base, id: "the-one-id", reason: "received", quantity: 3 } as never);
    const [, options] = apiFetch.mock.calls[0] as unknown as [string, { body: { id: string } }];
    expect(options.body.id).toBe("the-one-id");
  });

  it("sends the same id twice when the same movement is retried", async () => {
    apiFetch.mockClear();
    const hook = useRecordMovement();
    const input = { ...base, id: "retry-me", reason: "received", quantity: 3 } as never;
    await hook.mutateAsync(input);
    await hook.mutateAsync(input);
    const ids = apiFetch.mock.calls.map((c) => (c as unknown as [string, { body: { id: string } }])[1].body.id);
    expect(ids).toEqual(["retry-me", "retry-me"]);
  });
});

describe("count sessions", () => {
  it("opens a walk without sending an id — the server mints that one", async () => {
    apiFetch.mockClear();
    await useOpenCountSession().mutateAsync({ kind: "location", locationId: "l1", blind: true } as never);
    const [path, options] = apiFetch.mock.calls[0] as unknown as [string, { method: string; body: object }];
    expect(path).toBe("/api/maintenance/inventory/count-sessions");
    expect(options.method).toBe("POST");
    // The opposite of a movement, and deliberately: two taps of Start must not make two walks.
    expect(Object.keys(options.body)).not.toContain("id");
  });

  it("closes a walk through the named verb, not a general PATCH", async () => {
    apiFetch.mockClear();
    await useCloseCountSession().mutateAsync({ id: "s-1" } as never);
    const [path, options] = apiFetch.mock.calls[0] as unknown as [string, { method: string }];
    expect(path).toBe("/api/maintenance/inventory/count-sessions/s-1/close");
    expect(options.method).toBe("POST");
  });
});

describe("the writes", () => {
  it("hands apiFetch an object, never a pre-serialised string", async () => {
    apiFetch.mockClear();
    await useCreatePart().mutateAsync({ partNumber: "P-1", description: "Oil filter" } as never);
    const [path, options] = apiFetch.mock.calls[0] as unknown as [string, { method: string; body: unknown }];
    expect(path).toBe("/api/maintenance/inventory/parts");
    expect(options.method).toBe("POST");
    expect(typeof options.body).toBe("object");
    expect(typeof options.body).not.toBe("string");
  });

  /**
   * ⚠ The write no step in the plan owned. Production held zero rows in all four inventory tables on
   * 2026-09-09 and nothing in the product could create a stock location — so this endpoint, shipped
   * at I3, had no caller and I5's receive drawer would have had nowhere to receive into.
   */
  it("can create a stock location, which is what makes every shelf picker non-empty", async () => {
    apiFetch.mockClear();
    await useCreateLocation().mutateAsync({ name: "Main shop", code: "MAIN", address: null } as never);
    const [path, options] = apiFetch.mock.calls[0] as unknown as [string, { method: string; body: object }];
    expect(path).toBe("/api/maintenance/inventory/locations");
    expect(options.method).toBe("POST");
    expect(options.body).toEqual({ name: "Main shop", code: "MAIN", address: null });
  });

  /**
   * A stock line has no surrogate id — it IS the (part, location) pair — so it is addressed by both,
   * and the QUANTITY is absent from the body. `record_part_movement` is the only writer of on-hand
   * (D-INV4); a settings call that could carry a total would be a second writer of the projection.
   */
  it("addresses a stock line by its natural key and sends no quantity", async () => {
    apiFetch.mockClear();
    await useUpdateStockLine().mutateAsync({
      partId: "p1",
      locationId: "l1",
      settings: { reorderPoint: 3, reorderQuantity: 12, active: true },
    } as never);
    const [path, options] = apiFetch.mock.calls[0] as unknown as [string, { method: string; body: object }];
    expect(path).toBe("/api/maintenance/inventory/stock/p1/l1");
    expect(options.method).toBe("PATCH");
    expect(Object.keys(options.body)).not.toContain("quantityOnHand");
    expect(options.body).toEqual({ reorderPoint: 3, reorderQuantity: 12, active: true });
  });
});
