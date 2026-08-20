import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import {
  isInquiryError,
  previewInquiry,
  recordInquiryAttempt,
  recordInquiryOutcome,
  syncInquiryStatus,
} from "./employerInquiry.js";

/**
 * The §391.23(c)(2) record: what was asked, of whom, at what address, on what date.
 *
 * The property under test throughout is that the ROW is the evidence. Wording composed server-side
 * and stored verbatim, the address frozen as contacted, and a second attempt as a second row —
 * because when nobody answers, the attempts are the deliverable (§391.23(c)(1)).
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const EMP = "55555555-6666-4777-8888-999999999999";

const employment = (over: Record<string, unknown> = {}) => ({
  id: EMP,
  driver_id: DRIVER,
  employer_name: "Old Carrier",
  employer_address_line1: "12 Depot Rd",
  employer_city: "Joliet",
  employer_state: "IL",
  employer_email: "hr@oldcarrier.test",
  started_on: "2023-01-01",
  ended_on: "2025-06-30",
  dot_regulated: true,
  subject_to_fmcsr: true,
  safety_sensitive: true,
  ...over,
});

const seed = (over: { employment?: unknown[]; inquiries?: unknown[] } = {}) =>
  createSupabaseRecorder({
    tables: {
      driver_employment_history: over.employment ?? [employment()],
      drivers: [{ id: DRIVER, full_name: "Susan Godfrey" }],
      organizations: [{ id: ORG, name: "Silvicom Inc" }],
      employer_inquiries: over.inquiries ?? [{ id: "inq-1", employment_id: EMP }],
      audit_logs: [],
    },
  });

const attempt = {
  employment_id: EMP,
  kind: "safety_performance" as const,
  method: "post" as const,
  contacted_on: "2026-08-20",
  sent_to: "12 Depot Rd, Joliet, IL",
};

describe("what the letter says", () => {
  it("names the driver, the carrier and the employment period", async () => {
    const rec = seed();
    const preview = await previewInquiry(rec.client, ORG, EMP);
    expect(isInquiryError(preview)).toBe(false);
    if (isInquiryError(preview)) return;
    expect(preview.body).toContain("Susan Godfrey");
    expect(preview.body).toContain("Silvicom Inc");
    expect(preview.body).toContain("2023-01-01 to 2025-06-30");
  });

  /**
   * §391.23(e) has routed FMCSA carriers to the Clearinghouse since 2023-01-06, so asking a former
   * carrier for drug and alcohol history would be asking for something the regulation sends
   * elsewhere. The §391.23(d) letter must not drift into asking it.
   */
  it("asks for §390.15(b)(1) accident data and NOT for drug and alcohol history", async () => {
    const rec = seed();
    const preview = await previewInquiry(rec.client, ORG, EMP);
    if (isInquiryError(preview)) throw new Error("expected a preview");
    expect(preview.body).toContain("390.15(b)(1)");
    expect(preview.body.toLowerCase()).not.toContain("controlled substance");
    expect(preview.version).toBe("v1");
    expect(preview.draft).toBe(false);
  });

  it("says a nil return is a complete answer, so an employer with nothing to report replies anyway", async () => {
    const rec = seed();
    const preview = await previewInquiry(rec.client, ORG, EMP);
    if (isInquiryError(preview)) throw new Error("expected a preview");
    expect(preview.body).toContain("nil return");
  });

  it("records nothing", async () => {
    const rec = seed();
    await previewInquiry(rec.client, ORG, EMP);
    expect(rec.writes()).toHaveLength(0);
  });
});

describe("recording an attempt", () => {
  it("stores the wording, its version, and the address as contacted", async () => {
    const rec = seed();
    const out = await recordInquiryAttempt(rec.client, ORG, "u1", attempt);
    expect(isInquiryError(out)).toBe(false);
    const row = rec.writtenRows("employer_inquiries")[0]!;
    expect(row.wording_version).toBe("v1");
    expect(String(row.body_sent)).toContain("390.15(b)(1)");
    // §391.23(c)(2) wants the address we wrote TO, frozen — an employment row is editable later.
    expect(row.employer_address).toBe("12 Depot Rd, Joliet, IL");
    expect(row.employer_name).toBe("Old Carrier");
    expect(row.outcome).toBe("awaiting");
  });

  it("builds the address from what exists rather than padding a missing street", async () => {
    const rec = seed({ employment: [employment({ employer_address_line1: null })] });
    await recordInquiryAttempt(rec.client, ORG, "u1", attempt);
    expect(rec.writtenRows("employer_inquiries")[0]!.employer_address).toBe("Joliet, IL");
  });

  it("leaves the address null when nobody knows one", async () => {
    const rec = seed({
      employment: [employment({ employer_address_line1: null, employer_city: null, employer_state: null })],
    });
    await recordInquiryAttempt(rec.client, ORG, "u1", attempt);
    expect(rec.writtenRows("employer_inquiries")[0]!.employer_address).toBeNull();
  });

  /** §391.23(a)(2) reaches DOT-regulated employers; a warehouse owes no safety-performance history. */
  it("refuses an employer who owes no inquiry", async () => {
    const rec = seed({ employment: [employment({ dot_regulated: false })] });
    const out = await recordInquiryAttempt(rec.client, ORG, "u1", attempt);
    expect(isInquiryError(out) && out.code).toBe("not_dot_regulated");
    expect(rec.writtenRows("employer_inquiries")).toHaveLength(0);
  });

  /** §40.25(a)(1) rests on a consent whose wording is not settled (Q-H3). */
  it("refuses the drug and alcohol request while its wording is draft", async () => {
    const rec = seed();
    const out = await recordInquiryAttempt(rec.client, ORG, "u1", { ...attempt, kind: "drug_alcohol" });
    expect(isInquiryError(out) && out.code).toBe("wording_not_final");
    expect(rec.writtenRows("employer_inquiries")).toHaveLength(0);
  });

  it("refuses an employer on another org's file", async () => {
    const rec = seed({ employment: [] });
    const out = await recordInquiryAttempt(rec.client, ORG, "u1", attempt);
    expect(isInquiryError(out) && out.code).toBe("not_found");
  });

  it("scopes every read and write to the caller's org", async () => {
    const rec = seed();
    await recordInquiryAttempt(rec.client, ORG, "u1", attempt);
    expectOrgScoped(rec, ORG, {
      // Filtered by primary key, which IS the tenant id — the table that owns the concept has no
      // `org_id` column of its own.
      exempt: ["organizations"],
    });
  });
});

describe("the derived status", () => {
  const inquiries = (rows: Array<Record<string, unknown>>) => seed({ inquiries: rows });

  it("dates the inquiry from the FIRST attempt, not the latest", async () => {
    const rec = inquiries([
      { outcome: "awaiting", outcome_on: null, contacted_on: "2026-08-20" },
      { outcome: "awaiting", outcome_on: null, contacted_on: "2026-07-01" },
    ]);
    await syncInquiryStatus(rec.client, ORG, EMP);
    const patch = rec.writtenRows("driver_employment_history")[0]!;
    expect(patch.inquiry_status).toBe("sent");
    expect(patch.inquiry_sent_on).toBe("2026-07-01");
  });

  /** §391.23(c)(1) accepts documented good-faith efforts IN PLACE OF a reply. */
  it("treats a documented non-response as an answer", async () => {
    const rec = inquiries([{ outcome: "no_response", outcome_on: "2026-09-20", contacted_on: "2026-08-01" }]);
    await syncInquiryStatus(rec.client, ORG, EMP);
    const patch = rec.writtenRows("driver_employment_history")[0]!;
    expect(patch.inquiry_status).toBe("no_response");
    expect(patch.inquiry_response_on).toBe("2026-09-20");
  });

  it("prefers a real answer over a documented non-response", async () => {
    const rec = inquiries([
      { outcome: "no_response", outcome_on: "2026-09-20", contacted_on: "2026-08-01" },
      { outcome: "responded", outcome_on: "2026-09-25", contacted_on: "2026-09-01" },
    ]);
    await syncInquiryStatus(rec.client, ORG, EMP);
    expect(rec.writtenRows("driver_employment_history")[0]!.inquiry_status).toBe("responded");
  });

  it("moves the employment row when an outcome is recorded", async () => {
    const rec = seed({ inquiries: [{ id: "inq-1", employment_id: EMP, outcome: "responded", outcome_on: "2026-09-01", contacted_on: "2026-08-01" }] });
    const out = await recordInquiryOutcome(rec.client, ORG, "inq-1", {
      outcome: "responded",
      outcome_on: "2026-09-01",
    });
    expect(isInquiryError(out)).toBe(false);
    expect(rec.writtenRows("driver_employment_history")).toHaveLength(1);
  });
});
