import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

/**
 * The finance hooks send every window half-open (Q-AI10, 2026-11-10). The page holds the period as
 * inclusive days ("Jul 1 to Jul 31", `lib/reportPeriod.ts`), and every `/api/accounting/*` window reads
 * `.gte(from).lt(to)`, so the query layer sends the day after the last day, through `exclusiveEnd`,
 * once. From 2026-09-04 (7bb6159 deleted `useCpm`, the hook that did) until this fix, these four
 * sent the last day itself, and the Trucks tab, the contractor split and the Activity tab lost it.
 */
const apiFetch = vi.fn();
vi.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
const queries: Array<{ queryFn: () => Promise<unknown> }> = [];
vi.mock("@tanstack/vue-query", () => ({
  useQuery: (o: { queryFn: () => Promise<unknown> }) => {
    queries.push(o);
    return {};
  },
}));

const { useFleetReportQuery } = await import("./useFleetReport");
const { useIncomeStatementQuery } = await import("./useIncomeStatement");
const { useMileageCoverageQuery } = await import("./useMileageCoverage");
const { useBillingActivityQuery } = await import("./useBillingActivity");

const JULY = { from: "2026-07-01", to: "2026-07-31" };

beforeEach(() => {
  queries.length = 0;
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, data: {} });
});

async function urlOf(build: () => void): Promise<URL> {
  build();
  await queries[0]!.queryFn();
  return new URL(String(apiFetch.mock.calls[0]![0]), "http://x");
}

describe("finance hooks send July as 07-01 to 08-01", () => {
  it.each([
    ["fleet report", () => useFleetReportQuery(ref(JULY))],
    ["income statement", () => useIncomeStatementQuery(ref({ ...JULY, compare: "ytd" as const }))],
    ["mileage coverage", () => useMileageCoverageQuery(ref(JULY))],
    ["billing activity", () => useBillingActivityQuery(ref(JULY), ref("week" as const))],
  ])("%s", async (_name, build) => {
    const url = await urlOf(build);
    expect(url.searchParams.get("from")).toBe("2026-07-01");
    expect(url.searchParams.get("to")).toBe("2026-08-01");
  });

  it("crosses a year: December ends at the next January 1st", async () => {
    const url = await urlOf(() => useFleetReportQuery(ref({ from: "2026-12-01", to: "2026-12-31" })));
    expect(url.searchParams.get("to")).toBe("2027-01-01");
  });
});
