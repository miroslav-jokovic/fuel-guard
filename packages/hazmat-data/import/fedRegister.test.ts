import { describe, expect, it, vi } from "vitest";
import { FrClient, type FrDocument, type FrDocumentsResponse } from "./fedRegisterClient.js";
import {
  cfrPartsOf,
  toHmrAmendment,
  listHmrAmendmentsSince,
  checkHmrCurrency,
  PHMSA_AGENCY_ID,
} from "./fedRegister.js";

function doc(overrides: Partial<FrDocument>): FrDocument {
  return {
    document_number: "X",
    title: "Hazardous Materials: Something",
    type: "Rule",
    action: "Final rule.",
    citation: "91 FR 1",
    publication_date: "2026-06-02",
    effective_on: "2026-07-02",
    cfr_references: [{ title: 49, part: "172", chapter: null, citation_url: null }],
    ...overrides,
  };
}

describe("cfrPartsOf", () => {
  it("extracts distinct sorted 49 CFR parts, ignoring other titles", () => {
    const d = doc({
      cfr_references: [
        { title: 49, part: "173", chapter: null, citation_url: null },
        { title: 49, part: "172", chapter: null, citation_url: null },
        { title: 40, part: "300", chapter: null, citation_url: null }, // other title → ignored
        { title: 49, part: "172", chapter: null, citation_url: null }, // dup
      ],
    });
    expect(cfrPartsOf(d)).toEqual(["172", "173"]);
  });
});

describe("toHmrAmendment", () => {
  it("flags in-scope parts", () => {
    const a = toHmrAmendment(doc({ cfr_references: [
      { title: 49, part: "172", chapter: null, citation_url: null },
      { title: 49, part: "107", chapter: null, citation_url: null }, // not in watch list
    ] }));
    expect(a.cfrParts).toEqual(["107", "172"]);
    expect(a.inScopeParts).toEqual(["172"]);
    expect(a.touchesInScope).toBe(true);
  });

  it("marks out-of-scope when no watched part is touched", () => {
    const a = toHmrAmendment(doc({ cfr_references: [{ title: 49, part: "107", chapter: null, citation_url: null }] }));
    expect(a.touchesInScope).toBe(false);
    expect(a.inScopeParts).toEqual([]);
  });

  it("carries effective date, rin, dockets", () => {
    const a = toHmrAmendment(doc({ effective_on: "2026-07-02", regulation_id_numbers: ["2137-AF50"], docket_ids: ["PHMSA-2020-0103"] }));
    expect(a.effectiveOn).toBe("2026-07-02");
    expect(a.regulationIdNumbers).toEqual(["2137-AF50"]);
    expect(a.docketIds).toEqual(["PHMSA-2020-0103"]);
  });
});

function clientReturning(results: FrDocument[]) {
  const resp: FrDocumentsResponse = { count: results.length, total_pages: 1, next_page_url: null, results };
  const calls: string[] = [];
  const impl = vi.fn(async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify(resp), { status: 200 });
  }) as unknown as typeof fetch;
  return { client: new FrClient({ fetchImpl: impl, sleep: () => Promise.resolve() }), calls };
}

describe("listHmrAmendmentsSince", () => {
  it("queries PHMSA + title 49 final rules and maps them", async () => {
    const { client, calls } = clientReturning([doc({ document_number: "2026-10962" })]);
    const list = await listHmrAmendmentsSince(client, { sinceDate: "2026-01-01" });
    expect(list).toHaveLength(1);
    expect(list[0]!.documentNumber).toBe("2026-10962");
    const u = new URL(calls[0]!);
    expect(u.searchParams.getAll("conditions[agency_ids][]")).toEqual([String(PHMSA_AGENCY_ID)]);
    expect(u.searchParams.getAll("conditions[type][]")).toEqual(["RULE"]); // final only by default
    expect(u.searchParams.get("conditions[cfr][title]")).toBe("49");
    expect(u.searchParams.get("conditions[publication_date][gte]")).toBe("2026-01-01");
  });

  it("includes proposed rules when asked", async () => {
    const { client, calls } = clientReturning([]);
    await listHmrAmendmentsSince(client, { sinceDate: "2026-01-01", includeProposed: true });
    expect(new URL(calls[0]!).searchParams.getAll("conditions[type][]")).toEqual(["RULE", "PRORULE"]);
  });
});

describe("checkHmrCurrency", () => {
  it("splits relevant amendments into effective-pending vs already-effective and drops out-of-scope", async () => {
    const { client } = clientReturning([
      doc({ document_number: "FUTURE", cfr_references: [{ title: 49, part: "172", chapter: null, citation_url: null }], effective_on: "2026-09-01" }),
      doc({ document_number: "PAST", cfr_references: [{ title: 49, part: "173", chapter: null, citation_url: null }], effective_on: "2026-05-01" }),
      doc({ document_number: "OUT", cfr_references: [{ title: 49, part: "107", chapter: null, citation_url: null }], effective_on: "2026-09-01" }),
      doc({ document_number: "PROPOSED", cfr_references: [{ title: 49, part: "172", chapter: null, citation_url: null }], effective_on: null, type: "Proposed Rule" }),
    ]);
    const report = await checkHmrCurrency(client, { sinceDate: "2026-01-01", todayIso: "2026-07-01" });
    expect(report.total).toBe(4);
    expect(report.relevant.map((a) => a.documentNumber).sort()).toEqual(["FUTURE", "PAST", "PROPOSED"]); // OUT excluded
    expect(report.effectivePending.map((a) => a.documentNumber)).toEqual(["FUTURE"]);
    expect(report.effectiveAlready.map((a) => a.documentNumber)).toEqual(["PAST"]);
  });
});
