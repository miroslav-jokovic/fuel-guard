import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MedstopOrderedCollection } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
import { recordOrderedDrugTest } from "./applicantDrugTest.js";
import { partOneHomeZip } from "./medstopApplicantFacts.js";

/**
 * The appointment a Med-Stop pre-employment order fills (MEDSTOP-PLAN §7A.21, MSO1, D-MSO1/D-MSO2).
 * Pinned: the window runs from NOW until the order's "go by" on the carrier's clock (a deadline, never
 * "at 4 pm"); a deadline already behind the clock is written as its moment, not refused; it goes on the
 * live invitation through the one writer, org-scoped; and the audit names the Med-Stop request but never
 * the code. Plus the Part 1 home ZIP the drawer's site search starts from.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const INVITE = "10000000-0000-4000-8000-000000000001";
const NEW = "30000000-0000-4000-8000-000000000009";

const appointments = () => {
  const read = postgrestFixture([]);
  return (q: RecordedQuery) =>
    q.write?.method === "insert"
      ? [{ id: NEW, created_at: "2026-11-03T18:00:00Z", sent_to_driver_at: null, cancelled_at: null, ...(q.write.payload as object) }]
      : read(q);
};
const seed = (over: { invitations?: unknown[]; intakes?: unknown[] } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: postgrestFixture((over.invitations ?? [{ id: INVITE, org_id: ORG, driver_id: DRIVER, created_at: "2026-11-01T00:00:00Z", revoked_at: null }]) as Record<string, unknown>[]),
      application_intakes: postgrestFixture((over.intakes ?? []) as Record<string, unknown>[]),
      drug_test_appointments: appointments(),
      organizations: postgrestFixture([{ id: ORG, operating_hours: { tz: "America/Chicago" } }]),
      audit_logs: [],
    },
  });

const ordered: MedstopOrderedCollection = {
  requestId: "REQ-77",
  siteName: "Concentra Joliet",
  siteAddress: "1051 Essington Rd, Joliet, IL 60435",
  sitePhone: "8155550142 ext 2",
  goBy: "2026-11-04T16:00",
  reference: "AUTH-9 (registration 4471)",
};
// 2026-11-03 12:40 Central (CST, UTC-6).
const NOW = new Date("2026-11-03T18:40:00Z");

describe("recordOrderedDrugTest (MSO1)", () => {
  it("writes the order's site, code and a window from now until the go-by, on the live invitation", async () => {
    const rec = seed();
    const r = await recordOrderedDrugTest(rec.client as unknown as SupabaseClient, ORG, "u-1", DRIVER, ordered, NOW);
    expect(r).toEqual({ appointmentId: NEW });
    const [row] = rec.writtenRows("drug_test_appointments");
    expect(row).toMatchObject({
      org_id: ORG,
      invitation_id: INVITE,
      site_name: "Concentra Joliet",
      site_address: "1051 Essington Rd, Joliet, IL 60435",
      site_phone: "8155550142 ext 2",
      donor_reference: "AUTH-9 (registration 4471)",
      arranged_by: "u-1",
      // 12:40 CST now → 16:00 CST tomorrow.
      window_start: "2026-11-03T18:40:00.000Z",
      window_end: "2026-11-04T22:00:00.000Z",
    });
    expectOrgScoped(rec, ORG);
  });

  it("audits it as the office's arrangement, naming the Med-Stop request and never the code", async () => {
    const rec = seed();
    await recordOrderedDrugTest(rec.client as unknown as SupabaseClient, ORG, "u-1", DRIVER, ordered, NOW);
    const [audit] = rec.writtenRows("audit_logs");
    expect(audit).toMatchObject({ action: "recruiting.drug_test_arranged", entity_id: NEW });
    expect(JSON.stringify(audit)).toContain("REQ-77");
    expect(JSON.stringify(audit)).not.toContain("AUTH-9");
  });

  it("writes a deadline already behind the carrier's clock as its moment alone, rather than refusing", async () => {
    const rec = seed();
    const late = await recordOrderedDrugTest(rec.client as unknown as SupabaseClient, ORG, "u-1", DRIVER, { ...ordered, goBy: "2026-11-03T12:00" }, NOW);
    expect(late).toEqual({ appointmentId: NEW });
    expect(rec.writtenRows("drug_test_appointments")[0]).toMatchObject({ window_start: "2026-11-03T18:00:00.000Z", window_end: null });
  });

  it("refuses, writing nothing, for an applicant with no live invitation", async () => {
    const rec = seed({ invitations: [] });
    const r = await recordOrderedDrugTest(rec.client as unknown as SupabaseClient, ORG, "u-1", DRIVER, ordered, NOW);
    expect(r).toHaveProperty("refused");
    expect(rec.writtenRows("drug_test_appointments")).toEqual([]);
    expect(rec.writtenRows("audit_logs")).toEqual([]);
  });
});

describe("partOneHomeZip (MSO1, D-MSO2)", () => {
  it("reads the live invitation's Part 1 ZIP, five digits off a ZIP+4, org-scoped", async () => {
    const rec = seed({ intakes: [{ org_id: ORG, invitation_id: INVITE, postal_code: "60435-1234" }] });
    expect(await partOneHomeZip(rec.client as unknown as SupabaseClient, ORG, DRIVER)).toBe("60435");
    expectOrgScoped(rec, ORG);
  });

  it("is null when Part 1 holds no usable ZIP, or there is no live invitation", async () => {
    expect(await partOneHomeZip(seed({ intakes: [{ org_id: ORG, invitation_id: INVITE, postal_code: "N/A" }] }).client as unknown as SupabaseClient, ORG, DRIVER)).toBeNull();
    // Six digits is a typo, not a ZIP: guessing its first five would search the wrong town.
    expect(await partOneHomeZip(seed({ intakes: [{ org_id: ORG, invitation_id: INVITE, postal_code: "604351" }] }).client as unknown as SupabaseClient, ORG, DRIVER)).toBeNull();
    expect(await partOneHomeZip(seed({ invitations: [], intakes: [{ org_id: ORG, invitation_id: INVITE, postal_code: "60435" }] }).client as unknown as SupabaseClient, ORG, DRIVER)).toBeNull();
  });
});
