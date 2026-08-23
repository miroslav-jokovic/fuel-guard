import type { SupabaseClient } from "@supabase/supabase-js";
import { returnToDutyBlocked } from "./returnToDuty.js";
import {
  hiringGapsAfterHire,
  planHireHandoff,
  validateHireRequest,
  type HandoffEmployment,
  type HandoffExistingRecord,
  type HandoffSkip,
  type HireApplicant,
} from "@fuelguard/shared";

/**
 * Hiring an applicant — the Recruitment → DQF handoff (H8).
 *
 * ── THE HANDOFF MOVES NOTHING ──────────────────────────────────────────────────────────────────
 * D-HIRE5 made an applicant a `drivers` row rather than a separate table, so the PSP report, the
 * scans and every qualification record Recruitment gathered are already filed against this driver
 * id. Hiring does not migrate them. What it writes is the one thing Recruitment holds in a shape
 * §391.51 does not accept: `driver_employment_history`'s inquiry columns, projected into dated
 * `previous_employer_inquiry` / `previous_employer_response` records.
 *
 * ── HIRE IS A FACT, NOT A PERMISSION ───────────────────────────────────────────────────────────
 * Nothing here refuses to record a hire because the file is incomplete. The carrier hired somebody;
 * a product that declines to write that down does not prevent the hire, it just stops representing
 * reality — and the driver would then have no §391.51 file at all, which is strictly worse than one
 * with a named gap. So the response REPORTS what is still outstanding and the DQF page shows it,
 * rather than the API pretending to be a gate it cannot be.
 *
 * The rules are pure (`hireHandoff.ts`), the atomicity is SQL (`hire_applicant`, 0218), and this
 * service is the part that reads, plans, calls and audits. Every query org-filters itself: this runs
 * as the service role, which bypasses RLS. Pinned by "scopes every read to the caller's org".
 */

export type HireError = { code: string; message: string };

export interface HireResult {
  driverId: string;
  hireDate: string;
  /** Records written by this call. A replay files nothing and is not an error. */
  filed: number;
  /** Employers whose evidence could not be filed, and why — each one is somebody's next task. */
  skipped: HandoffSkip[];
  /** §391.51(b) hiring items the file still lacks. Advisory items are never listed (D-PSP1). */
  outstanding: Array<{ key: string; label: string; citation: string }>;
  /**
   * §40.25(j): this applicant admitted a positive or refused pre-employment test in the preceding
   * two years and the §40.305 documentation is not on file (0237).
   *
   * ⚠ **Deliberately NOT one of `outstanding`.** Those are the §391.51(b) hiring items, they are
   * computed from `DQ_ITEMS`, and every one of them is unconditional — a file either holds an MVR or
   * it does not. This one exists only for the applicants who answered yes, and treating it as a
   * missing document would either list it for everybody or teach `hiringGapsAfterHire` a condition
   * it has no way to evaluate. It is also not a reason to refuse the hire, which every item in that
   * list effectively is.
   */
  returnToDutyBlocked: boolean;
}

export const isHireError = (v: object): v is HireError => "code" in v;

const EMPLOYMENT_COLS =
  "id, employer_name, usdot_number, dot_regulated, inquiry_status, inquiry_sent_on, inquiry_response_on";

interface EmploymentDbRow {
  id: string;
  employer_name: string;
  usdot_number: string | null;
  dot_regulated: boolean;
  inquiry_status: HandoffEmployment["inquiryStatus"];
  inquiry_sent_on: string | null;
  inquiry_response_on: string | null;
}

const toHandoff = (r: EmploymentDbRow): HandoffEmployment => ({
  id: r.id,
  employerName: r.employer_name,
  usdotNumber: r.usdot_number,
  dotRegulated: r.dot_regulated,
  inquiryStatus: r.inquiry_status,
  inquirySentOn: r.inquiry_sent_on,
  inquiryResponseOn: r.inquiry_response_on,
});

/**
 * What hiring this applicant would file, without filing it — the confirmation screen's data.
 *
 * The same function the hire itself runs, so what the operator was shown is what happens. A preview
 * computed by a second, simpler query is how a confirmation dialog comes to promise one thing and a
 * button to do another.
 */
export async function previewHire(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<Omit<HireResult, "hireDate" | "filed"> & { status: string; fullName: string } | HireError> {
  const { data: driver } = await admin
    .from("drivers")
    .select("id, full_name, status")
    .eq("id", driverId)
    .eq("org_id", orgId)
    .maybeSingle();
  const row = driver as { id: string; full_name: string; status: string } | null;
  if (!row) return { code: "not_found", message: "Driver not found" };

  const { employment, existing } = await loadFile(admin, orgId, driverId);
  const plan = planHireHandoff({ employment, existing });
  return {
    driverId,
    fullName: row.full_name,
    status: row.status,
    skipped: plan.skipped,
    outstanding: hiringGapsAfterHire(existing, plan.records),
    // §40.25(j). Shown on the confirmation screen so the recruiter learns it BEFORE they commit —
    // hiring is still permitted (the regulation bars the driving, not the hiring), and the person
    // who has to go and ask the applicant for the paperwork is standing right here.
    returnToDutyBlocked: await returnToDutyBlocked(admin, orgId, driverId),
  };
}

async function loadFile(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<{ employment: HandoffEmployment[]; existing: HandoffExistingRecord[] }> {
  const { data: employment } = await admin
    .from("driver_employment_history")
    .select(EMPLOYMENT_COLS)
    .eq("org_id", orgId)
    .eq("driver_id", driverId);
  const { data: records } = await admin
    .from("qualification_records")
    .select("kind, detail")
    .eq("org_id", orgId)
    .eq("driver_id", driverId);
  return {
    employment: ((employment ?? []) as EmploymentDbRow[]).map(toHandoff),
    existing: (records ?? []) as HandoffExistingRecord[],
  };
}

export async function hireApplicant(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  body: HireApplicant,
  today: string,
): Promise<HireResult | HireError> {
  const issues = validateHireRequest(body, today);
  if (issues.length > 0) return { code: "invalid_request", message: issues[0]!.message };

  const { data: driver } = await admin
    .from("drivers")
    .select("id, status")
    .eq("id", body.driver_id)
    .eq("org_id", orgId)
    .maybeSingle();
  const row = driver as { id: string; status: string } | null;
  if (!row) return { code: "not_found", message: "Driver not found" };
  // Checked here for the message and again inside the transaction for the truth: this read is
  // outside the lock, so it can only ever be a courtesy to the operator, never the guarantee.
  if (row.status !== "applicant") {
    return { code: "not_an_applicant", message: `This driver is already ${row.status}.` };
  }

  const { employment, existing } = await loadFile(admin, orgId, body.driver_id);
  const plan = planHireHandoff({ employment, existing });

  const { data, error } = await admin.rpc("hire_applicant", {
    p_org: orgId,
    p_driver: body.driver_id,
    p_hire_date: body.hire_date,
    p_actor: userId,
    p_records: plan.records.map((r) => ({
      kind: r.kind,
      occurred_on: r.occurredOn,
      result: r.result,
      performed_by: r.performedBy,
      reference: r.reference,
      detail: r.detail,
    })),
  });
  if (error) {
    // HA010 is the race the FOR UPDATE lock caught: somebody else hired them first.
    if (error.code === "HA010" || /not_applicant/.test(error.message)) {
      return { code: "not_an_applicant", message: "This driver has already been hired." };
    }
    return { code: "hire_failed", message: error.message };
  }

  return {
    driverId: body.driver_id,
    hireDate: body.hire_date,
    filed: Number((data as { filed?: number } | null)?.filed ?? 0),
    skipped: plan.skipped,
    outstanding: hiringGapsAfterHire(existing, plan.records),
    // Repeated in the RESULT, not only the preview: the drawer closes on success and the operator's
    // last sight of this hire is the toast, so the obligation has to survive into it.
    returnToDutyBlocked: await returnToDutyBlocked(admin, orgId, body.driver_id),
  };
}
