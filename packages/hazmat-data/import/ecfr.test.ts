import { describe, expect, it, vi } from "vitest";
import { EcfrClient, type TitlesResponse, type VersionsResponse } from "./ecfrClient.js";
import {
  resolveImportContext,
  checkTitleForUpdate,
  latestSectionAmendment,
  fetchHmtXml,
  importHmtEntries,
  HMT_SECTION,
} from "./ecfr.js";

function titles(overrides: Partial<TitlesResponse["titles"][number]> = {}): TitlesResponse {
  return {
    titles: [
      {
        number: 49,
        name: "Transportation",
        latest_amended_on: "2026-07-06",
        latest_issue_date: "2026-07-06",
        up_to_date_as_of: "2026-07-13",
        reserved: false,
        ...overrides,
      },
    ],
    meta: {},
  };
}

const VERSIONS: VersionsResponse = {
  content_versions: [
    { date: "2024-05-10", amendment_date: "2024-05-10", issue_date: "2024-05-10", identifier: "172.101", name: "…", part: "172", substantive: true, removed: false, subpart: "B", title: "49", type: "section" },
    { date: "2026-01-14", amendment_date: "2026-01-14", issue_date: "2026-02-13", identifier: "172.101", name: "…", part: "172", substantive: true, removed: false, subpart: "B", title: "49", type: "section" },
    { date: "2099-01-01", amendment_date: "2099-01-01", issue_date: "2099-01-01", identifier: "172.101", name: "…", part: "172", substantive: true, removed: true, subpart: "B", title: "49", type: "section" }, // removed → ignored
    { date: "2025-06-01", amendment_date: "2025-06-01", issue_date: "2025-06-01", identifier: "172.102", name: "…", part: "172", substantive: true, removed: false, subpart: "B", title: "49", type: "section" }, // other section
  ],
  meta: {},
};

function clientFor(routes: Array<{ match: string; body: string }>): EcfrClient {
  const impl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const route = routes.find((r) => url.includes(r.match));
    return new Response(route ? route.body : "nf", { status: route ? 200 : 404 });
  }) as unknown as typeof fetch;
  return new EcfrClient({ fetchImpl: impl, sleep: () => Promise.resolve() });
}

describe("resolveImportContext", () => {
  it("pins up_to_date_as_of", async () => {
    const ctx = await resolveImportContext(clientFor([{ match: "/titles.json", body: JSON.stringify(titles()) }]));
    expect(ctx.date).toBe("2026-07-13");
    expect(ctx.title).toBe(49);
  });

  it("falls back to latest_issue_date when up_to_date_as_of is null", async () => {
    const body = JSON.stringify(titles({ up_to_date_as_of: null, latest_issue_date: "2026-07-06" }));
    const ctx = await resolveImportContext(clientFor([{ match: "/titles.json", body }]));
    expect(ctx.date).toBe("2026-07-06");
  });

  it("throws when no date is available", async () => {
    const body = JSON.stringify(titles({ up_to_date_as_of: null, latest_issue_date: null }));
    await expect(resolveImportContext(clientFor([{ match: "/titles.json", body }]))).rejects.toThrow(/cannot pin a date/);
  });
});

describe("checkTitleForUpdate", () => {
  it("reports changed when the known date differs", async () => {
    const c = clientFor([{ match: "/titles.json", body: JSON.stringify(titles()) }]);
    const res = await checkTitleForUpdate("2026-01-01", c);
    expect(res).toEqual({ changed: true, latestAmendedOn: "2026-07-06", previous: "2026-01-01" });
  });

  it("reports unchanged when the known date matches", async () => {
    const c = clientFor([{ match: "/titles.json", body: JSON.stringify(titles()) }]);
    const res = await checkTitleForUpdate("2026-07-06", c);
    expect(res.changed).toBe(false);
  });
});

describe("latestSectionAmendment", () => {
  it("returns the newest non-removed amendment date for the section only", async () => {
    const c = clientFor([{ match: "/versions/title-49.json", body: JSON.stringify(VERSIONS) }]);
    // 172.101 has 2024-05-10 and 2026-01-14 (and a removed 2099 that must be ignored) → 2026-01-14.
    expect(await latestSectionAmendment("172.101", c)).toBe("2026-01-14");
  });

  it("returns null when the section has no versions", async () => {
    const c = clientFor([{ match: "/versions/title-49.json", body: JSON.stringify(VERSIONS) }]);
    expect(await latestSectionAmendment("172.999", c)).toBeNull();
  });
});

describe("fetchHmtXml", () => {
  it("requests the §172.101 section XML at the resolved date", async () => {
    const impl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/titles.json")) return new Response(JSON.stringify(titles()), { status: 200 });
      return new Response("<DIV8 N='172.101'/>", { status: 200 });
    }) as unknown as typeof fetch;
    const c = new EcfrClient({ fetchImpl: impl, sleep: () => Promise.resolve() });
    const ctx = await resolveImportContext(c);
    const xml = await fetchHmtXml(ctx, c);
    expect(xml).toContain("172.101");
    const lastUrl = String((impl as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)![0]);
    expect(lastUrl).toBe(`https://www.ecfr.gov/api/versioner/v1/full/2026-07-13/title-49.xml?section=${HMT_SECTION}`);
  });
});

describe("importHmtEntries", () => {
  it("fetches, then fails loudly because the parser is the next step", async () => {
    const impl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/titles.json")) return new Response(JSON.stringify(titles()), { status: 200 });
      return new Response("<DIV8 N='172.101'/>", { status: 200 });
    }) as unknown as typeof fetch;
    const c = new EcfrClient({ fetchImpl: impl, sleep: () => Promise.resolve() });
    await expect(importHmtEntries(c)).rejects.toThrow(/parseHmtSection is not implemented/);
  });
});
