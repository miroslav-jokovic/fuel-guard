import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildDqFile,
  dqGroups,
  type DqCertInput,
  type DqDocumentInput,
  type DqFileSummary,
  type DqGroupSummary,
  type DqRecordInput,
} from "@fuelguard/shared";

/**
 * Everything a binder renders, read before a single page is drawn (DQ-BINDER-PLAN §3).
 *
 * Separate from rendering for the reason `defensePacket.ts` separates them: the gather is testable
 * without pdfkit, and a data problem surfaces as a data problem rather than as a broken PDF.
 *
 * READS THE SAME FUNCTION THE SCREEN READS. `buildDqFile` runs here exactly as it runs in the browser
 * and in `complianceOverview.ts`. The binder therefore cannot disagree with the page the safety
 * manager was looking at when they requested it — which is the failure the auditor would find first.
 */

export interface BinderCarrier {
  name: string;
  dotNumber: string | null;
}

export interface BinderDriver {
  id: string;
  name: string;
  employeeId: string | null;
  hireDate: string | null;
  terminationDate: string | null;
  status: string;
}

/** A certification as the history section prints it — including the superseded ones. */
export interface BinderCertHistoryRow {
  kind: string;
  qualifier: string | null;
  trainingType: string | null;
  identifier: string | null;
  issuingAuthority: string | null;
  issuedAt: string | null;
  effectiveFrom: string;
  expiresAt: string | null;
  supersededAt: string | null;
  current: boolean;
  documentId: string | null;
}

/** A §391.51 event as the log prints it. `result` is deliberately absent — see D-BD6. */
export interface BinderEventRow {
  kind: string;
  occurredOn: string;
  coversUntil: string | null;
  performedBy: string | null;
  reference: string | null;
  documentId: string | null;
}

export interface BinderDocumentRef {
  id: string;
  kind: string;
  storagePath: string;
  contentType: string;
  bytes: number | null;
  sha256: string;
  createdAt: string;
}

export interface DriverBinderData {
  driver: BinderDriver;
  file: DqFileSummary;
  groups: DqGroupSummary[];
  certHistory: BinderCertHistoryRow[];
  events: BinderEventRow[];
  /** Every document filed for this driver, by id — the render walks requirements and looks them up. */
  documentsById: Map<string, BinderDocumentRef>;
}

interface CertRow {
  kind: string;
  qualifier: string | null;
  training_type: string | null;
  identifier: string | null;
  issuing_authority: string | null;
  issued_at: string | null;
  effective_from: string;
  expires_at: string | null;
  superseded_by: string | null;
  superseded_at: string | null;
  document_id: string | null;
}

interface RecordRow {
  driver_id: string;
  kind: string;
  occurred_on: string;
  covers_until: string | null;
  performed_by: string | null;
  reference: string | null;
  document_id: string | null;
}

interface DocRow {
  id: string;
  subject_id: string;
  kind: string;
  storage_path: string;
  content_type: string;
  bytes: number | null;
  sha256: string;
  created_at: string;
}

interface DriverRow {
  id: string;
  full_name: string;
  employee_id: string | null;
  hire_date: string | null;
  termination_date: string | null;
  status: string;
}

export class BinderGatherError extends Error {}

export async function gatherCarrier(admin: SupabaseClient, orgId: string): Promise<BinderCarrier> {
  const { data, error } = await admin
    .from("organizations")
    .select("name, dot_number")
    .eq("id", orgId)
    .single();
  if (error) throw new BinderGatherError(error.message);
  const row = data as unknown as { name: string; dot_number: string | null };
  return { name: row.name, dotNumber: row.dot_number };
}

export async function hazmatEnabled(admin: SupabaseClient, orgId: string): Promise<boolean> {
  const { data } = await admin.rpc("org_module_enabled", { p_org: orgId, p_module: "hazmatguard" });
  return data === true;
}

/**
 * Gather the whole sample in four reads rather than four per driver, then split it per driver.
 *
 * ORDER IS THE CALLER'S, NOT THE DATABASE'S. The auditor hands over a list and then checks the
 * binder against it; returning the sample alphabetically would make them re-find each name. Ids that
 * do not resolve inside this org are dropped here and REPORTED by the caller — never silently, which
 * would produce a fourteen-driver binder in answer to a fifteen-driver request.
 */
export async function gatherSample(
  admin: SupabaseClient,
  orgId: string,
  driverIds: string[],
  asAt: string,
  includeHazmat: boolean,
): Promise<{ drivers: DriverBinderData[]; missingIds: string[] }> {
  const [driversRes, certsRes, recordsRes, docsRes] = await Promise.all([
    admin
      .from("drivers")
      .select("id, full_name, employee_id, hire_date, termination_date, status")
      .eq("org_id", orgId)
      .in("id", driverIds),
    admin
      .from("certifications")
      .select(
        "subject_id, kind, qualifier, training_type, identifier, issuing_authority, issued_at, effective_from, expires_at, superseded_by, superseded_at, document_id",
      )
      .eq("org_id", orgId)
      .eq("subject_type", "driver")
      .in("subject_id", driverIds)
      .order("effective_from", { ascending: false }),
    admin
      .from("qualification_records")
      .select("driver_id, kind, occurred_on, covers_until, performed_by, reference, document_id")
      .eq("org_id", orgId)
      .in("driver_id", driverIds)
      .order("occurred_on", { ascending: false }),
    admin
      .from("documents")
      .select("id, subject_id, kind, storage_path, content_type, bytes, sha256, created_at")
      .eq("org_id", orgId)
      .eq("subject_type", "driver")
      .in("subject_id", driverIds),
  ]);

  const failed = [driversRes, certsRes, recordsRes, docsRes].find((r) => r.error);
  if (failed?.error) throw new BinderGatherError(failed.error.message);

  const driverRows = (driversRes.data ?? []) as unknown as DriverRow[];
  const byId = new Map(driverRows.map((d) => [d.id, d]));
  const missingIds = driverIds.filter((id) => !byId.has(id));

  const certs = (certsRes.data ?? []) as unknown as Array<CertRow & { subject_id: string }>;
  const records = (recordsRes.data ?? []) as unknown as RecordRow[];
  const docs = (docsRes.data ?? []) as unknown as DocRow[];

  const drivers = driverIds
    .map((id) => byId.get(id))
    .filter((d): d is DriverRow => Boolean(d))
    .map((d) => {
      const myCerts = certs.filter((c) => c.subject_id === d.id);
      const myRecords = records.filter((r) => r.driver_id === d.id);
      const myDocs = docs.filter((x) => x.subject_id === d.id);
      // The checklist judges CURRENT evidence only — a superseded medical card does not qualify
      // anybody. The full chain is printed further down the binder, which is where history belongs.
      const currentCerts = myCerts.filter((c) => c.superseded_by == null);

      const file = buildDqFile({
        today: asAt,
        includeHazmat,
        certs: currentCerts.map(toCertInput),
        records: myRecords.map(toRecordInput),
        documents: myDocs.map((x): DqDocumentInput => ({ id: x.id, kind: x.kind })),
      });

      return {
        driver: {
          id: d.id,
          name: d.full_name,
          employeeId: d.employee_id,
          hireDate: d.hire_date,
          terminationDate: d.termination_date,
          status: d.status,
        },
        file,
        groups: dqGroups(file),
        certHistory: myCerts.map(toHistoryRow),
        events: myRecords.map(toEventRow),
        documentsById: new Map(myDocs.map((x) => [x.id, toDocumentRef(x)])),
      } satisfies DriverBinderData;
    });

  return { drivers, missingIds };
}

const toCertInput = (c: CertRow): DqCertInput => ({
  kind: c.kind,
  qualifier: c.qualifier,
  trainingType: c.training_type,
  issuedAt: c.issued_at,
  expiresAt: c.expires_at,
  documentId: c.document_id,
});

const toRecordInput = (r: RecordRow): DqRecordInput => ({
  kind: r.kind,
  occurredOn: r.occurred_on,
  coversUntil: r.covers_until,
  documentId: r.document_id,
});

const toHistoryRow = (c: CertRow): BinderCertHistoryRow => ({
  kind: c.kind,
  qualifier: c.qualifier,
  trainingType: c.training_type,
  identifier: c.identifier,
  issuingAuthority: c.issuing_authority,
  issuedAt: c.issued_at,
  effectiveFrom: c.effective_from,
  expiresAt: c.expires_at,
  supersededAt: c.superseded_at,
  current: c.superseded_by == null,
  documentId: c.document_id,
});

const toEventRow = (r: RecordRow): BinderEventRow => ({
  kind: r.kind,
  occurredOn: r.occurred_on,
  coversUntil: r.covers_until,
  performedBy: r.performed_by,
  reference: r.reference,
  documentId: r.document_id,
});

const toDocumentRef = (d: DocRow): BinderDocumentRef => ({
  id: d.id,
  kind: d.kind,
  storagePath: d.storage_path,
  contentType: d.content_type,
  bytes: d.bytes,
  sha256: d.sha256,
  createdAt: d.created_at,
});
