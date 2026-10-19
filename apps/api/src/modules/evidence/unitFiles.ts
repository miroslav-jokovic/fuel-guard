import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildUnitFile,
  chunks,
  DOCUMENTS_BUCKET,
  fetchAllPaged,
  FLEET_WIDE_UNIT_KINDS,
  IN_LIST_CHUNK,
  INSPECTION_EXPIRY_WARNING_DAYS,
  PAPERS_PER_ROW,
  unitAttention,
  type PaperThumb,
  type UnitCertInput,
  type UnitDocumentInput,
  type UnitFileRow,
  type UnitFilesResponse,
  type UnitSubjectType,
} from "@silvicom/shared";
import { listUnitFileFacts } from "../roster/index.js";
import { DOCUMENT_URL_TTL_SEC } from "./compliance.js";

/**
 * Every truck's or trailer's file in one read (UNIT-FILES-PLAN UF2) — the Files column on the
 * Vehicles and Trailers lists (UF4) and the Truck paperwork card read it. One `buildUnitFile` per
 * unit, the same function a unit's own page runs, so the list and the page cannot disagree.
 *
 * Five reads, each org-filtered (the service role bypasses RLS) and paged past PostgREST's 1,000-row
 * cap, plus one chunked read of the fleet papers the certifications cite and one batch of signed
 * thumbnail URLs. A 400-unit fleet costs a handful of queries, never one per unit.
 */

type CertRow = { subject_id: string; kind: string; issued_at: string | null; expires_at: string | null; document_id: string | null };
type DocRow = {
  id: string; subject_id: string; kind: string; content_type: string; variant: string;
  derived_from: string | null; storage_path: string; captured_at: string | null; created_at: string;
};

const CERT_COLUMNS = "subject_id, kind, issued_at, expires_at, document_id";
const DOC_COLUMNS = "id, subject_id, kind, content_type, variant, derived_from, storage_path, captured_at, created_at";

const toCert = (c: CertRow): UnitCertInput => ({ kind: c.kind, issuedAt: c.issued_at, expiresAt: c.expires_at, documentId: c.document_id });
const toDoc = (d: DocRow): UnitDocumentInput => ({ id: d.id, kind: d.kind, datedAt: d.captured_at ?? d.created_at });

function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

async function readFileRows(admin: SupabaseClient, orgId: string, subjectType: UnitSubjectType) {
  return Promise.all([
    listUnitFileFacts(admin, orgId, subjectType),
    fetchAllPaged<CertRow>((from, to) =>
      admin.from("certifications").select(CERT_COLUMNS)
        .eq("org_id", orgId).eq("subject_type", subjectType).is("superseded_by", null)
        .order("id").range(from, to)),
    fetchAllPaged<CertRow>((from, to) =>
      admin.from("certifications").select(CERT_COLUMNS)
        .eq("org_id", orgId).eq("subject_type", "organization").in("kind", [...FLEET_WIDE_UNIT_KINDS])
        .is("superseded_by", null).order("id").range(from, to)),
    fetchAllPaged<DocRow>((from, to) =>
      admin.from("documents").select(DOC_COLUMNS)
        .eq("org_id", orgId).eq("subject_type", subjectType)
        .order("id").range(from, to)),
  ]);
}

/**
 * The originals a certification cites that are not the unit's own — the fleet policy filed on the
 * organization (D-UF6). Without them the engine would drop the citation as a scan that does not
 * exist. Chunked: an `.in()` list past a few hundred ids overflows Node 22's header limit.
 */
async function readCitedDocuments(admin: SupabaseClient, orgId: string, ids: string[]): Promise<UnitDocumentInput[]> {
  const out: UnitDocumentInput[] = [];
  for (const part of chunks(ids, IN_LIST_CHUNK)) {
    const { data, error } = await admin.from("documents").select("id, kind, captured_at, created_at")
      .eq("org_id", orgId).eq("variant", "original").in("id", part);
    if (error) throw new Error(error.message);
    for (const d of (data ?? []) as Array<{ id: string; kind: string; captured_at: string | null; created_at: string }>) {
      out.push({ id: d.id, kind: d.kind, datedAt: d.captured_at ?? d.created_at });
    }
  }
  return out;
}

/**
 * Signed URLs in batches; a failed signature degrades a thumb to null. Batches of 500, not
 * `IN_LIST_CHUNK`: the paths travel in a POST body, so the header limit that sizes an `.in()` list
 * does not apply, and a 400-unit fleet's 1,200 thumbs are three calls rather than twenty-four.
 */
const SIGN_BATCH = 500;
async function signPaths(admin: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunks(paths, SIGN_BATCH)) {
    const { data } = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUrls(part, DOCUMENT_URL_TTL_SEC);
    for (const s of data ?? []) if (s.signedUrl && s.path) out.set(s.path, s.signedUrl);
  }
  return out;
}

export async function getUnitFiles(
  admin: SupabaseClient,
  orgId: string,
  subjectType: UnitSubjectType,
  today: string,
): Promise<UnitFilesResponse> {
  const [units, certs, fleetCertRows, docs] = await readFileRows(admin, orgId, subjectType);
  const fleetCerts = fleetCertRows.map(toCert);

  const originals = docs.filter((d) => d.variant === "original");
  const ownIds = new Set(originals.map((d) => d.id));
  const citedIds = [...new Set([...certs, ...fleetCertRows].map((c) => c.document_id).filter((id): id is string => id !== null && !ownIds.has(id)))];
  const cited = await readCitedDocuments(admin, orgId, citedIds);

  const certsBy = groupBy(certs, (c) => c.subject_id);
  const originalsBy = groupBy(originals, (d) => d.subject_id);
  const thumbOf = new Map<string, DocRow>();
  for (const d of docs) if (d.variant === "thumb" && d.derived_from) thumbOf.set(d.derived_from, d);

  // Newest first — the cell shows the papers most recently filed, the "+N" counts the rest.
  const papersBy = new Map<string, DocRow[]>();
  for (const [unitId, list] of originalsBy) {
    papersBy.set(unitId, [...list].sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }
  const thumbPaths = [...papersBy.values()]
    .flatMap((list) => list.slice(0, PAPERS_PER_ROW))
    .map((d) => thumbOf.get(d.id)?.storage_path)
    .filter((p): p is string => p !== undefined);
  const signed = await signPaths(admin, thumbPaths);

  const rows: UnitFileRow[] = units.map((u) => {
    const own = originalsBy.get(u.id) ?? [];
    const file = buildUnitFile({
      subjectType,
      ownership: u.ownership,
      today,
      certs: (certsBy.get(u.id) ?? []).map(toCert),
      fleetCerts,
      documents: [...own.map(toDoc), ...cited],
      unitDates: {
        registration_expires_at: u.registrationExpiresAt,
        dot_annual_inspection_expires_at: u.annualInspectionExpiresAt,
      },
      // Equipment's own warning window, read rather than assumed equal to the engine's default (both
      // 30 today): the Vehicles list's inspection and registration cells (`inspectionExpiry`,
      // days <= window) and this file must call the same truck "expiring" on the same day.
      expiringWithinDays: INSPECTION_EXPIRY_WARNING_DAYS,
    });
    const papers: PaperThumb[] = (papersBy.get(u.id) ?? []).slice(0, PAPERS_PER_ROW).map((d) => {
      const thumb = thumbOf.get(d.id);
      return { documentId: d.id, kind: d.kind, contentType: d.content_type, thumbUrl: thumb ? (signed.get(thumb.storage_path) ?? null) : null };
    });
    return {
      subject_type: subjectType,
      subject_id: u.id,
      unit_number: u.unitNumber,
      status: u.status,
      ownership: u.ownership,
      state: file.state,
      counts: file.counts,
      ownership_unknown: file.ownershipUnknown.map((s) => s.key),
      attention: unitAttention(file, today),
      items: file.items.map((i) => ({
        key: i.spec.key,
        group: i.spec.group,
        state: i.state,
        goodUntil: i.goodUntil,
        dateOnly: i.dateOnly,
        fleetWide: i.fleetWide,
        documentId: i.documentId,
      })),
      papers,
      paper_count: own.length,
    };
  });
  return { units: rows };
}
