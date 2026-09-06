import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { defineComponent, ref } from "vue";

/**
 * The ledger's request, as a URL (FUEL-P3, A3).
 *
 * ── WHY THIS SUITE EXISTS ───────────────────────────────────────────────────────────────────────
 * `qs()` is the one place the page's filters become a request, and it is exactly where A3's defect
 * lived: `?trucks=` was written by the filter bar, preserved in the URL, and never sent — because
 * `ExceptionQuery` had no vehicle field and this builder had no line for one. A page-level test cannot
 * catch that, because a page test stubs this module; the mutation that deleted the truck line from
 * `qs()` passed every assertion in `FuelExceptionsPage.test.ts`, which is how it was found.
 *
 * The second property is `exceptionExportQuery`: the export's parameters ARE the list's, minus paging.
 * A file assembled from a second encoding is a file that covers a different set than the screen it was
 * taken from, and nothing on either would say so.
 */

const seen = { paths: [] as string[] };
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    seen.paths.push(path);
    return { ok: true, data: { ok: true, exceptions: [], total: 0, totals: {} } };
  }),
}));

import { useExceptionsQuery, useExceptionTotalsQuery, exceptionExportQuery, type ExceptionQuery } from "./useExceptions";

const QUERY: ExceptionQuery = {
  status: ["open", "disputed"],
  kind: ["recon_amount"],
  vehicleIds: ["v-701", "v-702"],
  assignedTo: "u-9",
  from: "2026-08-01",
  to: "2026-08-31",
  page: 2,
  pageSize: 25,
};

/** Mount a host that runs the composable, and hand back the path it asked for. */
async function pathFor(run: () => unknown): Promise<string> {
  const Host = defineComponent({
    setup() {
      run();
      return () => null;
    },
  });
  const host = mount(Host, { global: { plugins: [VueQueryPlugin] } });
  await flushPromises();
  await flushPromises();
  host.unmount();
  return seen.paths.at(-1) ?? "";
}

beforeEach(() => {
  seen.paths = [];
});

describe("the list asks for everything the screen is filtered to", () => {
  it("sends the trucks, the owner, the statuses, the kinds and the window", async () => {
    const path = await pathFor(() => useExceptionsQuery(ref(QUERY)));
    expect(path).toContain("vehicles=v-701%2Cv-702");
    expect(path).toContain("assignedTo=u-9");
    expect(path).toContain("status=open%2Cdisputed");
    expect(path).toContain("kind=recon_amount");
    expect(path).toContain("from=2026-08-01");
    expect(path).toContain("to=2026-08-31");
  });

  it("asks for the page it is on", async () => {
    const path = await pathFor(() => useExceptionsQuery(ref(QUERY)));
    expect(path).toContain("limit=25");
    expect(path).toContain("offset=25");
  });

  it("leaves an unset filter out rather than sending it empty", async () => {
    const path = await pathFor(() =>
      useExceptionsQuery(ref({ ...QUERY, vehicleIds: [], assignedTo: null, kind: [] })),
    );
    expect(path).not.toContain("vehicles=");
    expect(path).not.toContain("assignedTo=");
    expect(path).not.toContain("kind=");
  });
});

describe("the tiles ask for the same scope as the rows", () => {
  it("sends the trucks and the owner to the totals as well", async () => {
    const path = await pathFor(() =>
      useExceptionTotalsQuery(ref({ from: "2026-08-01", to: "2026-08-31", vehicleIds: ["v-701"], assignedTo: "u-9" })),
    );
    expect(path).toContain("/exceptions/totals?");
    expect(path).toContain("vehicles=v-701");
    expect(path).toContain("assignedTo=u-9");
  });
});

describe("the export's parameters are the list's", () => {
  it("carries every filter and drops only the paging", () => {
    const q = exceptionExportQuery(QUERY);
    expect(q).toContain("vehicles=v-701%2Cv-702");
    expect(q).toContain("status=open%2Cdisputed");
    expect(q).toContain("assignedTo=u-9");
    expect(q).toContain("from=2026-08-01");
    expect(q).not.toContain("limit=");
    expect(q).not.toContain("offset=");
  });
});
