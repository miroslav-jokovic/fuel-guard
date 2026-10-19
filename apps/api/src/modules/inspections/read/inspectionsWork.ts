import type { SupabaseClient } from "@supabase/supabase-js";
import {
  REPORT_CHECK_VERSION,
  roadsideNextSteps,
  roadsideWork,
  type AttributionSource,
  type CalendarDay,
  type RoadsideInspectionWorkDto,
  type RoadsideRepairCertificationDto,
  type RoadsideRepairDueDto,
} from "@silvicom/shared";
import { memberLabels } from "../../../lib/memberLabels.js";
import { listFiledDocuments } from "../../evidence/index.js";
import { REPORT_CHECK_COLS, reportCheckDtos, type ReportCheckRow } from "../report/readChecks.js";
import { ATTRIBUTION_COLS, attributionDto, decisionRow, namedIds, ref, rosterOf, type AttributionRow, type LatestAttribution, type Roster } from "./inspectionAttribution.js";
import { inspectionSms } from "./inspectionSms.js";
import { readRepairsDue } from "./repairsDue.js";
import { CITATION_ACTION_COLS, courtResultsFiled, newestActs, ticketsByInspection, type CitationActionRow } from "../citation/read.js";
import type { DbError } from "./inspectionsList.js";

/**
 * One line of work per inspection — the inbox's "Needs action" tab and its Next step, Driver and CSA points
 * columns (INSPECTION-CHALLENGE-PLAN Q-IC17, IC15; owner 2026-10-19).
 *
 * ── THE PAGE'S OWN BUILDERS, READ FOR MANY ─────────────────────────────────────────────────────
 * Every figure is the inspection page's: `attributionDto` and `reportCheckDtos` (the driver card),
 * `readRepairsDue` (the Repair card's rows, through `buildRepairs`), `inspectionSms` (the CSA points), and
 * `roadsideNextSteps` over them. Only the reads are batched — a hundred ids to an `.in()` (a long id list
 * overflows Node 22's request headers), and every growing table paged past PostgREST's 1,000.
 *
 * Measured 2026-10-19: 1,400 inspections, 2,763 violations, ~1,400 attribution rows, 150 repair units. The
 * whole record is a few dozen reads, so the inbox asks it for the period it shows and no more.
 */

const IN_CHUNK = 100;
const PAGE = 1000;
type Rows<T> = { data: T[]; error: DbError | null };

/** Every row of a query, paged. */
async function paged<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError | null }>): Promise<Rows<T>> {
  const data: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const r = await page(from, from + PAGE - 1);
    if (r.error) return { data, error: r.error };
    const rows = (r.data ?? []) as T[];
    data.push(...rows);
    if (rows.length < PAGE) return { data, error: null };
  }
}

/** The same query over ids a hundred at a time, each chunk paged. */
async function overIds<T>(ids: readonly string[], page: (chunk: string[], from: number, to: number) => PromiseLike<{ data: unknown; error: DbError | null }>): Promise<Rows<T>> {
  const data: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const r = await paged<T>((from, to) => page(chunk, from, to));
    if (r.error) return { data, error: r.error };
    data.push(...r.data);
  }
  return { data, error: null };
}

interface HeadRow {
  id: string;
  inspection_date: string | null;
  level: number | null;
  hazmat_placard_required: boolean | null;
  post_accident: boolean | null;
  raw: { mcmis_add_date: string | null } | null;
}
interface ViolationRow { id: string; inspection_id: string; viol_code: string | null; out_of_service: boolean | null; description: string | null; citation_number: string | null; category_id: number | null }
interface CitationRow { violation_id: string | null; citation_code: number | null; citation_result: string | null; adjseq: number | null }
type AttrRow = AttributionRow & { inspection_id: string };

/** The newest row of each source, per inspection. */
function latestOf(rows: readonly AttrRow[]): Map<string, LatestAttribution> {
  const out = new Map<string, LatestAttribution>();
  for (const r of rows) {
    const l = out.get(r.inspection_id) ?? { engine: null, person: null, report: null };
    const key = r.source as AttributionSource;
    const cur = l[key];
    if (!cur || r.created_at > cur.created_at) l[key] = r;
    out.set(r.inspection_id, l);
  }
  return out;
}

/** The roster rows these ids name, a hundred at a time. */
async function rosterFor(admin: SupabaseClient, orgId: string, samsara: string[], ids: string[]): Promise<Roster | { error: DbError }> {
  const out: Roster = { bySamsara: new Map(), byId: new Map() };
  const s = [...new Set(samsara)];
  const d = [...new Set(ids)];
  for (let i = 0; i < Math.max(s.length, d.length); i += IN_CHUNK) {
    const r = await rosterOf(admin, orgId, s.slice(i, i + IN_CHUNK), d.slice(i, i + IN_CHUNK));
    if ("error" in r) return r;
    for (const [k, v] of r.bySamsara) out.bySamsara.set(k, v);
    for (const [k, v] of r.byId) out.byId.set(k, v);
  }
  return out;
}

/** Each inspection's newest certification and whether it still stands over its units' newest rows. */
async function certificationsFor(
  admin: SupabaseClient,
  orgId: string,
  repairs: ReadonlyMap<string, RoadsideRepairDueDto[]>,
): Promise<Map<string, RoadsideRepairCertificationDto> | { error: DbError }> {
  type CertRow = { id: string; inspection_id: string; signer_name: string; signer_title: string; signed_on: string; repairs: { repairId: string }[]; document_id: string; created_at: string };
  const r = await overIds<CertRow>([...repairs.keys()], (chunk, from, to) =>
    admin.from("inspection_repair_certifications").select("id, inspection_id, signer_name, signer_title, signed_on, repairs, document_id, created_at")
      .eq("org_id", orgId).in("inspection_id", chunk).order("id").range(from, to),
  );
  if (r.error) return { error: r.error };
  const out = new Map<string, RoadsideRepairCertificationDto>();
  for (const c of [...r.data].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    // The same test as `readRepairCertification`: the certified rows are every unit's newest.
    const newest = (repairs.get(c.inspection_id) ?? []).map((u) => u.basedOn).sort();
    const certified = c.repairs.map((x) => x.repairId).sort();
    out.set(c.inspection_id, {
      id: c.id, signerName: c.signer_name, signerTitle: c.signer_title, signedOn: c.signed_on, certifiedAt: c.created_at,
      documentId: c.document_id, current: JSON.stringify(newest) === JSON.stringify(certified),
    });
  }
  return out;
}

/** The officer's reports of these inspections, as the driver card states them, grouped by inspection. */
async function reportsFor(admin: SupabaseClient, orgId: string, ids: readonly string[]) {
  const wanted = new Set(ids);
  const docs = (await listFiledDocuments(admin, orgId, { subjectType: "roadside_inspection", kind: "roadside_inspection_report" })).filter((d) => wanted.has(d.subjectId));
  const withDocs = [...new Set(docs.map((d) => d.subjectId))];
  const [links, checks] = await Promise.all([
    overIds<{ document_id: string }>(withDocs, (chunk, from, to) =>
      admin.from("inspection_report_reads").select("document_id").eq("org_id", orgId).in("inspection_id", chunk).order("document_id").range(from, to)),
    overIds<ReportCheckRow>(withDocs, (chunk, from, to) =>
      admin.from("inspection_report_checks").select(REPORT_CHECK_COLS).eq("org_id", orgId).in("inspection_id", chunk)
        .eq("check_version", REPORT_CHECK_VERSION).order("document_id").range(from, to)),
  ]);
  const failed = links.error ?? checks.error;
  if (failed) throw new Error(`report checks: ${failed.message}`);
  return { docs, linked: new Set(links.data.map((l) => l.document_id)), checks: new Map(checks.data.map((c) => [c.document_id, c])) };
}

export async function readInspectionsWork(
  admin: SupabaseClient,
  orgId: string,
  opts: { from: CalendarDay | null; to?: CalendarDay | null; today: CalendarDay },
): Promise<RoadsideInspectionWorkDto[] | { error: DbError }> {
  const heads = await paged<HeadRow>((from, to) => {
    let q = admin.from("roadside_inspections")
      .select("id, inspection_date, level, hazmat_placard_required, post_accident, raw:fmcsa_raw_rows(mcmis_add_date:payload->>mcmis_add_date)")
      .eq("org_id", orgId).is("vanished_at", null);
    if (opts.from) q = q.gte("inspection_date", opts.from);
    if (opts.to) q = q.lte("inspection_date", opts.to);
    return q.order("id").range(from, to);
  });
  if (heads.error) return { error: heads.error };
  const ids = heads.data.map((h) => h.id);
  if (ids.length === 0) return [];

  const [violations, citations, attributions, acts, due] = await Promise.all([
    overIds<ViolationRow>(ids, (c, f, t) => admin.from("roadside_violations").select("id, inspection_id, viol_code, out_of_service, description, citation_number, category_id")
      .eq("org_id", orgId).in("inspection_id", c).is("vanished_at", null).order("id").range(f, t)),
    overIds<CitationRow>(ids, (c, f, t) => admin.from("roadside_citations").select("violation_id, citation_code, citation_result, adjseq")
      .eq("org_id", orgId).in("inspection_id", c).is("vanished_at", null).order("id").range(f, t)),
    overIds<AttrRow>(ids, (c, f, t) => admin.from("inspection_attributions").select(`${ATTRIBUTION_COLS}, inspection_id`)
      .eq("org_id", orgId).in("inspection_id", c).order("id").range(f, t)),
    overIds<CitationActionRow>(ids, (c, f, t) => admin.from("inspection_citation_actions").select(CITATION_ACTION_COLS)
      .eq("org_id", orgId).in("inspection_id", c).order("id").range(f, t)),
    readRepairsDue(admin, orgId, opts.today),
  ]);
  const failed = violations.error ?? citations.error ?? attributions.error ?? acts.error;
  if (failed) return { error: failed };
  if ("error" in due) return due;

  const repairsOf = new Map<string, RoadsideRepairDueDto[]>();
  for (const r of due) repairsOf.set(r.inspection.id, [...(repairsOf.get(r.inspection.id) ?? []), r]);
  const certs = await certificationsFor(admin, orgId, repairsOf);
  if ("error" in certs) return certs;

  // A report read that fails leaves every driver card's reports empty rather than the inbox unread — the
  // page makes the same choice (`readInspectionAttribution`).
  const reports = await reportsFor(admin, orgId, ids).catch((e: unknown) => {
    console.error(`[inspection-report] org ${orgId}: report checks unread for the inbox —`, e instanceof Error ? e.message : e);
    return { docs: [], linked: new Set<string>(), checks: new Map<string, ReportCheckRow>() };
  });

  const latest = latestOf(attributions.data);
  const samsara: string[] = [];
  const rosterIds = [...reports.checks.values()].flatMap((c) => (c.driver_id ? [c.driver_id] : []));
  const deciders: string[] = acts.data.map((a) => a.acted_by);
  for (const l of latest.values()) {
    const n = namedIds(l);
    samsara.push(...n.samsara);
    rosterIds.push(...n.roster);
    const d = decisionRow(l)?.decided_by;
    if (d) deciders.push(d);
  }
  const [roster, labels] = await Promise.all([rosterFor(admin, orgId, samsara, rosterIds), memberLabels(admin, orgId, [...new Set(deciders)])]);
  if ("error" in roster) return roster;

  const violationsOf = new Map<string, ViolationRow[]>();
  for (const v of violations.data) violationsOf.set(v.inspection_id, [...(violationsOf.get(v.inspection_id) ?? []), v]);
  // The adjudication SMS reads is the latest FMCSA holds, as on the page.
  const citationCode = new Map<string, number>();
  for (const c of [...citations.data].sort((a, b) => (a.adjseq ?? 0) - (b.adjseq ?? 0))) {
    if (c.violation_id && c.citation_code != null) citationCode.set(c.violation_id, c.citation_code);
  }
  const ticketsOf = ticketsByInspection(violations.data, citations.data, newestActs(acts.data), labels);
  const filed = ticketsOf.size ? await courtResultsFiled(admin, orgId) : new Set<string>();
  const docsOf = new Map<string, { id: string }[]>();
  for (const d of reports.docs) docsOf.set(d.subjectId, [...(docsOf.get(d.subjectId) ?? []), d]);
  const empty: LatestAttribution = { engine: null, person: null, report: null };

  return heads.data.map((h) => {
    const attribution = attributionDto(
      latest.get(h.id) ?? empty,
      roster,
      labels,
      reportCheckDtos(docsOf.get(h.id) ?? [], reports.linked, reports.checks, (id) => ref(roster.byId.get(id))),
    );
    const steps = roadsideNextSteps({
      attribution,
      inspectionDate: h.inspection_date,
      repairs: repairsOf.get(h.id) ?? [],
      certification: certs.get(h.id) ?? null,
      citations: { tickets: ticketsOf.get(h.id) ?? [], courtResultFiled: filed.has(h.id) },
      today: opts.today,
    });
    const sms = inspectionSms(
      {
        id: h.id, date: h.inspection_date, level: h.level, hazmatPlacard: h.hazmat_placard_required, postAccident: h.post_accident,
        mcmisAddDate: h.raw?.mcmis_add_date ?? null,
        violations: (violationsOf.get(h.id) ?? []).map((v) => ({ id: v.id, code: v.viol_code, outOfService: v.out_of_service, citationCode: citationCode.get(v.id) ?? null })),
      },
      opts.today,
    );
    return roadsideWork(h.id, steps, attribution, sms, (violationsOf.get(h.id) ?? []).map((v) => v.category_id));
  });
}
