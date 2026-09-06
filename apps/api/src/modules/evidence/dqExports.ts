import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DQ_EXPORT_BUCKET,
  DQ_EXPORT_TTL_DAYS,
  DQ_EXPORT_URL_TTL_SECONDS,
  dqExportStoragePath,
  type DqExportKind,
  type DqExportRow,
} from "@silvicom/shared";
import { labelOf, memberLabels } from "../../lib/memberLabels.js";

/**
 * The export ledger (migration 0152, D-BD9). Every binder and every single-document release writes a
 * row here saying who pulled which driver's records and when.
 *
 * THE ROW OUTLIVES THE BYTES. A finished binder is a PII aggregate with a seven-day life (D-BD4);
 * the record that it was produced has no expiry at all. So `sweepExpiredExports` deletes the object
 * and stamps `purged_at` — it never deletes the row, and `dq_exports` is in RETENTION_FORBIDDEN so a
 * future retention rule cannot either.
 *
 * Writes are service-role only by RLS. This module is the only place that makes them.
 */

export type ServiceError = { error: string; code: string };
const err = (code: string, error: string): ServiceError => ({ error, code });

export interface CreateExportInput {
  kind: DqExportKind;
  driverIds: string[];
  asAt: string;
  requirementKey?: string | null;
  documentId?: string | null;
  /** Phase G (D-DQ15): a privileged, route-verified ask — recorded so "who exported a drug-test
   *  page" is a ledger query. */
  includeRestricted?: boolean;
}

export async function createExport(
  admin: SupabaseClient,
  orgId: string,
  requestedBy: string | null,
  input: CreateExportInput,
): Promise<{ id: string } | ServiceError> {
  const { data, error } = await admin
    .from("dq_exports")
    .insert({
      org_id: orgId,
      kind: input.kind,
      driver_ids: input.driverIds,
      as_at: input.asAt,
      requirement_key: input.requirementKey ?? null,
      document_id: input.documentId ?? null,
      include_restricted: input.includeRestricted ?? false,
      requested_by: requestedBy,
      // A streamed single document is finished the moment it is sent; only a binder is queued.
      status: input.kind === "document" ? "running" : "queued",
    })
    .select("id")
    .single();
  if (error || !data) return err("insert_failed", error?.message ?? "Could not record the export.");
  return { id: (data as { id: string }).id };
}

export async function attachJob(
  admin: SupabaseClient,
  exportId: string,
  jobId: string,
): Promise<void> {
  await admin.from("dq_exports").update({ job_id: jobId }).eq("id", exportId);
}

export async function markRunning(admin: SupabaseClient, exportId: string): Promise<void> {
  await admin.from("dq_exports").update({ status: "running" }).eq("id", exportId);
}

export interface ExportOutcome {
  storagePath: string | null;
  bytes: number;
  pages: number;
  driversCount: number;
  documentsCount: number;
  gapsCount: number;
}

export async function markDone(
  admin: SupabaseClient,
  exportId: string,
  out: ExportOutcome,
): Promise<void> {
  const now = new Date();
  await admin
    .from("dq_exports")
    .update({
      status: "done",
      storage_path: out.storagePath,
      bytes: out.bytes,
      pages: out.pages,
      drivers_count: out.driversCount,
      documents_count: out.documentsCount,
      gaps_count: out.gapsCount,
      completed_at: now.toISOString(),
      // Null when nothing was stored — a streamed document has no bytes to expire.
      expires_at: out.storagePath
        ? new Date(now.getTime() + DQ_EXPORT_TTL_DAYS * 86_400_000).toISOString()
        : null,
    })
    .eq("id", exportId);
}

export async function markFailed(
  admin: SupabaseClient,
  exportId: string,
  message: string,
): Promise<void> {
  await admin
    .from("dq_exports")
    .update({
      status: "failed",
      error: message.slice(0, 500),
      completed_at: new Date().toISOString(),
    })
    .eq("id", exportId);
}

/** Upload a finished binder. `upsert` so a retried job replaces its own object rather than 409ing. */
export async function storeBinder(
  admin: SupabaseClient,
  orgId: string,
  exportId: string,
  bytes: Buffer,
): Promise<string | ServiceError> {
  const path = dqExportStoragePath(orgId, exportId);
  const { error } = await admin.storage
    .from(DQ_EXPORT_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) return err("upload_failed", error.message);
  return path;
}

interface LedgerRow {
  id: string;
  kind: DqExportKind;
  status: DqExportRow["status"];
  as_at: string;
  driver_ids: string[];
  requirement_key: string | null;
  drivers_count: number | null;
  documents_count: number | null;
  gaps_count: number | null;
  pages: number | null;
  bytes: number | null;
  error: string | null;
  requested_by: string | null;
  storage_path: string | null;
  purged_at: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * The history list. Names and emails are resolved here rather than stored on the row: a ledger that
 * froze the driver's name would drift the day somebody fixes a spelling, and the ids are the record.
 */
export async function listExports(
  admin: SupabaseClient,
  orgId: string,
  limit: number,
): Promise<{ rows: DqExportRow[] } | ServiceError> {
  const { data, error } = await admin
    .from("dq_exports")
    .select(
      "id, kind, status, as_at, driver_ids, requirement_key, drivers_count, documents_count, gaps_count, pages, bytes, error, requested_by, storage_path, purged_at, created_at, completed_at",
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return err("db_error", error.message);
  const rows = (data ?? []) as unknown as LedgerRow[];

  const driverIds = [...new Set(rows.flatMap((r) => r.driver_ids))];
  const nameById = new Map<string, string>();
  if (driverIds.length > 0) {
    const { data: drivers } = await admin
      .from("drivers")
      .select("id, full_name")
      .eq("org_id", orgId)
      .in("id", driverIds);
    for (const d of (drivers ?? []) as unknown as { id: string; full_name: string }[]) {
      nameById.set(d.id, d.full_name);
    }
  }

  const userIds = [
    ...new Set(rows.map((r) => r.requested_by).filter((v): v is string => Boolean(v))),
  ];
  // One directory call for every requester at once (0301); the field keeps its name because the
  // contract does, and carries the person's name when they have one and their email when they do not.
  const labelById = await memberLabels(admin, orgId, userIds);

  return {
    rows: rows.map((r): DqExportRow => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      as_at: r.as_at,
      driver_ids: r.driver_ids,
      // A driver removed from the roster since the export leaves the id visible rather than a blank —
      // the ledger's job is to still mean something later.
      driver_names: r.driver_ids.map((id) => nameById.get(id) ?? id),
      requirement_key: r.requirement_key,
      drivers_count: r.drivers_count,
      documents_count: r.documents_count,
      gaps_count: r.gaps_count,
      pages: r.pages,
      bytes: r.bytes,
      error: r.error,
      requested_by_email: r.requested_by ? labelOf(labelById.get(r.requested_by)) : null,
      created_at: r.created_at,
      completed_at: r.completed_at,
      purged: Boolean(r.purged_at),
      downloadable: r.status === "done" && Boolean(r.storage_path) && !r.purged_at,
    })),
  };
}

/**
 * A short-lived signed URL for a finished binder. The bucket has no client policy at all, so this
 * function is the ONLY way the bytes are reachable — which is what makes the seven-day sweep a real
 * expiry rather than a tidy-up.
 */
export async function signExport(
  admin: SupabaseClient,
  orgId: string,
  exportId: string,
): Promise<{ url: string; expiresInSeconds: number } | ServiceError> {
  const { data, error } = await admin
    .from("dq_exports")
    .select("status, storage_path, purged_at")
    .eq("org_id", orgId)
    .eq("id", exportId)
    .maybeSingle();
  if (error) return err("db_error", error.message);
  const row = data as {
    status: string;
    storage_path: string | null;
    purged_at: string | null;
  } | null;
  if (!row) return err("not_found", "That export does not exist.");
  if (row.purged_at) {
    return err(
      "expired",
      "This binder has passed its seven-day life and its file has been removed. Generate it again — it takes a minute.",
    );
  }
  if (row.status !== "done" || !row.storage_path) {
    return err("not_ready", "This binder is still being assembled.");
  }

  const { data: signed, error: signError } = await admin.storage
    .from(DQ_EXPORT_BUCKET)
    .createSignedUrl(row.storage_path, DQ_EXPORT_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) {
    return err("sign_failed", signError?.message ?? "Could not produce a download link.");
  }
  return { url: signed.signedUrl, expiresInSeconds: DQ_EXPORT_URL_TTL_SECONDS };
}

/**
 * The seven-day sweep (D-BD4). Removes the object, keeps the row.
 *
 * Runs across ALL orgs in one pass because the objects are keyed by org inside one bucket and the
 * expiry is a property of the export, not of the tenant. Bounded per run for the same reason every
 * other sweep in this codebase is: a backlog should converge over days, not produce one enormous
 * delete.
 */
export async function sweepExpiredExports(
  admin: SupabaseClient,
  limit = 200,
): Promise<{ purged: number }> {
  const { data } = await admin
    .from("dq_exports")
    .select("id, storage_path")
    .not("storage_path", "is", null)
    .is("purged_at", null)
    .lt("expires_at", new Date().toISOString())
    .limit(limit);

  const rows = (data ?? []) as unknown as { id: string; storage_path: string }[];
  if (rows.length === 0) return { purged: 0 };

  // Remove the bytes FIRST. If the stamp then fails, the next run retries a no-op remove; the
  // opposite order would leave an object nothing points at and nothing will ever come back for.
  await admin.storage.from(DQ_EXPORT_BUCKET).remove(rows.map((r) => r.storage_path));
  await admin
    .from("dq_exports")
    .update({ purged_at: new Date().toISOString(), storage_path: null })
    .in(
      "id",
      rows.map((r) => r.id),
    );

  return { purged: rows.length };
}
