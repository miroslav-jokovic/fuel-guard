import type { SupabaseClient } from "@supabase/supabase-js";
import {
  REPORT_CHECK_REASONS,
  REPORT_CHECK_VERSION,
  type AttributionDriverRefDto,
  type ReportCheckOutcome,
  type ReportCheckReason,
  type RoadsideReportCheckDto,
} from "@silvicom/shared";
import { listFiledDocuments } from "../../evidence/index.js";

/**
 * Each officer's report filed on one inspection, and what its check found (IC10), for the driver card.
 *
 *   no hand-over yet          → `waiting_for_file` (the hourly pass has not reached it, or the file has not arrived)
 *   handed over, not checked  → `reading`
 *   checked `unreadable`      → `read_failed`
 *   checked                   → `checked`, with its outcome and reasons
 *
 * Only checks at the current `REPORT_CHECK_VERSION`: an older version's verdict is history, and a report
 * re-checked under a new rule reads `reading` until the new check lands.
 */
export async function readReportChecks(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
  driverRef: (id: string) => Promise<AttributionDriverRefDto | null>,
): Promise<RoadsideReportCheckDto[]> {
  const docs = await listFiledDocuments(admin, orgId, { subjectType: "roadside_inspection", kind: "roadside_inspection_report", subjectId: inspectionId });
  if (docs.length === 0) return [];
  const [links, checks] = await Promise.all([
    admin.from("inspection_report_reads").select("document_id").eq("org_id", orgId).eq("inspection_id", inspectionId),
    admin
      .from("inspection_report_checks")
      .select("document_id, outcome, reasons, name_on_report, licence_last4, driver_id, created_at")
      .eq("org_id", orgId)
      .eq("inspection_id", inspectionId)
      .eq("check_version", REPORT_CHECK_VERSION),
  ]);
  if (links.error) throw new Error(`inspection_report_reads: ${links.error.message}`);
  if (checks.error) throw new Error(`inspection_report_checks: ${checks.error.message}`);
  const linked = new Set(((links.data ?? []) as { document_id: string }[]).map((l) => l.document_id));
  type CheckRow = {
    document_id: string;
    outcome: ReportCheckOutcome;
    reasons: ReportCheckReason[];
    name_on_report: string | null;
    licence_last4: string | null;
    driver_id: string | null;
    created_at: string;
  };
  const byDoc = new Map(((checks.data ?? []) as CheckRow[]).map((c) => [c.document_id, c]));

  return Promise.all(
    docs.map(async (d): Promise<RoadsideReportCheckDto> => {
      const c = byDoc.get(d.id);
      const empty = { documentId: d.id, outcome: null, reasons: [], nameOnReport: null, licenceLast4: null, driver: null, checkedAt: null };
      if (!c) return { ...empty, state: linked.has(d.id) ? "reading" : "waiting_for_file" };
      if (c.outcome === "unreadable") return { ...empty, state: "read_failed", outcome: "unreadable", checkedAt: c.created_at };
      return {
        documentId: d.id,
        state: "checked",
        outcome: c.outcome,
        // A reason this build has no sentence for (a newer check version's) is left out rather than shown as a code.
        reasons: c.reasons.filter((r) => r in REPORT_CHECK_REASONS).map((code) => ({ code, text: REPORT_CHECK_REASONS[code] })),
        nameOnReport: c.name_on_report,
        licenceLast4: c.licence_last4,
        driver: c.driver_id ? await driverRef(c.driver_id) : null,
        checkedAt: c.created_at,
      };
    }),
  );
}
