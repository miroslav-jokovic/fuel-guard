import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compareInquiryUrgency,
  driverInquiryQueue,
  type DriverInquiryQueue,
  type QueueAttempt,
  type QueueEmployment,
} from "@silvicom/shared";

/**
 * The fleet-wide §391.23 queue (EMPLOYER-INQUIRY-PLAN E5).
 *
 * ── ONE READ PER TABLE, NOT ONE PER DRIVER ─────────────────────────────────────────────────────
 * Three queries for the whole org, joined in memory by the pure function. A per-driver loop would be
 * N+1 against a table that grows with every attempt, and this page exists precisely to replace
 * opening drivers one at a time.
 *
 * ── APPLICANTS ARE IN IT, AND THEY HAVE NO DEADLINE ────────────────────────────────────────────
 * §391.23(c)(1) counts from the date employment begins, so an applicant is not late for anything.
 * They still owe the inquiries — sending them before the hire is how a carrier makes that deadline —
 * so they belong in the queue, ordered after everyone who is actually on a clock.
 *
 * Every query org-filters itself: the service role bypasses RLS.
 */

export interface InquiryQueueRow extends DriverInquiryQueue {
  driverId: string;
  name: string;
  status: string;
  hireDate: string | null;
}

export interface InquiryQueueSummary {
  drivers: number;
  /** Files with §391.23 work left. */
  outstanding: number;
  /** Hired drivers whose §391.23(c)(1) 30 days have already run out with work still open. */
  overdue: number;
  /** Employers written to whose own 30 days are up — the ones to chase or document. */
  chaseable: number;
}

interface DriverRow {
  id: string;
  full_name: string;
  status: string;
  hire_date: string | null;
}

export async function loadInquiryQueue(
  admin: SupabaseClient,
  orgId: string,
  today: string,
): Promise<{ rows: InquiryQueueRow[]; summary: InquiryQueueSummary }> {
  const [{ data: drivers }, { data: employment }, { data: attempts }] = await Promise.all([
    admin
      .from("drivers")
      .select("id, full_name, status, hire_date")
      .eq("org_id", orgId)
      .in("status", ["active", "applicant"]),
    admin
      .from("driver_employment_history")
      .select("id, driver_id, employer_name, started_on, ended_on, dot_regulated")
      .eq("org_id", orgId),
    admin
      .from("employer_inquiries")
      .select("driver_id, employment_id, contacted_on, outcome")
      .eq("org_id", orgId)
      .eq("kind", "safety_performance"),
  ]);

  const employmentByDriver = new Map<string, QueueEmployment[]>();
  for (const row of (employment ?? []) as Array<Record<string, unknown>>) {
    const list = employmentByDriver.get(String(row.driver_id)) ?? [];
    list.push({
      id: String(row.id),
      employerName: String(row.employer_name),
      startedOn: String(row.started_on),
      endedOn: (row.ended_on as string | null) ?? null,
      dotRegulated: Boolean(row.dot_regulated),
    });
    employmentByDriver.set(String(row.driver_id), list);
  }

  const attemptsByDriver = new Map<string, QueueAttempt[]>();
  for (const row of (attempts ?? []) as Array<Record<string, unknown>>) {
    const list = attemptsByDriver.get(String(row.driver_id)) ?? [];
    list.push({
      employmentId: String(row.employment_id),
      contactedOn: String(row.contacted_on),
      outcome: row.outcome as QueueAttempt["outcome"],
    });
    attemptsByDriver.set(String(row.driver_id), list);
  }

  const rows = ((drivers ?? []) as DriverRow[])
    .map((driver): InquiryQueueRow => ({
      driverId: driver.id,
      name: driver.full_name,
      status: driver.status,
      hireDate: driver.hire_date,
      ...driverInquiryQueue({
        employment: employmentByDriver.get(driver.id) ?? [],
        attempts: attemptsByDriver.get(driver.id) ?? [],
        hireDate: driver.hire_date,
        today,
      }),
    }))
    // Nothing owed is nothing to show. A queue padded with complete files is a queue nobody reads.
    .filter((row) => row.outstanding.length > 0)
    .sort(compareInquiryUrgency);

  return {
    rows,
    summary: {
      drivers: rows.length,
      outstanding: rows.length,
      overdue: rows.filter((r) => r.daysToDeadline !== null && r.daysToDeadline < 0).length,
      chaseable: rows.reduce(
        (n, r) => n + r.outstanding.filter((e) => e.state === "overdue" || e.state === "undeliverable").length,
        0,
      ),
    },
  };
}
