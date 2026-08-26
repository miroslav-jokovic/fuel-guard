import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { renderDisputePacket } from "./fuelDisputePacket.js";

/**
 * The document a carrier sends Pilot. Its content stream is compressed, so what is testable here is
 * its shape and its scoping rather than its glyphs — the same limit the spend report's tests work
 * within, and the reason the arithmetic lives in pure functions that ARE readable.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const AT = "2026-09-01T12:00:00.000Z";

const ex = (o: Record<string, unknown> = {}) => ({
  kind: "recon_missing_in_system", occurred_on: "2026-08-17", amount: 242.11,
  amount_kind: "unrecorded", unit_number: "701", site_number: "436", city: "Amarillo", state: "TX",
  evidence: { billedGallons: 48.2, billedAmount: 242.11, authNo: "373364", card: "367971" }, ...o,
});

const seed = (rows: Record<string, unknown>[]) =>
  createSupabaseRecorder({
    tables: { fuel_exceptions: rows, organizations: { data: { name: "Silvicom Inc" } } },
  });

describe("renderDisputePacket", () => {
  it("produces a PDF and totals what is being claimed", async () => {
    const rec = seed([ex(), ex({ amount: 55.12, kind: "contract_variance" })]);
    const { pdf, lines, total } = await renderDisputePacket(rec.client, { orgId: ORG, ids: ["a", "b"], generatedBy: null, generatedAt: AT });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(lines).toBe(2);
    expect(total).toBe(297.23);
  });

  it("reads only the selected findings, and only this carrier's", async () => {
    // `admin` is the service role and bypasses RLS, so the org filter is the only tenant boundary —
    // a packet leaking another carrier's billing dispute is the worst version of this bug.
    const rec = seed([ex()]);
    await renderDisputePacket(rec.client, { orgId: ORG, ids: ["a"], generatedBy: null, generatedAt: AT });
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  it("still renders when nothing was selected, rather than throwing at somebody", async () => {
    const rec = seed([]);
    const { pdf, lines, total } = await renderDisputePacket(rec.client, { orgId: ORG, ids: ["a"], generatedBy: null, generatedAt: AT });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(lines).toBe(0);
    expect(total).toBe(0);
  });

  it("survives a finding whose evidence carries none of the fields it looks for", async () => {
    // Evidence differs per kind and a future detector may carry something else entirely. A packet that
    // threw on an unfamiliar blob would fail at exactly the moment a new check started finding money.
    const rec = seed([ex({ evidence: { somethingElse: true } })]);
    const { pdf, lines } = await renderDisputePacket(rec.client, { orgId: ORG, ids: ["a"], generatedBy: null, generatedAt: AT });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(lines).toBe(1);
  });

  it("does not run to more pages than it has content for", async () => {
    const rec = seed(Array.from({ length: 12 }, (_, i) => ex({ amount: 100 + i })));
    const { pdf } = await renderDisputePacket(rec.client, { orgId: ORG, ids: ["a"], generatedBy: null, generatedAt: AT });
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeLessThanOrEqual(2);
  });
});
