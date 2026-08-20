import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { loadInquiryQueue } from "./inquiryQueue.js";

/**
 * The fleet-wide §391.23 queue.
 *
 * The rules are pinned in `packages/shared/src/inquiryQueue.test.ts`; what is pinned here is that
 * the service joins the three tables correctly, shows only files with work left, and leads with the
 * one closest to ITS OWN deadline — §391.23(c)(1)'s thirty days from employment beginning, which is
 * the clock we can actually miss.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TODAY = "2026-08-20";

const seed = (over: { drivers?: unknown[]; employment?: unknown[]; attempts?: unknown[] } = {}) =>
  createSupabaseRecorder({
    tables: {
      drivers: over.drivers ?? [
        { id: "d1", full_name: "Susan Godfrey", status: "active", hire_date: "2026-08-10" },
      ],
      driver_employment_history: over.employment ?? [
        { id: "e1", driver_id: "d1", employer_name: "Old Carrier", started_on: "2024-01-01", ended_on: "2025-06-30", dot_regulated: true },
      ],
      employer_inquiries: over.attempts ?? [],
    },
  });

describe("the queue", () => {
  it("shows a hired driver with an unsent inquiry, and their deadline", async () => {
    const rec = seed();
    const { rows, summary } = await loadInquiryQueue(rec.client, ORG, TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Susan Godfrey", fileDeadline: "2026-09-09", daysToDeadline: 20 });
    expect(rows[0]!.outstanding[0]).toMatchObject({ employerName: "Old Carrier", state: "not_sent" });
    expect(summary.outstanding).toBe(1);
  });

  /** A queue padded with finished files is a queue nobody reads. */
  it("leaves out a file with nothing outstanding", async () => {
    const rec = seed({
      attempts: [{ driver_id: "d1", employment_id: "e1", contacted_on: "2026-08-01", outcome: "responded" }],
    });
    const { rows, summary } = await loadInquiryQueue(rec.client, ORG, TODAY);
    expect(rows).toEqual([]);
    expect(summary.drivers).toBe(0);
  });

  it("counts a documented non-response as finished too", async () => {
    const rec = seed({
      attempts: [{ driver_id: "d1", employment_id: "e1", contacted_on: "2026-08-01", outcome: "no_response" }],
    });
    expect((await loadInquiryQueue(rec.client, ORG, TODAY)).rows).toEqual([]);
  });

  it("leads with the file closest to its own deadline, applicants last", async () => {
    const rec = seed({
      drivers: [
        { id: "d1", full_name: "Not Late", status: "active", hire_date: "2026-08-18" },
        { id: "d2", full_name: "Overdue", status: "active", hire_date: "2026-06-01" },
        { id: "d3", full_name: "An Applicant", status: "applicant", hire_date: null },
      ],
      employment: [
        { id: "e1", driver_id: "d1", employer_name: "A", started_on: "2024-01-01", ended_on: "2025-01-01", dot_regulated: true },
        { id: "e2", driver_id: "d2", employer_name: "B", started_on: "2024-01-01", ended_on: "2025-01-01", dot_regulated: true },
        { id: "e3", driver_id: "d3", employer_name: "C", started_on: "2024-01-01", ended_on: "2025-01-01", dot_regulated: true },
      ],
    });
    const { rows, summary } = await loadInquiryQueue(rec.client, ORG, TODAY);
    expect(rows.map((r) => r.name)).toEqual(["Overdue", "Not Late", "An Applicant"]);
    expect(summary.overdue).toBe(1);
  });

  /** The employers to chase or document today: written to, and their own 30 days are up. */
  it("counts the employers whose §391.23(g)(1) window has run out", async () => {
    const rec = seed({
      attempts: [{ driver_id: "d1", employment_id: "e1", contacted_on: "2026-06-01", outcome: "awaiting" }],
    });
    const { rows, summary } = await loadInquiryQueue(rec.client, ORG, TODAY);
    expect(rows[0]!.outstanding[0]!.state).toBe("overdue");
    expect(summary.chaseable).toBe(1);
  });

  it("reads only the safety-performance attempts, not the §40.25 ones", async () => {
    const rec = seed();
    await loadInquiryQueue(rec.client, ORG, TODAY);
    const filters = rec.forTable("employer_inquiries")[0]!.filters();
    expect(filters.some((f) => f.col === "kind" && f.val === "safety_performance")).toBe(true);
  });

  it("scopes every read to the caller's org", async () => {
    const rec = seed();
    await loadInquiryQueue(rec.client, ORG, TODAY);
    expectOrgScoped(rec, ORG);
  });
});
