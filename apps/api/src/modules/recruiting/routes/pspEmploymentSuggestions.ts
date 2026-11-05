import type { Request, Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { pspEmploymentSuggestions, type PspDeclaredJob } from "../../psp/index.js";

/**
 * `GET /drivers/:driverId/psp-employment[?invitationId=]` — HW6b (HIRING-WORKFLOW-AUDIT-2026-10-31
 * §4.6): the carriers the driver's PSP record names that the employment list does not, and the
 * listed employers it backs up.
 *
 * ── WHICH LIST ────────────────────────────────────────────────────────────────────────────────
 * The timeline appears in two places and each one shows a different list. Before filing, the office
 * works the APPLICATION'S draft (`OfficeJobsSection`, `?invitationId=`); after, the driver's filed
 * RECORD (`EmploymentHistorySection`, no query). A suggestion is only useful against the list on the
 * screen, so the caller says which one and this route reads it — never a list sent by the client, which
 * would let the answer drift from what is stored.
 *
 * The split from `pspEmployment.ts` is the module line (D-SEP1): the draft and the record are
 * recruiting's tables, `psp_requests` is psp's, so each half reads its own.
 *
 * ── NOTHING IS STORED ─────────────────────────────────────────────────────────────────────────
 * No write of any kind, no audit row (a read), and no new table: PSP-PLAN Q10 is open, so the
 * cross-match is re-derived from the stored vendor response on every read. Acting on a suggestion is
 * the ordinary employer form, pressed by a person.
 */
export const pspEmploymentSuggestionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const admin = getSupabaseAdmin(getAppLocals(req).env);
  const orgId = req.auth!.orgId!;
  const driverId = String(req.params.driverId ?? "");
  const invitationId = typeof req.query.invitationId === "string" ? req.query.invitationId : null;

  const list = invitationId
    ? await draftJobs(admin, orgId, driverId, invitationId)
    : await recordJobs(admin, orgId, driverId);
  if (!list) {
    res.status(404).json(apiError("not_found", invitationId ? "Application not found" : "Driver not found"));
    return;
  }

  res.json(await pspEmploymentSuggestions(admin, { orgId, driverId, ...list }));
});

const today = (): string => new Date().toISOString().slice(0, 10);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/**
 * The filed record, measured from the hire date when there is one — the same `asOf` the section
 * draws its window from, because §391.21(b)(10) asks about the years before the APPLICATION and a
 * five-year employee measured from today would owe three years nobody asked for.
 */
async function recordJobs(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<{ jobs: PspDeclaredJob[]; asOf: string } | null> {
  const { data: driver } = await admin
    .from("drivers")
    .select("id, hire_date")
    .eq("org_id", orgId)
    .eq("id", driverId)
    .maybeSingle();
  if (!driver) return null;

  const { data, error } = await admin
    .from("driver_employment_history")
    .select("id, employer_name, usdot_number, started_on, ended_on")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .order("started_on", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    id: string; employer_name: string; usdot_number: string | null; started_on: string; ended_on: string | null;
  }>;
  return {
    asOf: (driver as { hire_date: string | null }).hire_date ?? today(),
    jobs: rows.map((r) => ({
      key: r.id,
      employerName: r.employer_name,
      usdotNumber: r.usdot_number,
      startedOn: r.started_on,
      endedOn: r.ended_on,
    })),
  };
}

/**
 * The application's draft, as the review drawer lists it: the objects in `payload.employers`, in
 * order, so `index` means the same job on both sides for a row from before AW1 that has no key. The
 * invitation must be this driver's — the PSP record is the driver's, and comparing it against another
 * applicant's jobs would answer a question nobody asked about a person nobody named. Measured from
 * today, as the review's own gaps have always been (§9 P5).
 */
async function draftJobs(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  invitationId: string,
): Promise<{ jobs: PspDeclaredJob[]; asOf: string } | null> {
  const { data: invitation } = await admin
    .from("application_invitations")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .eq("driver_id", driverId)
    .maybeSingle();
  if (!invitation) return null;

  const { data } = await admin
    .from("application_drafts")
    .select("employers:payload->employers")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  const list = (data as { employers?: unknown } | null)?.employers;
  const rows = (Array.isArray(list) ? list : []).filter(
    (e): e is Record<string, unknown> => Boolean(e) && typeof e === "object",
  );
  return {
    asOf: today(),
    jobs: rows.map((r) => ({
      key: str(r.key),
      employerName: str(r.employer_name) ?? "",
      usdotNumber: str(r.usdot_number),
      startedOn: str(r.started_on),
      endedOn: str(r.ended_on),
    })),
  };
}
