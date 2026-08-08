import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildDqFile,
  dqAttention,
  dqGroups,
  type DqAttentionItem,
  type DqCertInput,
  type DqDocumentInput,
  type DqGroupSummary,
  type DqItemState,
  type DqRecordInput,
} from "@fuelguard/shared";

/**
 * The fleet-wide qualification picture (DQ redesign, D-DQ6).
 *
 * A safety manager's morning question is "what expires in the next thirty days across my fleet", and
 * nothing in the product answered it: the roster was alphabetical with a comma-list of issues.
 *
 * COMPUTED SERVER-SIDE WITH THE SAME FUNCTION THE DRIVER PAGE USES. `buildDqFile` runs here per
 * driver exactly as it runs in the browser for one driver, so the queue and the file cannot disagree
 * about what is due — which is precisely what happens when urgency is computed twice.
 *
 * Four reads for the whole fleet rather than four per driver. A hundred-driver org is four queries,
 * not four hundred.
 */

/** Bound on the qualification-record read. Reported, never silently applied — see `truncated`. */
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
}

export interface ComplianceOverview {
  drivers: DriverOverview[];
  includesHazmat: boolean;
  /** True when the record read hit its cap, so the caller knows the picture is partial. */
  truncated: boolean;
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
): Promise<ComplianceOverview> {
  const [driversRes, certsRes, recordsRes, docsRes, hazmatRes] = await Promise.all([
    admin.from("drivers").select("id, full_name, status").eq("org_id", orgId).order("full_name"),
    admin
      .from("certifications")
      .select("subject_id, kind, qualifier, training_type, issued_at, expires_at, document_id")
      .eq("org_id", orgId)
      .eq("subject_type", "driver")
      .is("superseded_by", null),
    admin
      .from("qualification_records")
      .select("driver_id, kind, occurred_on, covers_until, document_id")
      .eq("org_id", orgId)
      .order("occurred_on", { ascending: false })
      .limit(RECORD_CAP),
    admin
      .from("documents")
      .select("id, subject_id, kind")
      .eq("org_id", orgId)
      .eq("subject_type", "driver"),
    admin.rpc("org_module_enabled", { p_org: orgId, p_module: "hazmatguard" }),
  ]);

  const failed = [driversRes, certsRes, recordsRes, docsRes, hazmatRes].find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);

  const drivers = (driversRes.data ?? []) as unknown as {
    id: string;
    full_name: string;
    status: string;
  }[];
  const certs = (certsRes.data ?? []) as unknown as CertRow[];
  const records = (recordsRes.data ?? []) as unknown as RecordRow[];
  const docs = (docsRes.data ?? []) as unknown as DocRow[];
  const includesHazmat = hazmatRes.data === true;

  const certsBy = groupBy(certs, (c) => c.subject_id);
  const recordsBy = groupBy(records, (r) => r.driver_id);
  const docsBy = groupBy(docs, (d) => d.subject_id);

  const out: DriverOverview[] = drivers.map((d) => {
    const file = buildDqFile({
      today,
      includeHazmat: includesHazmat,
      certs: (certsBy.get(d.id) ?? []).map(toCert),
      records: (recordsBy.get(d.id) ?? []).map(toRecord),
      documents: (docsBy.get(d.id) ?? []).map((x): DqDocumentInput => ({ id: x.id, kind: x.kind })),
    });
    return {
      driver_id: d.id,
      driver_name: d.full_name,
      driver_status: d.status,
      state: file.state,
      counts: file.counts,
      groups: dqGroups(file),
      attention: dqAttention(file, today),
    };
  });

  return { drivers: out, includesHazmat, truncated: records.length >= RECORD_CAP };
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
