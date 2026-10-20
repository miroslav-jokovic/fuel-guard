import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { getUnitFiles } from "./unitFiles.js";

/**
 * The truck and trailer file rollup (UNIT-FILES-PLAN UF2). Service-role reads, so the org filter is
 * the query's own and is pinned here; and the fixtures FILTER by what the query asked for (the
 * recorder returns rows as given otherwise), so a rollup that asked for the wrong subject type would
 * read nothing and fail, rather than read everything and pass.
 */
const ORG = "org1";
const TODAY = "2026-10-19";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";

const eq = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;

const CERTS = [
  { subject_type: "tractor", subject_id: T1, kind: "registration", issued_at: null, expires_at: "2027-03-31", document_id: "reg1" },
  { subject_type: "tractor", subject_id: T1, kind: "annual_inspection", issued_at: "2026-02-01", expires_at: "2027-02-01", document_id: null },
  // The fleet's policy, filed once on the organization (D-UF6), citing a paper on the organization.
  { subject_type: "organization", subject_id: ORG, kind: "insurance", issued_at: null, expires_at: "2027-01-01", document_id: "pol" },
  // A trailer's row must never reach a tractor rollup.
  { subject_type: "trailer", subject_id: T2, kind: "registration", issued_at: null, expires_at: "2027-01-01", document_id: null },
];
const DOCS = [
  { id: "reg1", subject_type: "tractor", subject_id: T1, kind: "registration", content_type: "application/pdf", variant: "original", derived_from: null, storage_path: "o/t/reg1.pdf", captured_at: null, created_at: "2026-03-01T00:00:00Z" },
  { id: "reg1t", subject_type: "tractor", subject_id: T1, kind: "registration", content_type: "image/webp", variant: "thumb", derived_from: "reg1", storage_path: "o/t/reg1t.thumb.webp", captured_at: null, created_at: "2026-03-01T00:00:05Z" },
  { id: "old", subject_type: "tractor", subject_id: T1, kind: "other", content_type: "image/jpeg", variant: "original", derived_from: null, storage_path: "o/t/old.jpg", captured_at: null, created_at: "2025-01-01T00:00:00Z" },
  // Two more of T1's originals, so T1 has four — one past what a cell draws.
  { id: "mid1", subject_type: "tractor", subject_id: T1, kind: "other", content_type: "image/png", variant: "original", derived_from: null, storage_path: "o/t/mid1.png", captured_at: null, created_at: "2026-02-01T00:00:00Z" },
  { id: "mid2", subject_type: "tractor", subject_id: T1, kind: "other", content_type: "image/png", variant: "original", derived_from: null, storage_path: "o/t/mid2.png", captured_at: null, created_at: "2025-06-01T00:00:00Z" },
  { id: "pol", subject_type: "organization", subject_id: ORG, kind: "insurance", content_type: "application/pdf", variant: "original", derived_from: null, storage_path: "o/org/pol.pdf", captured_at: "2026-01-02", created_at: "2026-01-05T00:00:00Z" },
];

function recorder() {
  return createSupabaseRecorder({
    tables: {
      vehicles: [
        { id: T1, unit_number: "654", status: "active", ownership_type: "owned", registration_expires_at: "2026-11-01", dot_annual_inspection_expires_at: null },
        { id: T2, unit_number: "700", status: "retired", ownership_type: null, registration_expires_at: "2026-11-01", dot_annual_inspection_expires_at: null },
      ],
      certifications: (q) => CERTS.filter((c) => c.subject_type === eq(q, "subject_type")),
      documents: (q) => {
        const ids = q.ops.find((o) => o.method === "in" && o.args[0] === "id")?.args[1] as string[] | undefined;
        if (ids) return DOCS.filter((d) => ids.includes(d.id) && d.variant === "original");
        return DOCS.filter((d) => d.subject_type === eq(q, "subject_type"));
      },
    },
    storage: {
      createSignedUrls: (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed.test/${p}` })), error: null }),
    },
  });
}

describe("getUnitFiles", () => {
  it("scopes every query to the org", async () => {
    const rec = recorder();
    await getUnitFiles(rec.client, ORG, "tractor", TODAY);
    expectOrgScoped(rec, ORG);
  });

  it("builds every unit's file, whatever its status, from its own papers and the fleet's", async () => {
    const rec = recorder();
    const { units } = await getUnitFiles(rec.client, ORG, "tractor", TODAY);
    expect(units.map((u) => [u.unit_number, u.status])).toEqual([["654", "active"], ["700", "retired"]]);
    const t1 = units[0]!;
    const cell = (key: string) => t1.items.find((i) => i.key === key);
    // `evidenceDate` and `expiryUnknown` ride along for the unit page's columns (UF5): the registration's
    // row has no issue date, so the evidence is undated and the expiry is known.
    expect(cell("registration")).toMatchObject({ state: "current", goodUntil: "2027-03-31", documentId: "reg1", dateOnly: null, evidenceDate: null, expiryUnknown: false });
    expect(cell("annual_inspection")).toMatchObject({ state: "current", evidenceDate: "2026-02-01", goodUntil: "2027-02-01" });
    // The organization's policy covers the truck, and its cited paper counts as on file.
    expect(cell("insurance")).toMatchObject({ state: "current", fleetWide: true, documentId: "pol" });
    // Owned: asked for its title; no ownership question left open.
    expect(cell("title")?.state).toBe("missing");
    expect(t1.ownership_unknown).toEqual([]);
  });

  it("shows McLeod's typed date beside an item with no paper, and holds title and lease while ownership is unknown", async () => {
    const rec = recorder();
    const { units } = await getUnitFiles(rec.client, ORG, "tractor", TODAY);
    const t2 = units[1]!;
    // The trailer's registration row belongs to a trailer, so this truck has no paper — only a date.
    expect(t2.items.find((i) => i.key === "registration")).toMatchObject({
      state: "missing",
      dateOnly: { goodUntil: "2026-11-01", state: "expiring" },
    });
    expect(t2.ownership_unknown.sort()).toEqual(["lease", "title"]);
  });

  it("returns the three newest papers with their signed thumbnails, and counts every original for the +N", async () => {
    const rec = recorder();
    const { units } = await getUnitFiles(rec.client, ORG, "tractor", TODAY);
    expect(units[0]!.papers).toEqual([
      { documentId: "reg1", kind: "registration", contentType: "application/pdf", thumbUrl: "https://signed.test/o/t/reg1t.thumb.webp", filedAt: "2026-03-01T00:00:00Z" },
      // Not derived yet: drawn as a type icon, never as the 25 MB original.
      { documentId: "mid1", kind: "other", contentType: "image/png", thumbUrl: null, filedAt: "2026-02-01T00:00:00Z" },
      { documentId: "mid2", kind: "other", contentType: "image/png", thumbUrl: null, filedAt: "2025-06-01T00:00:00Z" },
    ]);
    expect(units[0]!.paper_count).toBe(4);
    expect(units[1]!.papers).toEqual([]);
  });
});
