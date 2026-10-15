import type { SupabaseClient } from "@supabase/supabase-js";
import { REPORT_CHECK_VERSION, roadsideInspectionReportSchema, type ReportCheckOutcome } from "@silvicom/shared";
import { writeAudit } from "../../../lib/audit.js";
import { readOfBytes } from "../../document-reading/index.js";
import { readLatestAttribution } from "../read/inspectionAttribution.js";
import { compareReport, type RosterLicence } from "./compare.js";

/**
 * Check every read report against the record, and confirm the driver when it all agrees (IC10, D-IC13;
 * Q-IC11 (a)). Runs on the FMCSA hourly tick after the hand-over (`pass.ts`).
 *
 * For each handed-over report with no check at `REPORT_CHECK_VERSION`: find its read by the bytes'
 * sha256; still reading → next hour; failed → `unreadable`; done → `compareReport`. When everything
 * agrees, a `report` row is written to `inspection_attributions` (0479) restating the engine reading it
 * agrees with and naming our driver — unless a PERSON has already decided, whom a report never
 * overrules (`agrees`, nothing written). Then the check row, last, so a tick that dies in between finds
 * the report row next time and records `agrees` rather than writing a second.
 */

export const CHECKS_PER_TICK = 25;

export type CheckPassTally = Partial<Record<ReportCheckOutcome | "waiting" | "failed", number>>;

interface LinkRow {
  inspection_id: string;
  document_id: string;
  sha256: string;
}

/** Every row of a select, paged: PostgREST answers at most 1,000. */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(`${what}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function pending(admin: SupabaseClient, orgId: string): Promise<LinkRow[]> {
  const [links, checks] = await Promise.all([
    all<LinkRow>((f, t) => admin.from("inspection_report_reads").select("inspection_id, document_id, sha256").eq("org_id", orgId).order("id").range(f, t), "inspection_report_reads"),
    all<{ document_id: string }>(
      (f, t) => admin.from("inspection_report_checks").select("document_id").eq("org_id", orgId).eq("check_version", REPORT_CHECK_VERSION).order("id").range(f, t),
      "inspection_report_checks",
    ),
  ]);
  const done = new Set(checks.map((c) => c.document_id));
  return links.filter((l) => !done.has(l.document_id));
}

/** Roster drivers with a licence on file, applicants aside. */
async function rosterLicences(admin: SupabaseClient, orgId: string): Promise<RosterLicence[]> {
  const rows = await all<{ id: string; full_name: string; cdl_number: string; cdl_state: string | null; samsara_driver_id: string | null }>(
    (f, t) =>
      admin.from("drivers").select("id, full_name, cdl_number, cdl_state, samsara_driver_id")
        .eq("org_id", orgId).neq("status", "applicant").not("cdl_number", "is", null).order("id").range(f, t),
    "drivers",
  );
  return rows.map((r) => ({ id: r.id, fullName: r.full_name, cdlNumber: r.cdl_number, cdlState: r.cdl_state, samsaraDriverId: r.samsara_driver_id }));
}

async function inspectionFacts(admin: SupabaseClient, orgId: string, inspectionId: string) {
  const [insp, units] = await Promise.all([
    admin.from("roadside_inspections").select("report_number, report_state").eq("org_id", orgId).eq("id", inspectionId).maybeSingle(),
    admin.from("roadside_inspection_units").select("vin").eq("org_id", orgId).eq("inspection_id", inspectionId).is("vanished_at", null),
  ]);
  if (insp.error) throw new Error(`roadside_inspections: ${insp.error.message}`);
  if (units.error) throw new Error(`roadside_inspection_units: ${units.error.message}`);
  const row = insp.data as { report_number: string | null; report_state: string | null } | null;
  return {
    inspection: { reportNumber: row?.report_number ?? null, reportState: row?.report_state ?? null },
    unitVins: ((units.data ?? []) as { vin: string | null }[]).map((u) => u.vin).filter((v): v is string => !!v),
  };
}

export async function checkReportBacklog(admin: SupabaseClient, orgId: string, limit = CHECKS_PER_TICK): Promise<CheckPassTally> {
  const tally: CheckPassTally = {};
  const count = (k: keyof CheckPassTally) => (tally[k] = (tally[k] ?? 0) + 1);
  const due = (await pending(admin, orgId)).slice(0, limit);
  if (due.length === 0) return tally;
  let roster: RosterLicence[] | null = null;

  for (const link of due) {
    const read = await readOfBytes(admin, orgId, link.sha256, "roadside_inspection_report");
    if (read.status === "no_source" || read.status === "no_read" || read.status === "queued" || read.status === "reading") {
      count("waiting");
      continue;
    }
    const base = { org_id: orgId, inspection_id: link.inspection_id, document_id: link.document_id, read_id: read.readId, check_version: REPORT_CHECK_VERSION };
    if (read.status === "failed") {
      const { error } = await admin.from("inspection_report_checks").insert({ ...base, outcome: "unreadable" });
      if (error) { count("failed"); console.error(`[inspection-report] check ${link.document_id}: ${error.message}`); } else count("unreadable");
      continue;
    }

    const report = roadsideInspectionReportSchema.parse(read.result ?? {});
    const facts = await inspectionFacts(admin, orgId, link.inspection_id);
    const latest = await readLatestAttribution(admin, orgId, link.inspection_id);
    if ("error" in latest) throw new Error(`inspection_attributions: ${latest.error.message}`);
    const engine = latest.engine;
    roster ??= await rosterLicences(admin, orgId);
    const result = compareReport({
      report,
      evidence: read.evidence,
      ...facts,
      roster,
      samsaraDriverId: engine?.outcome === "one_driver" ? engine.samsara_driver_id : null,
    });

    let outcome: ReportCheckOutcome = result.agrees ? "confirmed" : "needs_review";
    let attributionId: string | null = null;
    if (result.agrees && (latest.person || latest.report)) outcome = "agrees";
    if (outcome === "confirmed" && engine) {
      const { data, error } = await admin
        .from("inspection_attributions")
        .insert({
          org_id: orgId,
          inspection_id: link.inspection_id,
          source: "report",
          engine_version: engine.engine_version,
          zone: engine.zone,
          zone_method: engine.zone_method,
          started_at: engine.started_at,
          ended_at: engine.ended_at,
          location_check: engine.location_check,
          vehicle_id: engine.vehicle_id,
          samsara_vehicle_id: engine.samsara_vehicle_id,
          outcome: engine.outcome,
          samsara_driver_id: engine.samsara_driver_id,
          samsara_driver_name: engine.samsara_driver_name,
          basis: engine.basis,
          confidence: engine.confidence,
          candidates: engine.candidates,
          driver_id: result.driverId,
          note: "Confirmed by the officer's report: its licence number is this driver's, and Samsara put them on the truck.",
        })
        .select("id")
        .single();
      if (error) { count("failed"); console.error(`[inspection-report] confirm ${link.document_id}: ${error.message}`); continue; }
      attributionId = data.id as string;
      await writeAudit(admin, {
        orgId,
        actorId: null,
        action: "roadside.attribution_confirmed_by_report",
        entity: "roadside_inspection",
        entityId: link.inspection_id,
        meta: { attributionId, documentId: link.document_id, readId: read.readId, driverId: result.driverId, checkVersion: REPORT_CHECK_VERSION },
      });
    }

    const { error } = await admin.from("inspection_report_checks").insert({
      ...base,
      outcome,
      reasons: result.reasons,
      name_on_report: result.nameOnReport,
      licence_last4: result.licenceLast4,
      driver_id: result.driverId,
      attribution_id: attributionId,
    });
    if (error) { count("failed"); console.error(`[inspection-report] check ${link.document_id}: ${error.message}`); continue; }
    count(outcome);
  }
  return tally;
}
