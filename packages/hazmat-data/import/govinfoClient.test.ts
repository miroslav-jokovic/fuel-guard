import { describe, expect, it, vi } from "vitest";
import {
  GovInfoClient,
  GovInfoApiError,
  redactKey,
  type CollectionsResponse,
  type PackageSummary,
  type GranulesResponse,
} from "./govinfoClient.js";

const COLLECTIONS: CollectionsResponse = {
  collections: [
    { collectionCode: "BILLS", collectionName: "Congressional Bills", packageCount: 1, granuleCount: 1 },
    { collectionCode: "CFR", collectionName: "Code of Federal Regulations", packageCount: 500, granuleCount: 900000 },
  ],
};

const PKG_SUMMARY: PackageSummary = {
  packageId: "CFR-2024-title49-vol2",
  title: "Title 49 - Transportation",
  dateIssued: "2024-10-01",
  lastModified: "2024-12-01T00:00:00Z",
  collectionCode: "CFR",
  download: {
    pdfLink: "https://api.govinfo.gov/packages/CFR-2024-title49-vol2/pdf",
    xmlLink: "https://api.govinfo.gov/packages/CFR-2024-title49-vol2/xml",
    modsLink: "https://api.govinfo.gov/packages/CFR-2024-title49-vol2/mods",
  },
};

const GRANULES: GranulesResponse = {
  count: 2,
  nextPage: null,
  granules: [
    { granuleId: "CFR-2024-title49-vol2-sec172-100", title: "Sec. 172.100", granuleClass: "SECTION" },
    { granuleId: "CFR-2024-title49-vol2-sec172-101", title: "Sec. 172.101", granuleClass: "SECTION" },
  ],
};

function makeFetch(routes: Array<{ match: string; status?: number; body: string; contentType?: string }>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes.find((r) => url.includes(r.match));
    if (!route) return new Response("not found", { status: 404 });
    return new Response(route.body, {
      status: route.status ?? 200,
      headers: { "content-type": route.contentType ?? "application/json" },
    });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const base = { apiKey: "SECRET123", sleep: () => Promise.resolve() };

describe("redactKey", () => {
  it("hides the api_key value", () => {
    expect(redactKey("https://api.govinfo.gov/collections?api_key=SECRET123")).toBe(
      "https://api.govinfo.gov/collections?api_key=REDACTED",
    );
    expect(redactKey("https://x/y?pageSize=10&api_key=abc&foo=1")).toBe("https://x/y?pageSize=10&api_key=REDACTED&foo=1");
  });
});

describe("GovInfoClient — construction", () => {
  it("throws a clear error when no key is available", () => {
    // No apiKey passed and (in the test env) no GOVINFO_API_KEY set.
    const prev = process.env["GOVINFO_API_KEY"];
    delete process.env["GOVINFO_API_KEY"];
    try {
      expect(() => new GovInfoClient({ fetchImpl: (() => {}) as unknown as typeof fetch })).toThrow(/GOVINFO_API_KEY/);
    } finally {
      if (prev !== undefined) process.env["GOVINFO_API_KEY"] = prev;
    }
  });

  it("reads GOVINFO_API_KEY from the environment", async () => {
    const prev = process.env["GOVINFO_API_KEY"];
    process.env["GOVINFO_API_KEY"] = "ENVKEY";
    try {
      const { impl, calls } = makeFetch([{ match: "/collections", body: JSON.stringify(COLLECTIONS) }]);
      const c = new GovInfoClient({ fetchImpl: impl, sleep: () => Promise.resolve() });
      await c.getCollections();
      expect(calls[0]!.url).toContain("api_key=ENVKEY");
    } finally {
      if (prev !== undefined) process.env["GOVINFO_API_KEY"] = prev;
      else delete process.env["GOVINFO_API_KEY"];
    }
  });
});

describe("GovInfoClient — endpoints", () => {
  it("getCollections appends api_key + Accept", async () => {
    const { impl, calls } = makeFetch([{ match: "/collections", body: JSON.stringify(COLLECTIONS) }]);
    const c = new GovInfoClient({ ...base, fetchImpl: impl });
    const res = await c.getCollections();
    expect(res.collections).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://api.govinfo.gov/collections?api_key=SECRET123");
    const headers = (calls[0]!.init!.headers ?? {}) as Record<string, string>;
    expect(headers["Accept"]).toBe("application/json");
  });

  it("getPackageSummary builds the path", async () => {
    const { impl, calls } = makeFetch([{ match: "/summary", body: JSON.stringify(PKG_SUMMARY) }]);
    const c = new GovInfoClient({ ...base, fetchImpl: impl });
    const s = await c.getPackageSummary("CFR-2024-title49-vol2");
    expect(s.download!.pdfLink).toContain("/pdf");
    expect(calls[0]!.url).toBe("https://api.govinfo.gov/packages/CFR-2024-title49-vol2/summary?api_key=SECRET123");
  });

  it("tryGetGranuleSummary returns null on 404 (no throw)", async () => {
    const { impl } = makeFetch([{ match: "does-not-match", body: "x" }]); // everything → 404
    const c = new GovInfoClient({ ...base, fetchImpl: impl });
    const s = await c.tryGetGranuleSummary("CFR-2024-title49-vol2", "CFR-2024-title49-vol2-sec999-999");
    expect(s).toBeNull();
  });

  it("getGranules passes offsetMark=* and pageSize", async () => {
    const { impl, calls } = makeFetch([{ match: "/granules", body: JSON.stringify(GRANULES) }]);
    const c = new GovInfoClient({ ...base, fetchImpl: impl });
    const res = await c.getGranules("CFR-2024-title49-vol2", { pageSize: 100 });
    expect(res.granules).toHaveLength(2);
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.get("offsetMark")).toBe("*");
    expect(u.searchParams.get("pageSize")).toBe("100");
    expect(u.searchParams.get("api_key")).toBe("SECRET123");
  });

  it("getGranuleContentBytes returns raw bytes (PDF path)", async () => {
    const { impl, calls } = makeFetch([{ match: "/pdf", body: "%PDF-1.7\n...", contentType: "application/pdf" }]);
    const c = new GovInfoClient({ ...base, fetchImpl: impl });
    const bytes = await c.getGranuleContentBytes("CFR-2024-title49-vol2", "CFR-2024-title49-vol2-sec172-101", "pdf");
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(calls[0]!.url).toContain("/granules/CFR-2024-title49-vol2-sec172-101/pdf?api_key=SECRET123");
  });

  it("getPublished builds date range + collection query", async () => {
    const { impl, calls } = makeFetch([{ match: "/published/", body: JSON.stringify({ packages: [], nextPage: null }) }]);
    const c = new GovInfoClient({ ...base, fetchImpl: impl });
    await c.getPublished("2024-01-01", "2024-12-31", { collection: "CFR", pageSize: 50 });
    const u = new URL(calls[0]!.url);
    expect(u.pathname).toBe("/published/2024-01-01/2024-12-31");
    expect(u.searchParams.get("collection")).toBe("CFR");
    expect(u.searchParams.get("offsetMark")).toBe("*");
  });
});

describe("GovInfoClient — retry, errors, key safety", () => {
  it("retries a 503 (zip-generation style) then succeeds, honoring Retry-After", async () => {
    let n = 0;
    const impl = vi.fn(async () => {
      n += 1;
      return n === 1
        ? new Response("generating", { status: 503, headers: { "retry-after": "1" } })
        : new Response(JSON.stringify(COLLECTIONS), { status: 200 });
    }) as unknown as typeof fetch;
    const slept: number[] = [];
    const c = new GovInfoClient({ apiKey: "K", fetchImpl: impl, sleep: (ms) => (slept.push(ms), Promise.resolve()) });
    const res = await c.getCollections();
    expect(res.collections).toHaveLength(2);
    expect(slept).toEqual([1000]);
  });

  it("throws GovInfoApiError with a REDACTED url (no key leak)", async () => {
    const impl = vi.fn(async () => new Response("bad", { status: 400 })) as unknown as typeof fetch;
    const c = new GovInfoClient({ apiKey: "SUPERSECRET", fetchImpl: impl, sleep: () => Promise.resolve() });
    const err = (await c.getCollections().catch((e: unknown) => e)) as GovInfoApiError;
    expect(err).toBeInstanceOf(GovInfoApiError);
    expect(err.status).toBe(400);
    expect(err.safeUrl).not.toContain("SUPERSECRET");
    expect(err.safeUrl).toContain("api_key=REDACTED");
    expect(err.message).not.toContain("SUPERSECRET");
  });

  it("does not retry a 404 (fails fast)", async () => {
    const impl = vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    const c = new GovInfoClient({ apiKey: "K", fetchImpl: impl, sleep: () => Promise.resolve() });
    await expect(c.getPackageSummary("CFR-x")).rejects.toBeInstanceOf(GovInfoApiError);
    expect(impl).toHaveBeenCalledTimes(1);
  });
});
