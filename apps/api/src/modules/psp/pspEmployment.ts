import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NO_PSP_EMPLOYMENT,
  crossMatchEmployment,
  parsePspReport,
  type DeclaredEmployment,
  type PspEmploymentSuggestions,
} from "@silvicom/shared";
import { pspResponseElement } from "./client.js";

/**
 * The employment the driver's PSP record suggests — HW6b (HIRING-WORKFLOW-AUDIT-2026-10-31 §4.6).
 *
 * `crossMatchEmployment` was built and tested in August and never called; this is its caller. It
 * reads the stored vendor response rather than a derived index because there is no derived index, on
 * purpose: PSP-PLAN Q10 (may PSP-derived data outlive the hiring decision?) is unanswered, so nothing
 * here is written anywhere. Each read re-derives the answer from `psp_requests.response_raw`, the one
 * copy a retention purge already owns (§5b.7).
 *
 * The JOB LIST is the caller's to read — the filed record or the application draft both belong to
 * recruiting (D-SEP1), and this module owns only `psp_requests`. So the list comes in as an argument
 * and the PSP half stays here.
 */

/** One job as the timeline lists it, with how the timeline names it. */
export interface PspDeclaredJob {
  /** The history row's id, or the draft employer's key; null for a draft job from before AW1. */
  key: string | null;
  employerName: string;
  usdotNumber: string | null;
  startedOn: string | null;
  endedOn: string | null;
}

/** The statuses `orderPspRecord` settles a filed report with — the two that store a driver record. */
const READABLE_STATUSES = ["succeeded", "partial"];

/**
 * A typed DOT number as PSP prints one: digits only. An applicant writes "DOT 1234567" or
 * "1234 567"; PSP sends "1234567". Only the declared side is touched — the vendor's value is the
 * evidence, and rewriting it here would make the match say something the report does not.
 */
const dotDigits = (raw: string | null): string | null => {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits === "" ? null : digits;
};

/**
 * The carrier's OWN USDOT number, from its organisation row — never `carrierIdentity()`.
 *
 * ⚠ They answer different questions. `carrierIdentity` is the PSP ACCOUNT a request is sent as, and in
 * UAT that is a different carrier altogether ("Silvicom, Inc - UAT", motorCarrierId 31496,
 * `psp/identity.ts`). An inspection run while the driver drove for US carries our real USDOT number,
 * so that is the one D-PSP6 excludes from "not on their list"; asking the account would exclude
 * nothing in UAT and could not be told apart from a carrier with no DOT on file.
 */
async function ownDotNumber(admin: SupabaseClient, orgId: string): Promise<string | null> {
  const { data } = await admin.from("organizations").select("dot_number").eq("id", orgId).maybeSingle();
  return dotDigits((data as { dot_number: string | null } | null)?.dot_number ?? null);
}

export async function pspEmploymentSuggestions(
  admin: SupabaseClient,
  input: { orgId: string; driverId: string; jobs: readonly PspDeclaredJob[]; asOf: string },
): Promise<PspEmploymentSuggestions> {
  // The newest report that holds a driver record. Org-scoped as well as driver-scoped: the service
  // role bypasses RLS, and a driver id from a URL is exactly the value that crosses a tenant.
  const { data, error } = await admin
    .from("psp_requests")
    .select("id, response_raw, settled_at")
    .eq("org_id", input.orgId)
    .eq("driver_id", input.driverId)
    .in("status", READABLE_STATUSES)
    .order("settled_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = ((data ?? []) as Array<{ id: string; response_raw: unknown; settled_at: string | null }>)[0];
  if (!row || row.response_raw == null) return NO_PSP_EMPLOYMENT;

  const report = parsePspReport(pspResponseElement(row.response_raw));
  const pulledOn = (report.requestDate ?? row.settled_at ?? input.asOf).slice(0, 10);

  // A job with no start date has no period PSP could corroborate, but its DOT number was still
  // LISTED — so it stays in the declared set (or that carrier would come back as "not on their
  // list") with a one-day period, and its check is left out of the answer below.
  const declared: DeclaredEmployment[] = input.jobs.map((j, i) => {
    const endedOn = j.endedOn || null;
    return {
      id: String(i),
      employerName: j.employerName,
      usdotNumber: dotDigits(j.usdotNumber),
      startedOn: j.startedOn || (endedOn ?? input.asOf),
      endedOn,
    };
  });

  const match = crossMatchEmployment({
    declared,
    declaredAccidents: [],
    inspections: report.inspections,
    crashes: report.crashes,
    ownDotNumber: await ownDotNumber(admin, input.orgId),
    asOf: input.asOf,
    pulledOn,
  });

  return {
    report: { requestId: row.id, pulledOn },
    unlisted: match.unlisted,
    employers: match.employers
      .map((e) => ({ e, index: Number(e.employmentId) }))
      .filter(({ index }) => Boolean(input.jobs[index]?.startedOn))
      .map(({ e, index }) => ({
        key: input.jobs[index]!.key,
        index,
        match: e.match,
        inspections: e.inspections,
        crashes: e.crashes,
      })),
    inspectionWindowStart: match.inspectionWindowStart,
    crashWindowStart: match.crashWindowStart,
  };
}
