import { describe, expect, it, vi } from "vitest";
import {
  EcfrClient,
  EcfrApiError,
  buildSubsetQuery,
  type TitlesResponse,
  type VersionsResponse,
  type EcfrHierarchyNode,
  type AncestryResponse,
  type CorrectionsResponse,
} from "./ecfrClient.js";

// ── frozen sample responses (verified field-by-field against the live API, 2026-07) ──────────────
const TITLES: TitlesResponse = {
  titles: [
    { number: 1, name: "General Provisions", latest_amended_on: "2026-01-02", latest_issue_date: "2026-01-02", up_to_date_as_of: "2026-01-05", reserved: false },
    { number: 49, name: "Transportation", latest_amended_on: "2026-07-06", latest_issue_date: "2026-07-06", up_to_date_as_of: "2026-07-13", reserved: false },
  ],
  meta: {},
};

const VERSIONS_172: VersionsResponse = {
  content_versions: [
    { date: "2024-05-10", amendment_date: "2024-05-10", issue_date: "2024-05-10", identifier: "172.101", name: "§ 172.101 …", part: "172", substantive: true, removed: false, subpart: "B", title: "49", type: "section" },
    { date: "2026-01-14", amendment_date: "2026-01-14", issue_date: "2026-02-13", identifier: "172.101", name: "§ 172.101 …", part: "172", substantive: true, removed: false, subpart: "B", title: "49", type: "section" },
    { date: "2020-03-01", amendment_date: "2020-03-01", issue_date: "2020-03-01", identifier: "172.504", name: "§ 172.504 …", part: "172", substantive: true, removed: false, subpart: "F", title: "49", type: "section" },
  ],
  meta: {},
};

const STRUCTURE: EcfrHierarchyNode = {
  identifier: "49", label: "Title 49—Transportation", label_level: "Title 49", label_description: "Transportation",
  reserved: false, type: "title", size: 32953829, children: [],
};

const ANCESTRY: AncestryResponse = {
  ancestors: [
    { identifier: "49", label: "Title 49—Transportation", label_level: "Title 49", label_description: "Transportation", reserved: false, type: "title", size: 1 },
    { identifier: "172.101", label: "§ 172.101 …", label_level: "§ 172.101", label_description: "Purpose and use of the hazardous materials table.", reserved: false, type: "section", size: 2919817 },
  ],
};

const CORRECTIONS: CorrectionsResponse = {
  ecfr_corrections: [
    { id: 61, cfr_references: [{ cfr_reference: "49 CFR 173.315", hierarchy: { title: "49", part: "173", section: "173.315" } }], corrective_action: "(i)(8) revised", error_corrected: "2005-12-08", error_occurred: "2001-06-21", fr_citation: "66 FR 33436", position: 1, display_in_toc: false, title: 49, year: 2005, last_modified: "2021-12-22" },
  ],
};

const HMT_XML = `<DIV8 N="172.101" TYPE="SECTION"><HEAD>§ 172.101 …</HEAD><GPOTABLE><ROW><ENT>Test</ENT></ROW></GPOTABLE></DIV8>`;

/** A fake fetch that records calls and routes by URL substring. */
function makeFetch(routes: Array<{ match: string; status?: number; body: string; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes.find((r) => url.includes(r.match));
    if (!route) return new Response("not found", { status: 404 });
    return new Response(route.body, { status: route.status ?? 200, headers: route.headers });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const noSleep = () => Promise.resolve();

describe("EcfrClient — URL construction & parsing", () => {
  it("getTitles + getTitleSummary(49)", async () => {
    const { impl, calls } = makeFetch([{ match: "/titles.json", body: JSON.stringify(TITLES) }]);
    const c = new EcfrClient({ fetchImpl: impl, sleep: noSleep });
    const summary = await c.getTitleSummary(49);
    expect(summary.up_to_date_as_of).toBe("2026-07-13");
    expect(calls[0]!.url).toBe("https://www.ecfr.gov/api/versioner/v1/titles.json");
    // headers set
    const headers = (calls[0]!.init!.headers ?? {}) as Record<string, string>;
    expect(headers["Accept"]).toBe("application/json");
    expect(headers["User-Agent"]).toContain("HazmatGuard");
  });

  it("getTitleSummary throws for an absent title", async () => {
    const { impl } = makeFetch([{ match: "/titles.json", body: JSON.stringify(TITLES) }]);
    const c = new EcfrClient({ fetchImpl: impl, sleep: noSleep });
    await expect(c.getTitleSummary(99)).rejects.toThrow(/Title 99 not present/);
  });

  it("getVersions builds ?part=172", async () => {
    const { impl, calls } = makeFetch([{ match: "/versions/title-49.json", body: JSON.stringify(VERSIONS_172) }]);
    const c = new EcfrClient({ fetchImpl: impl, sleep: noSleep });
    const res = await c.getVersions(49, { part: "172" });
    expect(res.content_versions).toHaveLength(3);
    expect(calls[0]!.url).toBe("https://www.ecfr.gov/api/versioner/v1/versions/title-49.json?part=172");
  });

  it("getStructure builds the dated path", async () => {
    const { impl, calls } = makeFetch([{ match: "/structure/", body: JSON.stringify(STRUCTURE) }]);
    const c = new EcfrClient({ fetchImpl: impl, sleep: noSleep });
    const node = await c.getStructure("2026-07-13", 49);
    expect(node.type).toBe("title");
    expect(calls[0]!.url).toBe("https://www.ecfr.gov/api/versioner/v1/structure/2026-07-13/title-49.json");
  });

  it("getAncestry builds the dated path + subset query", async () => {
    const { impl, calls } = makeFetch([{ match: "/ancestry/", body: JSON.stringify(ANCESTRY) }]);
    const c = new EcfrClient({ fetchImpl: impl, sleep: noSleep });
    const res = await c.getAncestry("2026-07-13", 49, { part: "172", section: "172.101" });
    expect(res.ancestors.at(-1)!.identifier).toBe("172.101");
    expect(calls[0]!.url).toBe(
      "https://www.ecfr.gov/api/versioner/v1/ancestry/2026-07-13/title-49.json?part=172&section=172.101",
    );
  });

  it("getFullXml returns raw XML (not JSON-parsed) with an XML Accept", async () => {
    const { impl, calls } = makeFetch([{ match: "/full/", body: HMT_XML }]);
    const c = new EcfrClient({ fetchImpl: impl, sleep: noSleep });
    const xml = await c.getFullXml("2026-07-13", 49, { section: "172.101" });
    expect(xml).toBe(HMT_XML);
    expect(calls[0]!.url).toBe(
      "https://www.ecfr.gov/api/versioner/v1/full/2026-07-13/title-49.xml?section=172.101",
    );
    const headers = (calls[0]!.init!.headers ?? {}) as Record<string, string>;
    expect(headers["Accept"]).toBe("application/xml");
  });

  it("getCorrectionsForTitle builds the admin path", async () => {
    const { impl, calls } = makeFetch([{ match: "/corrections/title/49.json", body: JSON.stringify(CORRECTIONS) }]);
    const c = new EcfrClient({ fetchImpl: impl, sleep: noSleep });
    const res = await c.getCorrectionsForTitle(49);
    expect(res.ecfr_corrections[0]!.fr_citation).toBe("66 FR 33436");
    expect(calls[0]!.url).toBe("https://www.ecfr.gov/api/admin/v1/corrections/title/49.json");
  });

  it("honors a custom baseUrl (test server)", async () => {
    const { impl, calls } = makeFetch([{ match: "/titles.json", body: JSON.stringify(TITLES) }]);
    const c = new EcfrClient({ fetchImpl: impl, sleep: noSleep, baseUrl: "http://localhost:9999/" });
    await c.getTitles();
    expect(calls[0]!.url).toBe("http://localhost:9999/api/versioner/v1/titles.json");
  });
});

describe("EcfrClient — retry & error handling", () => {
  it("retries a 500 then succeeds", async () => {
    let n = 0;
    const impl = vi.fn(async () => {
      n += 1;
      return n === 1 ? new Response("boom", { status: 500 }) : new Response(JSON.stringify(TITLES), { status: 200 });
    }) as unknown as typeof fetch;
    const sleep = vi.fn(noSleep);
    const c = new EcfrClient({ fetchImpl: impl, sleep });
    const res = await c.getTitles();
    expect(res.titles).toHaveLength(2);
    expect(n).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("fails fast on 404 (no retry)", async () => {
    const impl = vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    const c = new EcfrClient({ fetchImpl: impl, sleep: noSleep });
    await expect(c.getTitles()).rejects.toBeInstanceOf(EcfrApiError);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("throws EcfrApiError after exhausting retries on 503", async () => {
    const impl = vi.fn(async () => new Response("busy", { status: 503 })) as unknown as typeof fetch;
    const c = new EcfrClient({ fetchImpl: impl, sleep: noSleep, maxRetries: 2 });
    const err = await c.getTitles().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EcfrApiError);
    expect((err as EcfrApiError).status).toBe(503);
    expect(impl).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("honors Retry-After (seconds)", async () => {
    let n = 0;
    const impl = vi.fn(async () => {
      n += 1;
      return n === 1
        ? new Response("slow", { status: 429, headers: { "retry-after": "2" } })
        : new Response(JSON.stringify(TITLES), { status: 200 });
    }) as unknown as typeof fetch;
    const slept: number[] = [];
    const sleep = (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    };
    const c = new EcfrClient({ fetchImpl: impl, sleep });
    await c.getTitles();
    expect(slept).toEqual([2000]);
  });

  it("retries a network error / abort", async () => {
    let n = 0;
    const impl = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("network down");
      return new Response(JSON.stringify(TITLES), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new EcfrClient({ fetchImpl: impl, sleep: noSleep });
    const res = await c.getTitles();
    expect(res.titles).toHaveLength(2);
    expect(n).toBe(2);
  });
});

describe("buildSubsetQuery", () => {
  it("emits only defined keys, in API casing, in canonical order", () => {
    expect(buildSubsetQuery({ part: "172", section: "172.101" })).toBe("?part=172&section=172.101");
    expect(buildSubsetQuery({ subjectGroup: "ECFRxyz" })).toBe("?subject_group=ECFRxyz");
    expect(buildSubsetQuery({})).toBe("");
    expect(buildSubsetQuery({ part: "", section: "172.101" })).toBe("?section=172.101");
  });
});
