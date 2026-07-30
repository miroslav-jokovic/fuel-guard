import { describe, expect, it, vi } from "vitest";
import {
  FrClient,
  FrApiError,
  buildDocumentQuery,
  type FrAgency,
  type FrDocumentsResponse,
  type FrDocument,
} from "./fedRegisterClient.js";

// A real PHMSA HMR final rule, trimmed — shape verified against the live API (2026-07).
const DOC_2026_10962: FrDocument = {
  document_number: "2026-10962",
  title: "Hazardous Materials: Streamlining Requirements for the Approval of Certain Energetic Materials",
  type: "Rule",
  action: "Final rule.",
  citation: "91 FR 32889",
  publication_date: "2026-06-02",
  effective_on: "2026-07-02",
  cfr_references: [
    { title: 49, part: "171", chapter: null, citation_url: null },
    { title: 49, part: "172", chapter: null, citation_url: null },
    { title: 49, part: "173", chapter: null, citation_url: null },
  ],
  regulation_id_numbers: ["2137-AF50"],
  docket_ids: ["Docket No. PHMSA-2020-0103 (HM-257A)"],
  html_url: "https://www.federalregister.gov/documents/2026/06/02/2026-10962/...",
  pdf_url: "https://www.govinfo.gov/content/pkg/FR-2026-06-02/pdf/2026-10962.pdf",
};

const PHMSA_AGENCY: FrAgency = {
  id: 408,
  name: "Pipeline and Hazardous Materials Safety Administration",
  short_name: "PHMSA",
  slug: "pipeline-and-hazardous-materials-safety-administration",
  url: "https://www.federalregister.gov/agencies/pipeline-and-hazardous-materials-safety-administration",
  parent_id: 492,
};

function makeFetch(routes: Array<{ match: string; status?: number; json: unknown }>) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const route = routes.find((r) => url.includes(r.match));
    if (!route) return new Response("nf", { status: 404 });
    return new Response(JSON.stringify(route.json), { status: route.status ?? 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}
const base = { sleep: () => Promise.resolve() };

describe("buildDocumentQuery", () => {
  it("emits conditions[...] and fields[] correctly", () => {
    const q = buildDocumentQuery({
      agencyIds: [408],
      types: ["RULE", "PRORULE"],
      cfrTitle: 49,
      cfrPart: "172",
      publicationDateGte: "2026-01-01",
      fields: ["effective_on", "cfr_references"],
      perPage: 100,
      order: "newest",
    });
    expect(q.getAll("conditions[agency_ids][]")).toEqual(["408"]);
    expect(q.getAll("conditions[type][]")).toEqual(["RULE", "PRORULE"]);
    expect(q.get("conditions[cfr][title]")).toBe("49");
    expect(q.get("conditions[cfr][part]")).toBe("172");
    expect(q.get("conditions[publication_date][gte]")).toBe("2026-01-01");
    expect(q.getAll("fields[]")).toEqual(["effective_on", "cfr_references"]);
    expect(q.get("per_page")).toBe("100");
    expect(q.get("order")).toBe("newest");
  });
});

describe("FrClient — endpoints", () => {
  it("getAgency builds the slug path", async () => {
    const { impl, calls } = makeFetch([{ match: "/agencies/pipeline", json: PHMSA_AGENCY }]);
    const c = new FrClient({ ...base, fetchImpl: impl });
    const a = await c.getAgency("pipeline-and-hazardous-materials-safety-administration");
    expect(a.id).toBe(408);
    expect(calls[0]).toBe(
      "https://www.federalregister.gov/api/v1/agencies/pipeline-and-hazardous-materials-safety-administration.json",
    );
  });

  it("searchDocuments encodes conditions into the query", async () => {
    const resp: FrDocumentsResponse = { count: 1, total_pages: 1, next_page_url: null, results: [DOC_2026_10962] };
    const { impl, calls } = makeFetch([{ match: "/documents.json", json: resp }]);
    const c = new FrClient({ ...base, fetchImpl: impl });
    const res = await c.searchDocuments({ agencyIds: [408], types: ["RULE"], cfrTitle: 49, order: "newest" });
    expect(res.results[0]!.document_number).toBe("2026-10962");
    const u = new URL(calls[0]!);
    expect(u.pathname).toBe("/api/v1/documents.json");
    expect(u.searchParams.getAll("conditions[agency_ids][]")).toEqual(["408"]);
    expect(u.searchParams.getAll("conditions[type][]")).toEqual(["RULE"]);
    expect(u.searchParams.get("conditions[cfr][title]")).toBe("49");
  });

  it("getDocument fetches a single doc with requested fields", async () => {
    const { impl, calls } = makeFetch([{ match: "/documents/2026-10962.json", json: DOC_2026_10962 }]);
    const c = new FrClient({ ...base, fetchImpl: impl });
    const d = await c.getDocument("2026-10962", ["effective_on", "cfr_references"]);
    expect(d.effective_on).toBe("2026-07-02");
    const u = new URL(calls[0]!);
    expect(u.pathname).toBe("/api/v1/documents/2026-10962.json");
    expect(u.searchParams.getAll("fields[]")).toEqual(["effective_on", "cfr_references"]);
  });

  it("searchAllDocuments follows next_page_url", async () => {
    const page2Url = "https://www.federalregister.gov/api/v1/documents.json?page=2";
    const page1: FrDocumentsResponse = { count: 2, total_pages: 2, next_page_url: page2Url, results: [DOC_2026_10962] };
    const page2: FrDocumentsResponse = { count: 2, total_pages: 2, next_page_url: null, results: [{ ...DOC_2026_10962, document_number: "2026-00002" }] };
    const impl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes("page=2") ? page2 : page1), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new FrClient({ ...base, fetchImpl: impl });
    const all = await c.searchAllDocuments({ agencyIds: [408] }, 5);
    expect(all.map((d) => d.document_number)).toEqual(["2026-10962", "2026-00002"]);
  });
});

describe("FrClient — retry & errors", () => {
  it("retries a 500 then succeeds", async () => {
    let n = 0;
    const impl = vi.fn(async () => {
      n += 1;
      return n === 1 ? new Response("boom", { status: 500 }) : new Response(JSON.stringify([PHMSA_AGENCY]), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new FrClient({ ...base, fetchImpl: impl });
    const agencies = await c.getAgencies();
    expect(agencies).toHaveLength(1);
    expect(n).toBe(2);
  });

  it("throws FrApiError on a 404 without retry", async () => {
    const impl = vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    const c = new FrClient({ ...base, fetchImpl: impl });
    await expect(c.getDocument("does-not-exist")).rejects.toBeInstanceOf(FrApiError);
    expect(impl).toHaveBeenCalledTimes(1);
  });
});
