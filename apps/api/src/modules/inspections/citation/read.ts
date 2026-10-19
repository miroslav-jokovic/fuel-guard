import type { SupabaseClient } from "@supabase/supabase-js";
import { isTicket, type CitationAction, type RoadsideCitationDto } from "@silvicom/shared";
import { labelOf, memberLabels } from "../../../lib/memberLabels.js";
import { listFiledDocuments } from "../../evidence/index.js";
import type { DbError } from "../read/inspectionsList.js";

/**
 * The tickets of roadside inspections and where each stands (IC4, R-ADJ1): the violation's citation number, the
 * court's results on FMCSA's feed, and the office's newest act (0489). One builder for the inspection page's
 * Tickets card and the inbox's line of work (`inspectionsWork.ts`), so the two cannot disagree.
 */

export interface TicketViolationRow { id: string; inspection_id: string; viol_code: string | null; description: string | null; citation_number: string | null }
export interface CourtResultRow { violation_id: string | null; citation_result: string | null; adjseq: number | null }
export interface CitationActionRow {
  id: string;
  inspection_id: string;
  violation_id: string;
  action: CitationAction;
  follow_up_on: string | null;
  note: string | null;
  acted_by: string;
  created_at: string;
}
export const CITATION_ACTION_COLS = "id, inspection_id, violation_id, action, follow_up_on, note, acted_by, created_at";

/** The newest act per violation. */
export function newestActs(rows: readonly CitationActionRow[]): Map<string, CitationActionRow> {
  const out = new Map<string, CitationActionRow>();
  for (const r of rows) {
    const cur = out.get(r.violation_id);
    if (!cur || r.created_at > cur.created_at || (r.created_at === cur.created_at && r.id > cur.id)) out.set(r.violation_id, r);
  }
  return out;
}

/** The ticket DTOs of the given violations, grouped by inspection. Pure; `labels` names the people who acted. */
export function ticketsByInspection(
  violations: readonly TicketViolationRow[],
  results: readonly CourtResultRow[],
  acts: ReadonlyMap<string, CitationActionRow>,
  labels: Awaited<ReturnType<typeof memberLabels>>,
): Map<string, RoadsideCitationDto[]> {
  const resultsOf = new Map<string, string[]>();
  for (const c of [...results].sort((a, b) => (a.adjseq ?? 0) - (b.adjseq ?? 0))) {
    if (c.violation_id && c.citation_result) resultsOf.set(c.violation_id, [...(resultsOf.get(c.violation_id) ?? []), c.citation_result]);
  }
  const out = new Map<string, RoadsideCitationDto[]>();
  for (const v of violations) {
    if (!isTicket(v.citation_number)) continue;
    const a = acts.get(v.id);
    const dto: RoadsideCitationDto = {
      violationId: v.id,
      code: v.viol_code,
      description: v.description,
      citationNumber: v.citation_number!.trim(),
      courtResults: resultsOf.get(v.id) ?? [],
      action: a
        ? { id: a.id, kind: a.action, followUpOn: a.follow_up_on, note: a.note, actedBy: labelOf(labels.get(a.acted_by)), actedAt: a.created_at }
        : null,
    };
    out.set(v.inspection_id, [...(out.get(v.inspection_id) ?? []), dto]);
  }
  return out;
}

/** The inspection ids, of those asked, with a court result document filed on them. */
export async function courtResultsFiled(admin: SupabaseClient, orgId: string, inspectionId?: string): Promise<Set<string>> {
  const docs = await listFiledDocuments(admin, orgId, { subjectType: "roadside_inspection", kind: "court_disposition", ...(inspectionId ? { subjectId: inspectionId } : {}) });
  return new Set(docs.map((d) => d.subjectId));
}

/** One inspection's tickets, for its page. */
export async function readInspectionCitations(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
): Promise<{ tickets: RoadsideCitationDto[]; courtResultFiled: boolean } | { error: DbError }> {
  const [violations, results, acts] = await Promise.all([
    admin.from("roadside_violations").select("id, inspection_id, viol_code, description, citation_number")
      .eq("org_id", orgId).eq("inspection_id", inspectionId).is("vanished_at", null).not("citation_number", "is", null).order("seq_no"),
    admin.from("roadside_citations").select("violation_id, citation_result, adjseq").eq("org_id", orgId).eq("inspection_id", inspectionId).is("vanished_at", null),
    admin.from("inspection_citation_actions").select(CITATION_ACTION_COLS).eq("org_id", orgId).eq("inspection_id", inspectionId),
  ]);
  for (const r of [violations, results, acts]) if (r.error) return { error: r.error };
  const actRows = (acts.data ?? []) as CitationActionRow[];
  const labels = await memberLabels(admin, orgId, [...new Set(actRows.map((a) => a.acted_by))]);
  const tickets = ticketsByInspection((violations.data ?? []) as TicketViolationRow[], (results.data ?? []) as CourtResultRow[], newestActs(actRows), labels).get(inspectionId) ?? [];
  return { tickets, courtResultFiled: tickets.length > 0 && (await courtResultsFiled(admin, orgId, inspectionId)).has(inspectionId) };
}
