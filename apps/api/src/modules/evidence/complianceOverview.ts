import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildDqFile,
  canReadTestingRecords,
  dqAttention,
  dqGroups,
  dqDocumentCount,
  dqRosterCells,
  type DqAttentionItem,
  type DqCertInput,
  type DqDocumentInput,
  type DqGroupSummary,
  type DqItemState,
  type DqRecordInput,
  type DqDocumentCount,
  type DqRosterCell,
  type PaperThumb,
  type UserRole,
} from "@silvicom/shared";
import { medstopViolationsByDriver } from "../medstop/index.js";
import { fetchAllPaged } from "../../lib/paging.js";
import { NO_PAPERS, PAPER_DOC_COLUMNS, paperThumbsBySubject, type PaperDocRow } from "./paperThumbs.js";

/**
 * The fleet-wide qualification picture (DQ redesign, D-DQ6).
 *
 * A safety manager's morning question is "which qualification items need attention across my fleet", and
 * nothing in the product answered it: the roster was alphabetical with a comma-list of issues.
 *
 * COMPUTED SERVER-SIDE WITH THE SAME FUNCTION THE DRIVER PAGE USES. `buildDqFile` runs here per
 * driver exactly as it runs in the browser for one driver, so the queue and the file cannot disagree
 * about what is due — which is precisely what happens when urgency is computed twice.
 *
 * Four reads for the whole fleet rather than four per driver. A hundred-driver org is four queries,
 * not four hundred.
 */

/**
 * Bound on the qualification-record read. Reported, never silently applied — see `truncated`.
 *
 * ⚠ Until 2026-10-16 this was a `.limit(10_000)` on ONE request, and PostgREST answers at most 1,000
 * rows a request whatever the limit says: the 1,001st record would have been dropped and `truncated`
 * (which compares against 10,000) could never have said so. Every read below now pages
 * (`fetchAllPaged`), each in a stable order so a page boundary neither skips nor repeats a row. Sizes
 * then (production): 171 drivers, 375 certifications, 7 records, 2 documents — under the cap today,
 * but the certifications grow with every upload (DISPATCH-BOARD-V2-PLAN, DBV4's open item).
 */
const RECORD_CAP = 10_000;

export interface DriverOverview {
  driver_id: string;
  driver_name: string;
  driver_status: string;
  state: "not_started" | "incomplete" | "complete";
  counts: Record<DqItemState, number>;
  groups: DqGroupSummary[];
  /** Everything not `current`, worst first. The queue flattens these into one row each. */
  attention: DqAttentionItem[];
  /**
   * The roster's own columns (R4). Carried separately from `attention` because that list is a queue
   * of things to DO — it filters out `current` — and a roster column has to show a date for the
   * driver whose CDL is perfectly fine, which is most of them.
   */
  requirements: DqRosterCell[];
  /** Scans filed, out of the items that apply to this driver (R5). No extra query — see the helper. */
  documents: DqDocumentCount;
  /** The newest papers with signed thumbnails — only when `opts.withPapers` asked (UF4b). */
  papers?: PaperThumb[];
  paper_count?: number;
}

export interface ComplianceOverview {
  drivers: DriverOverview[];
  includesHazmat: boolean;
  /** True when the record read hit its cap, so the caller knows the picture is partial. */
  truncated: boolean;
}

interface DriverRow {
  id: string;
  full_name: string;
  status: string;
  cdl_number: string | null;
  return_to_duty_required: boolean | null;
}
interface CertRow {
  subject_id: string;
  kind: string;
  qualifier: string | null;
  training_type: string | null;
  issued_at: string | null;
  expires_at: string | null;
  document_id: string | null;
}
interface RecordRow {
  driver_id: string;
  kind: string;
  occurred_on: string;
  covers_until: string | null;
  document_id: string | null;
}
interface DocRow {
  id: string;
  subject_id: string;
  kind: string;
}
/**
 * The columns the documents read asks for. The engine needs three; the File cell's papers need the
 * thumbnail's path and the original's date and type as well — nine, the same nine the unit rollup
 * reads. The wider list is selected ONLY when a caller asked for papers, so the scheduler and the
 * digest keep the read they had.
 */
const ENGINE_DOC_COLUMNS = "id, subject_id, kind";

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

export async function getComplianceOverview(
  admin: SupabaseClient,
  orgId: string,
  today: string,
  /**
   * C2 (plan G30): the alert scheduler needs to SEE a 90-day-out item, and the default 30-day
   * horizon hides it — `dqAttention` only carries non-current items. ONLY the scheduler passes
   * this (91); the route, the driver page and the binder all stay on the default so the queue and
   * the file keep agreeing, which is this module's founding invariant.
   */
  opts: {
    expiringWithinDays?: number;
    /**
     * MS2 (MEDSTOP-PLAN §7A.15): driver id → the day of a Med-Stop positive or refusal holding them
     * (`medstopViolationsByDriver`). A §382.401(a) fact, so ONLY the route passes it, and only for a
     * reader `canReadTestingRecords` admits; the scheduler and the digest do not know their reader.
     */
    medstopViolations?: ReadonlyMap<string, string>;
    /**
     * UF4b (UNIT-FILES-PLAN D-UF7): the roster's File cell draws each driver's newest papers. Present
     * = read the papers, sign their thumbnails and carry them on every row; the function says which
     * KINDS this reader may see — the route builds it from the paper's section (`mayFile`, D-UF5)
     * and the restricted-kind rule (Phase G, `canReadRestrictedKind`), exactly as the documents list
     * does, so a dispatcher's roster never draws a drug test's scan. ONLY `GET /overview` passes
     * it. The alert scheduler, the digest and the dispatch board must not: they would sign a few
     * hundred URLs for a reader who will never open one.
     */
    withPapers?: (kind: string) => boolean;
    /** Q-WF4 (§9 P9): which papers' thumbnails this reader may be handed (`canSeePaperImage`). */
    imageVisible?: (kind: string) => boolean;
  } = {},
): Promise<ComplianceOverview> {
  const [drivers, certs, records, docs, hazmatRes] = await Promise.all([
    // Employed drivers only, and only real ones. A §391.51 obligation attaches to people who drive
    // for the carrier; terminated and deactivated rows kept flooding the queue as "not started"
    // files nobody was ever going to build, and EFS name-stubs (identity_source 'efs', 0204 / A6)
    // are payment identities that assert `active` with no employment behind them — a third of the
    // measured queue. Their records are retained and their file pages stay reachable — they just
    // leave the work queue.
    fetchAllPaged<DriverRow>((from, to) =>
      admin
        .from("drivers")
        .select("id, full_name, status, cdl_number, return_to_duty_required")
        .eq("org_id", orgId)
        .in("status", ["active", "on_leave"])
        .neq("identity_source", "efs")
        .order("full_name")
        .order("id")
        .range(from, to),
    ),
    fetchAllPaged<CertRow>((from, to) =>
      admin
        .from("certifications")
        .select("subject_id, kind, qualifier, training_type, issued_at, expires_at, document_id")
        .eq("org_id", orgId)
        .eq("subject_type", "driver")
        .is("superseded_by", null)
        .order("id")
        .range(from, to),
    ),
    // Newest first, stopping at the first page past the cap, so a capped read keeps the records that
    // decide a file today.
    fetchAllPaged<RecordRow>((from, to) =>
      from >= RECORD_CAP
        ? Promise.resolve({ data: [], error: null })
        : admin
            .from("qualification_records")
            .select("driver_id, kind, occurred_on, covers_until, document_id")
            .eq("org_id", orgId)
            .order("occurred_on", { ascending: false })
            .order("id")
            .range(from, to),
    ),
    fetchAllPaged<DocRow | PaperDocRow>((from, to) =>
      admin
        .from("documents")
        // The row type is named, not parsed: supabase-js cannot parse a column list it only knows as
        // one of two strings, and the table is untyped here anyway.
        .select<string, DocRow | PaperDocRow>(opts.withPapers ? PAPER_DOC_COLUMNS : ENGINE_DOC_COLUMNS)
        .eq("org_id", orgId)
        .eq("subject_type", "driver")
        .order("id")
        .range(from, to),
    ),
    admin.rpc("org_module_enabled", { p_org: orgId, p_module: "hazmatguard" }),
  ]);

  if (hazmatRes.error) throw new Error(hazmatRes.error.message);
  const includesHazmat = hazmatRes.data === true;

  const certsBy = groupBy(certs, (c) => c.subject_id);
  const recordsBy = groupBy(records, (r) => r.driver_id);
  const docsBy = groupBy(docs, (d) => d.subject_id);
  // Nothing is signed unless papers were asked for: `paperThumbsBySubject` is the only Storage call here.
  const papersBy = opts.withPapers ? await paperThumbsBySubject(admin, docs as PaperDocRow[], opts.withPapers, opts.imageVisible) : null;

  const out: DriverOverview[] = drivers.map((d) => {
    const file = buildDqFile({
      today,
      includeHazmat: includesHazmat,
      expiringWithinDays: opts.expiringWithinDays,
      // §391.51(b)(8) applies to non-CDL drivers only (D8) — derived from the D6-synced field.
      hasCdl: d.cdl_number != null && d.cdl_number !== "",
      // §40.25(j) (0237). Threaded here too, not only on the driver page, or the fleet queue would
      // report a file complete that the page beside it reports as missing a requirement.
      returnToDutyRequired: d.return_to_duty_required === true,
      returnToDutyViolationOn: opts.medstopViolations?.get(d.id) ?? null,
      certs: (certsBy.get(d.id) ?? []).map(toCert),
      records: (recordsBy.get(d.id) ?? []).map(toRecord),
      documents: (docsBy.get(d.id) ?? []).map((x): DqDocumentInput => ({ id: x.id, kind: x.kind })),
    });
    const row: DriverOverview = {
      driver_id: d.id,
      driver_name: d.full_name,
      driver_status: d.status,
      state: file.state,
      counts: file.counts,
      groups: dqGroups(file),
      attention: dqAttention(file, today),
      requirements: dqRosterCells(file, today),
      documents: dqDocumentCount(file),
    };
    if (papersBy) {
      const { papers, paperCount } = papersBy.get(d.id) ?? NO_PAPERS;
      row.papers = papers;
      row.paper_count = paperCount;
    }
    return row;
  });

  return { drivers: out, includesHazmat, truncated: records.length >= RECORD_CAP };
}

/**
 * The Med-Stop violations the overview may use for THIS reader (MEDSTOP-PLAN §7A.15): every one for a
 * reader `canReadTestingRecords` admits, and none — not even read — for anybody else. For the
 * dispatcher or recruiter beside them, a new "missing" item would itself state the result.
 */
export async function overviewViolationsFor(admin: SupabaseClient, orgId: string, role: UserRole | null | undefined): Promise<ReadonlyMap<string, string> | undefined> {
  return canReadTestingRecords(role) ? medstopViolationsByDriver(admin, orgId) : undefined;
}

const toCert = (c: CertRow): DqCertInput => ({
  kind: c.kind,
  qualifier: c.qualifier,
  trainingType: c.training_type,
  issuedAt: c.issued_at,
  expiresAt: c.expires_at,
  documentId: c.document_id,
});

const toRecord = (r: RecordRow): DqRecordInput => ({
  kind: r.kind,
  occurredOn: r.occurred_on,
  coversUntil: r.covers_until,
  documentId: r.document_id,
});
