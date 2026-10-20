import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isTicket,
  type CalendarDay,
  type CitationAction,
  type CourtOutcomeCode,
  type RoadsideCitationDto,
  type RoadsideInspectionCitationsDto,
} from "@silvicom/shared";
import { labelOf, memberLabels } from "../../../lib/memberLabels.js";
import { listFiledDocuments } from "../../evidence/index.js";
import type { DbError } from "../read/inspectionsList.js";

/**
 * The tickets of roadside inspections and where each stands (IC4, R-ADJ1/R-ADJ2): the violation's citation number,
 * the court's results on FMCSA's feed, the office's newest act (0489), and what the court decided and the DataQs
 * request over it (0495). One builder for the inspection page's Tickets card and the inbox's line of work
 * (`inspectionsWork.ts`), so the two cannot disagree.
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

export interface DispositionRow {
  id: string;
  inspection_id: string;
  violation_id: string;
  document_id: string;
  outcome_code: CourtOutcomeCode;
  amended_charge: string | null;
  court_name: string;
  decided_on: CalendarDay;
  note: string | null;
  recorded_by: string;
  created_at: string;
}
export const DISPOSITION_COLS = "id, inspection_id, violation_id, document_id, outcome_code, amended_charge, court_name, decided_on, note, recorded_by, created_at";

export interface DataqsCaseRow {
  id: string;
  inspection_id: string;
  violation_id: string;
  disposition_id: string;
  state: "approved" | "filed";
  narrative: string;
  attribution_id: string;
  attested_by: string;
  attested_at: string;
  rdr_number: string | null;
  filed_on: CalendarDay | null;
  created_at: string;
}
export const DATAQS_CASE_COLS = "id, inspection_id, violation_id, disposition_id, state, narrative, attribution_id, attested_by, attested_at, rdr_number, filed_on, created_at";

/** The newest row per violation — every record here is append-only, and its newest row is the state. */
export function newestActs<R extends { id: string; violation_id: string; created_at: string }>(rows: readonly R[]): Map<string, R> {
  const out = new Map<string, R>();
  for (const r of rows) {
    const cur = out.get(r.violation_id);
    if (!cur || r.created_at > cur.created_at || (r.created_at === cur.created_at && r.id > cur.id)) out.set(r.violation_id, r);
  }
  return out;
}

export interface CourtRecords {
  dispositions: ReadonlyMap<string, DispositionRow>;
  cases: ReadonlyMap<string, DataqsCaseRow>;
}
export const NO_COURT_RECORDS: CourtRecords = { dispositions: new Map(), cases: new Map() };

/** Everyone a ticket names: the office's actors, the dispositions' recorders, the requests' attesters. */
export function courtPeople(acts: readonly CitationActionRow[], court: CourtRecords): string[] {
  return [...acts.map((a) => a.acted_by), ...[...court.dispositions.values()].map((d) => d.recorded_by), ...[...court.cases.values()].map((c) => c.attested_by)];
}

/** The ticket DTOs of the given violations, grouped by inspection. Pure; `labels` names the people who acted. */
export function ticketsByInspection(
  violations: readonly TicketViolationRow[],
  results: readonly CourtResultRow[],
  acts: ReadonlyMap<string, CitationActionRow>,
  labels: Awaited<ReturnType<typeof memberLabels>>,
  court: CourtRecords = NO_COURT_RECORDS,
): Map<string, RoadsideCitationDto[]> {
  const resultsOf = new Map<string, string[]>();
  for (const c of [...results].sort((a, b) => (a.adjseq ?? 0) - (b.adjseq ?? 0))) {
    if (c.violation_id && c.citation_result) resultsOf.set(c.violation_id, [...(resultsOf.get(c.violation_id) ?? []), c.citation_result]);
  }
  const out = new Map<string, RoadsideCitationDto[]>();
  for (const v of violations) {
    if (!isTicket(v.citation_number)) continue;
    const a = acts.get(v.id);
    const d = court.dispositions.get(v.id);
    const c = court.cases.get(v.id);
    const dto: RoadsideCitationDto = {
      violationId: v.id,
      code: v.viol_code,
      description: v.description,
      citationNumber: v.citation_number!.trim(),
      courtResults: resultsOf.get(v.id) ?? [],
      action: a
        ? { id: a.id, kind: a.action, followUpOn: a.follow_up_on, note: a.note, actedBy: labelOf(labels.get(a.acted_by)), actedAt: a.created_at }
        : null,
      disposition: d
        ? {
            id: d.id, outcomeCode: d.outcome_code, amendedCharge: d.amended_charge, courtName: d.court_name, decidedOn: d.decided_on,
            documentId: d.document_id, note: d.note, recordedBy: labelOf(labels.get(d.recorded_by)), recordedAt: d.created_at,
          }
        : null,
      dataqsCase: c
        ? {
            id: c.id, state: c.state, dispositionId: c.disposition_id, narrative: c.narrative, attestedBy: labelOf(labels.get(c.attested_by)),
            attestedAt: c.attested_at, rdrNumber: c.rdr_number, filedOn: c.filed_on,
          }
        : null,
    };
    out.set(v.inspection_id, [...(out.get(v.inspection_id) ?? []), dto]);
  }
  return out;
}

/**
 * The newest disposition and DataQs request of each ticket, of one inspection or of the given ones. A failure is
 * logged and read as none, so the inbox and the page still draw: on staging this read can meet the code before
 * 0495 is applied (`check-migration-ordering.mjs`'s window), and the tickets themselves are 0489's.
 */
export async function readCourtRecords(admin: SupabaseClient, orgId: string, inspectionIds: readonly string[]): Promise<CourtRecords> {
  if (!inspectionIds.length) return NO_COURT_RECORDS;
  try {
    const dispositions: DispositionRow[] = [];
    const cases: DataqsCaseRow[] = [];
    // Chunked: a long `.in()` list overflows Node's header limit ("fetch failed"), and the inbox asks for 1,390.
    for (let i = 0; i < inspectionIds.length; i += 200) {
      const chunk = inspectionIds.slice(i, i + 200);
      const [d, c] = await Promise.all([
        admin.from("inspection_citation_dispositions").select(DISPOSITION_COLS).eq("org_id", orgId).in("inspection_id", chunk),
        admin.from("dataqs_cases").select(DATAQS_CASE_COLS).eq("org_id", orgId).in("inspection_id", chunk),
      ]);
      if (d.error) throw new Error(`dispositions: ${d.error.message}`);
      if (c.error) throw new Error(`dataqs cases: ${c.error.message}`);
      dispositions.push(...((d.data ?? []) as DispositionRow[]));
      cases.push(...((c.data ?? []) as DataqsCaseRow[]));
    }
    return { dispositions: newestActs(dispositions), cases: newestActs(cases) };
  } catch (e) {
    console.error(`[roadside-citations] org ${orgId}: court records unread —`, e instanceof Error ? e.message : e);
    return NO_COURT_RECORDS;
  }
}

/** The court result papers filed on inspections, oldest first, by inspection. */
export async function courtPapersFiled(admin: SupabaseClient, orgId: string, inspectionId?: string): Promise<Map<string, { id: string; filedAt: string }[]>> {
  const docs = await listFiledDocuments(admin, orgId, { subjectType: "roadside_inspection", kind: "court_disposition", ...(inspectionId ? { subjectId: inspectionId } : {}) });
  const out = new Map<string, { id: string; filedAt: string }[]>();
  for (const d of docs) out.set(d.subjectId, [...(out.get(d.subjectId) ?? []), { id: d.id, filedAt: d.createdAt }]);
  return out;
}

/** One inspection's tickets, for its page. */
export async function readInspectionCitations(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
): Promise<RoadsideInspectionCitationsDto | { error: DbError }> {
  const [violations, results, acts, head, org] = await Promise.all([
    admin.from("roadside_violations").select("id, inspection_id, viol_code, description, citation_number")
      .eq("org_id", orgId).eq("inspection_id", inspectionId).is("vanished_at", null).not("citation_number", "is", null).order("seq_no"),
    admin.from("roadside_citations").select("violation_id, citation_result, adjseq").eq("org_id", orgId).eq("inspection_id", inspectionId).is("vanished_at", null),
    admin.from("inspection_citation_actions").select(CITATION_ACTION_COLS).eq("org_id", orgId).eq("inspection_id", inspectionId),
    admin.from("roadside_inspections").select("report_number, report_state, inspection_date").eq("org_id", orgId).eq("id", inspectionId).maybeSingle(),
    admin.from("organizations").select("name, dot_number").eq("id", orgId).maybeSingle(),
  ]);
  for (const r of [violations, results, acts, head, org]) if (r.error) return { error: r.error };
  const actRows = (acts.data ?? []) as CitationActionRow[];
  const court = await readCourtRecords(admin, orgId, [inspectionId]);
  const labels = await memberLabels(admin, orgId, [...new Set(courtPeople(actRows, court))]);
  const tickets = ticketsByInspection((violations.data ?? []) as TicketViolationRow[], (results.data ?? []) as CourtResultRow[], newestActs(actRows), labels, court)
    .get(inspectionId) ?? [];
  const h = head.data as { report_number: string | null; report_state: string | null; inspection_date: CalendarDay | null } | null;
  const o = org.data as { name: string; dot_number: string | null } | null;
  return {
    tickets,
    courtPapers: tickets.length ? ((await courtPapersFiled(admin, orgId, inspectionId)).get(inspectionId) ?? []) : [],
    filing: {
      carrierName: o?.name ?? "",
      usdotNumber: o?.dot_number ?? null,
      reportState: h?.report_state ?? null,
      reportNumber: h?.report_number ?? null,
      inspectionDate: h?.inspection_date ?? null,
    },
  };
}
