import { describe, expect, it, vi } from "vitest";
import { GovInfoClient, type GranuleSummary, type GranulesResponse } from "./govinfoClient.js";
import {
  resolveCfrSectionGranule,
  toProvenance,
  sectionGranuleToken,
  cfrSectionGranuleId,
  GOVINFO_SECTIONS,
} from "./govinfo.js";

function granuleSummary(packageId: string, granuleId: string): GranuleSummary {
  return {
    packageId,
    granuleId,
    title: `Sec. 172.101 …`,
    dateIssued: "2025-10-01",
    lastModified: "2025-11-01T00:00:00Z",
    detailsLink: `https://api.govinfo.gov/packages/${packageId}/granules/${granuleId}/summary`,
    download: {
      pdfLink: `https://api.govinfo.gov/packages/${packageId}/granules/${granuleId}/pdf`,
      xmlLink: `https://api.govinfo.gov/packages/${packageId}/granules/${granuleId}/xml`,
      modsLink: `https://api.govinfo.gov/packages/${packageId}/granules/${granuleId}/mods`,
    },
  };
}

/** A router keyed on URL substrings → status+body, recording calls, api_key auto-satisfied. */
function clientFrom(routes: Array<{ match: string; status?: number; json: unknown }>, clockYear = 2026) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const route = routes.find((r) => url.includes(r.match));
    if (!route) return new Response("nf", { status: 404 });
    return new Response(JSON.stringify(route.json), { status: route.status ?? 200 });
  }) as unknown as typeof fetch;
  const client = new GovInfoClient({ apiKey: "K", fetchImpl: impl, sleep: () => Promise.resolve() });
  const clock = () => Date.UTC(clockYear, 5, 1); // June of clockYear
  return { client, calls, clock };
}

describe("id helpers", () => {
  it("sectionGranuleToken", () => {
    expect(sectionGranuleToken("172.101")).toBe("sec172-101");
    expect(sectionGranuleToken("177.848")).toBe("sec177-848");
  });
  it("cfrSectionGranuleId", () => {
    expect(cfrSectionGranuleId(2025, 49, 2, "172.101")).toBe("CFR-2025-title49-vol2-sec172-101");
  });
});

describe("resolveCfrSectionGranule — direct fast path", () => {
  it("resolves §172.101 on the first probe (current year, vol 2)", async () => {
    const pkg = "CFR-2026-title49-vol2";
    const gid = "CFR-2026-title49-vol2-sec172-101";
    const { client, calls, clock } = clientFrom([
      { match: `/granules/${gid}/summary`, json: granuleSummary(pkg, gid) },
    ]);
    const r = await resolveCfrSectionGranule(client, GOVINFO_SECTIONS.hmt, { clock });
    expect(r.packageId).toBe(pkg);
    expect(r.granuleId).toBe(gid);
    expect(r.editionYear).toBe(2026);
    expect(r.volume).toBe(2);
    expect(r.resolvedBy).toBe("direct");
    // Fast path = a single granule-summary call.
    expect(calls).toHaveLength(1);
  });

  it("falls back to the prior year when the current edition is not published yet", async () => {
    const pkg = "CFR-2025-title49-vol2";
    const gid = "CFR-2025-title49-vol2-sec172-101";
    // Only the 2025 vol2 granule exists; all 2026 probes 404.
    const { client, clock } = clientFrom([{ match: `/granules/${gid}/summary`, json: granuleSummary(pkg, gid) }]);
    const r = await resolveCfrSectionGranule(client, GOVINFO_SECTIONS.hmt, { clock });
    expect(r.editionYear).toBe(2025);
    expect(r.granuleId).toBe(gid);
  });
});

describe("resolveCfrSectionGranule — listing fallback", () => {
  it("finds the granule by listing when the id-guess misses", async () => {
    // The direct granule id (…-sec172-101) 404s, but the volume package exists and its granule
    // list contains an unusually-formatted id for the section.
    const pkg = "CFR-2026-title49-vol2";
    const oddId = "CFR-2026-title49-vol2-172.101"; // not the guessed sec172-101 form
    const granules: GranulesResponse = {
      count: 1,
      nextPage: null,
      granules: [{ granuleId: oddId, title: "Sec. 172.101 …", granuleClass: "SECTION" }],
    };
    const { client } = clientFrom([
      { match: `/packages/${pkg}/summary`, json: { packageId: pkg, dateIssued: "2026-10-01" } },
      { match: `/packages/${pkg}/granules?`, json: granules },
      { match: `/granules/${oddId}/summary`, json: granuleSummary(pkg, oddId) },
    ]);
    // Pin the year so only vol probes run (keeps the call count small & deterministic).
    const r = await resolveCfrSectionGranule(client, GOVINFO_SECTIONS.hmt, { year: 2026, volumeProbeOrder: [2] });
    expect(r.resolvedBy).toBe("listing");
    expect(r.granuleId).toBe(oddId);
  });

  it("throws a helpful error when nothing resolves", async () => {
    const { client } = clientFrom([]); // everything 404s
    await expect(
      resolveCfrSectionGranule(client, GOVINFO_SECTIONS.hmt, { year: 2026, volumeProbeOrder: [2] }),
    ).rejects.toThrow(/Could not resolve CFR granule for §172\.101/);
  });
});

describe("toProvenance", () => {
  it("builds the audit record from a resolved granule", async () => {
    const pkg = "CFR-2025-title49-vol2";
    const gid = "CFR-2025-title49-vol2-sec172-101";
    const { client, clock } = clientFrom([{ match: `/granules/${gid}/summary`, json: granuleSummary(pkg, gid) }], 2025);
    const r = await resolveCfrSectionGranule(client, GOVINFO_SECTIONS.hmt, { clock });
    const p = toProvenance(r);
    expect(p).toMatchObject({
      source: "govinfo",
      collectionCode: "CFR",
      cfrTitle: 49,
      section: "172.101",
      packageId: pkg,
      granuleId: gid,
      editionYear: 2025,
      volume: 2,
      dateIssued: "2025-10-01",
      resolvedBy: "direct",
    });
    expect(p.pdfLink).toContain("/pdf");
    expect(p.xmlLink).toContain("/xml");
  });
});
