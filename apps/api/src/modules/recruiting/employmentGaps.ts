import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applicationEmploymentGapSchema,
  type ApplicationEmploymentGap,
  type EmploymentGapCreate,
  type EmploymentGapsView,
  type RecordedEmploymentGap,
} from "@silvicom/shared";
import { displayNameFor } from "../../lib/memberLabels.js";

/**
 * Employment gaps on a driver's record after signing — HW5c, the reader of 0538 (HIRING-WORKFLOW-AUDIT
 * §3.4 EM-7: "gaps after filing have no home"). `employmentGapContract.ts` has why the applicant's
 * explanations and the office's are two lists shown side by side.
 *
 * ── WHO RECORDED IT ───────────────────────────────────────────────────────────────────────────
 * The SESSION's person, by id and by the name the shell shows them (`displayNameFor`), never a name
 * the client sends — `applicantNotes.ts`'s rule, for its reason.
 *
 * ── THE APPLICANT'S, READ NARROWLY ────────────────────────────────────────────────────────────
 * Only `payload->employment_gaps` of the newest signed application is selected — never the payload
 * whole (it carries the §391.21 identity) and never `ssn_sealed`. Each entry is parsed with the filed
 * contract and an unreadable one is skipped rather than shown half.
 *
 * The service role bypasses RLS: every query below carries its own `.eq("org_id", …)`.
 */

export type GapRefusal = { code: "not_found" | "already_withdrawn" | "db_error"; message: string };
export const isGapRefusal = (v: object): v is GapRefusal => "code" in v && "message" in v;

const COLS = "id, started_on, ended_on, explanation, recorded_by_name, created_at, withdrawn_at";

interface GapRow {
  id: string;
  started_on: string;
  ended_on: string;
  explanation: string;
  recorded_by_name: string;
  created_at: string;
  withdrawn_at: string | null;
}

const toGap = (r: GapRow): RecordedEmploymentGap => ({
  id: r.id,
  startedOn: r.started_on,
  endedOn: r.ended_on,
  explanation: r.explanation,
  recordedByName: r.recorded_by_name,
  createdAt: r.created_at,
  withdrawnAt: r.withdrawn_at,
});

async function driverInOrg(admin: SupabaseClient, orgId: string, driverId: string): Promise<boolean> {
  const { data } = await admin.from("drivers").select("id").eq("org_id", orgId).eq("id", driverId).maybeSingle();
  return data !== null;
}

export async function listEmploymentGaps(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<EmploymentGapsView | GapRefusal> {
  if (!(await driverInOrg(admin, orgId, driverId))) return { code: "not_found", message: "Driver not found" };
  const [recorded, filed] = await Promise.all([
    admin
      .from("driver_employment_gaps")
      .select(COLS)
      .eq("org_id", orgId)
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false }),
    admin
      .from("driver_applications")
      .select("gaps:payload->employment_gaps")
      .eq("org_id", orgId)
      .eq("driver_id", driverId)
      .order("certified_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (recorded.error || filed.error) return { code: "db_error", message: "Could not load the gaps" };
  const raw = (filed.data as { gaps?: unknown } | null)?.gaps;
  const applicant = (Array.isArray(raw) ? raw : []).flatMap((g): ApplicationEmploymentGap[] => {
    const parsed = applicationEmploymentGapSchema.safeParse(g);
    return parsed.success ? [parsed.data] : [];
  });
  return { recorded: ((recorded.data ?? []) as GapRow[]).map(toGap), applicant };
}

export interface GapAuthor {
  userId: string;
  role: string | null;
  email: string | null;
}

export async function recordEmploymentGap(
  admin: SupabaseClient,
  orgId: string,
  author: GapAuthor,
  driverId: string,
  gap: EmploymentGapCreate,
): Promise<RecordedEmploymentGap | GapRefusal> {
  if (!(await driverInOrg(admin, orgId, driverId))) return { code: "not_found", message: "Driver not found" };
  const name = await displayNameFor(admin, author.userId, orgId, author.role);
  const { data, error } = await admin
    .from("driver_employment_gaps")
    .insert({
      org_id: orgId,
      driver_id: driverId,
      started_on: gap.started_on,
      ended_on: gap.ended_on,
      explanation: gap.explanation,
      recorded_by: author.userId,
      recorded_by_name: (name ?? author.email ?? "An office user").trim().slice(0, 200) || "An office user",
    })
    .select(COLS)
    .maybeSingle();
  if (error || !data) return { code: "db_error", message: "Could not record the gap" };
  return toGap(data as GapRow);
}

/** Withdraw a gap recorded by mistake — once (0538's EG012); the row stays, struck through. */
export async function withdrawEmploymentGap(
  admin: SupabaseClient,
  orgId: string,
  actorId: string,
  driverId: string,
  gapId: string,
): Promise<RecordedEmploymentGap | GapRefusal> {
  const { data: row } = await admin
    .from("driver_employment_gaps")
    .select("id, withdrawn_at")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .eq("id", gapId)
    .maybeSingle();
  if (!row) return { code: "not_found", message: "Gap not found" };
  if ((row as { withdrawn_at: string | null }).withdrawn_at) {
    return { code: "already_withdrawn", message: "That gap is already withdrawn." };
  }
  const { data, error } = await admin
    .from("driver_employment_gaps")
    .update({ withdrawn_at: new Date().toISOString(), withdrawn_by: actorId })
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .eq("id", gapId)
    .is("withdrawn_at", null)
    .select(COLS)
    .maybeSingle();
  if (error) return { code: "db_error", message: "Could not withdraw the gap" };
  if (!data) return { code: "already_withdrawn", message: "That gap is already withdrawn." };
  return toGap(data as GapRow);
}
