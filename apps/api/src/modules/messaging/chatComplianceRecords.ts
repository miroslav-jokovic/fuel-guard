import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHAT_EXPORT_FILE_DAYS,
  CHAT_EXPORT_FOLD,
  DQ_EXPORT_BUCKET,
  chatExportRowsSchema,
  chatExportSchema,
  chatHoldSchema,
  type ChatExportFile,
  type ChatExportLinksResponse,
  type ChatExportRequest,
  type ChatExportRows,
  type ChatExportsResponse,
  type ChatHoldReleaseRequest,
  type ChatHoldSetRequest,
  type ChatHoldsResponse,
} from "@silvicom/shared";
import { renderChatExportPdf } from "./chatExportPdf.js";

/**
 * Legal holds and exports (OFFICE-CHAT-PLAN CHA3b; D-CHAT15, D-CHAT20; migration 0517). As in
 * `chatCompliance.ts`, every rule is the database's: these functions call 0517, shape what comes back
 * and map its refusals. The route has already asked `requireSurface("chat.compliance")` and step-up.
 *
 * AN EXPORT IN THREE STEPS, in this order and for this reason:
 *   1. `chat_compliance_export_rows` — the words, ledgered: the `compliance_export` row (with the
 *      reason and the fold of the line hashes) and the `chat_exports` record are committed before a
 *      word comes back. From here on, the act is on the record whatever happens to the files.
 *   2. Three files into the private `compliance-exports` bucket under `<org>/chat/<export>/`: the
 *      JSONL (one line per message, the evidence), the PDF (the readable copy) and `manifest.json`.
 *   3. `chat_export_stored` with the manifest's own hash — or `chat_export_failed` with the error, so
 *      a failed export is visible in the Exports list instead of sitting at "building" for ever.
 *
 * Files are kept for `CHAT_EXPORT_FILE_DAYS`; `sweepExpiredChatExports` removes the bytes and keeps
 * the record, the D-BD4 rule `dqExports.ts` keeps for audit binders in the same bucket.
 */

export const CHAT_EXPORT_URL_TTL_SECONDS = 300;

const CHAT_RECORDS_ERRORS: Record<string, { status: 404 | 409 | 422; code: string; message: string }> = {
  CH001: { status: 404, code: "not_found", message: "That person, conversation or hold is not in this organisation" },
  CH009: { status: 422, code: "reason_required", message: "Give the reason: a category and a sentence" },
  CH010: { status: 422, code: "not_allowed", message: "That cannot be done" },
};

export type ChatRecordsResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 404 | 409 | 422; code: string; message: string };

async function rpc<T>(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<ChatRecordsResult<T>> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) {
    const code = (error as { code?: string }).code;
    const known = code ? CHAT_RECORDS_ERRORS[code] : undefined;
    if (known) return { ok: false, ...known, message: error.message || known.message };
    throw new Error(error.message);
  }
  return { ok: true, value: data as T };
}

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

// ── holds ─────────────────────────────────────────────────────────────────────────────────────────

export async function chatHolds(admin: SupabaseClient, orgId: string, includeReleased: boolean): Promise<ChatHoldsResponse> {
  const res = await rpc<unknown[]>(admin, "chat_holds_list", { p_org: orgId, p_include_released: includeReleased });
  if (!res.ok) throw new Error(res.message); // the list raises nothing: a refusal here is a fault
  return { holds: (res.value ?? []).map((r) => chatHoldSchema.parse(r)) };
}

export async function chatHoldSet(
  admin: SupabaseClient, orgId: string, userId: string, req: ChatHoldSetRequest,
): Promise<ChatRecordsResult<{ id: string }>> {
  const res = await rpc<string>(admin, "chat_hold_set", {
    p_org: orgId, p_actor: userId, p_reason: req.reason, p_scope: req.scope, p_target: req.target, p_matter: req.matter,
  });
  return res.ok ? { ok: true, value: { id: res.value } } : res;
}

export async function chatHoldRelease(
  admin: SupabaseClient, orgId: string, userId: string, holdId: string, req: ChatHoldReleaseRequest,
): Promise<ChatRecordsResult<{ id: string }>> {
  const res = await rpc<null>(admin, "chat_hold_release", { p_org: orgId, p_actor: userId, p_reason: req.reason, p_hold: holdId });
  if (!res.ok) return res.code === "not_allowed" ? { ...res, status: 409, code: "already_released" } : res;
  return { ok: true, value: { id: holdId } };
}

// ── exports ───────────────────────────────────────────────────────────────────────────────────────

export const chatExportPaths = (orgId: string, exportId: string): Record<ChatExportFile, string> => ({
  jsonl: `${orgId}/chat/${exportId}/export.jsonl`,
  pdf: `${orgId}/chat/${exportId}/export.pdf`,
  manifest: `${orgId}/chat/${exportId}/manifest.json`,
});

/** One message per line, the shape the manifest's hashes are recomputed from. */
export function chatExportJsonl(rows: ChatExportRows): string {
  return rows.lines.map((l) => JSON.stringify(l)).join("\n") + (rows.lines.length ? "\n" : "");
}

/**
 * The manifest: everything a reviewer needs to check the copy against the ledger without trusting
 * this application — the fold rule in words, the ledger position, each line's and each earlier
 * version's hash, and the JSONL's and PDF's own hashes.
 */
export function chatExportManifest(rows: ChatExportRows, files: { jsonl: Buffer; pdf: Buffer }) {
  return {
    format: "silvicom-chat-export/1",
    export_id: rows.export.id,
    scope: rows.export.scope,
    filters: rows.export.filters,
    reason: rows.export.reason,
    requested_by: { user_id: rows.export.requested_by, name: rows.export.requested_by_name },
    created_at: rows.export.created_at,
    ledger: {
      seq: rows.export.ledger_seq,
      hash: rows.export.ledger_hash,
      note: "The export's own compliance_export row in this organisation's chat ledger. Its body_sha256 is content_sha256 below.",
    },
    content_sha256: rows.export.content_sha256,
    fold: CHAT_EXPORT_FOLD,
    message_count: rows.export.message_count,
    files: {
      "export.jsonl": { sha256: sha256(files.jsonl), bytes: files.jsonl.length },
      "export.pdf": { sha256: sha256(files.pdf), bytes: files.pdf.length },
    },
    lines: rows.lines.map((l) => ({
      id: l.id,
      thread_id: l.thread_id,
      seq: l.seq,
      body_sha256: l.body_sha256,
      retracted: l.deleted_at !== null,
      versions: l.versions.map((v) => ({ version: v.version, body_sha256: v.body_sha256 })),
    })),
  };
}

/**
 * Build one export end to end. Returns the record as the Exports list shows it. A refusal from the
 * database (no reason, another org's conversation, too many lines) comes back before anything is
 * written; a failure after step 1 is recorded on the export and rethrown.
 */
export async function chatExportCreate(
  admin: SupabaseClient, orgId: string, userId: string, exportId: string, req: ChatExportRequest,
): Promise<ChatRecordsResult<{ id: string; message_count: number }>> {
  const res = await rpc<unknown[]>(admin, "chat_compliance_export_rows", {
    p_org: orgId, p_actor: userId, p_reason: req.reason, p_export_id: exportId, p_scope: req.scope,
    p_thread: req.thread ?? null, p_person: req.person ?? null, p_from: req.from ?? null, p_to: req.to ?? null,
    p_q: req.q?.trim() || null,
  });
  if (!res.ok) return res;
  try {
    const rows = chatExportRowsSchema.parse((res.value ?? [])[0]);
    const jsonl = Buffer.from(chatExportJsonl(rows), "utf8");
    const pdf = await renderChatExportPdf(rows);
    const manifest = Buffer.from(JSON.stringify(chatExportManifest(rows, { jsonl, pdf }), null, 2) + "\n", "utf8");
    const paths = chatExportPaths(orgId, exportId);
    const uploads: Array<[string, Buffer, string]> = [
      [paths.jsonl, jsonl, "application/x-ndjson"],
      [paths.pdf, pdf, "application/pdf"],
      [paths.manifest, manifest, "application/json"],
    ];
    for (const [path, bytes, contentType] of uploads) {
      const { error } = await admin.storage.from(DQ_EXPORT_BUCKET).upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`upload of ${path.split("/").pop()} failed: ${error.message}`);
    }
    const stored = await rpc<null>(admin, "chat_export_stored", {
      p_org: orgId, p_export: exportId, p_paths: [paths.jsonl, paths.pdf, paths.manifest],
      p_bytes: jsonl.length + pdf.length + manifest.length, p_manifest_sha256: sha256(manifest),
    });
    if (!stored.ok) throw new Error(stored.message);
    return { ok: true, value: { id: exportId, message_count: rows.export.message_count } };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin.rpc("chat_export_failed", { p_org: orgId, p_export: exportId, p_error: message });
    throw e;
  }
}

export async function chatExports(admin: SupabaseClient, orgId: string, beforeAt: string | null): Promise<ChatExportsResponse> {
  const limit = 50;
  const res = await rpc<unknown[]>(admin, "chat_exports_list", { p_org: orgId, p_before_at: beforeAt, p_limit: limit });
  if (!res.ok) throw new Error(res.message);
  const exports = (res.value ?? []).map((r) => chatExportSchema.parse(r));
  const last = exports[exports.length - 1];
  return { exports, before_at: exports.length === limit && last ? last.created_at : null };
}

/** Five-minute signed links to the three files, or why there are none. */
export async function chatExportLinks(
  admin: SupabaseClient, orgId: string, exportId: string,
): Promise<ChatRecordsResult<ChatExportLinksResponse>> {
  const res = await rpc<Array<{ status: string; storage_paths: string[] | null; purged_at: string | null }>>(
    admin, "chat_export_get", { p_org: orgId, p_export: exportId });
  if (!res.ok) return res;
  const row = (res.value ?? [])[0];
  if (!row) return { ok: false, ...CHAT_RECORDS_ERRORS.CH001!, message: "That export does not exist" };
  if (row.purged_at) {
    return { ok: false, status: 409, code: "expired",
      message: `An export's files are kept for ${CHAT_EXPORT_FILE_DAYS} days and these have been removed. Export it again; the record of this one stays.` };
  }
  if (row.status !== "ready" || !row.storage_paths) {
    return { ok: false, status: 409, code: "not_ready", message: row.status === "failed" ? "This export failed. Export it again." : "This export is still being written." };
  }
  const paths = chatExportPaths(orgId, exportId);
  const { data, error } = await admin.storage.from(DQ_EXPORT_BUCKET).createSignedUrls([paths.jsonl, paths.pdf, paths.manifest], CHAT_EXPORT_URL_TTL_SECONDS);
  const [jsonl, pdf, manifest] = (data ?? []).map((d) => d.signedUrl);
  if (error || !jsonl || !pdf || !manifest) throw new Error(error?.message ?? "Could not sign the export's files");
  return {
    ok: true,
    value: { links: { jsonl, pdf, manifest }, expires_at: new Date(Date.now() + CHAT_EXPORT_URL_TTL_SECONDS * 1000).toISOString() },
  };
}

/**
 * The sweep: remove expired exports' files, then stamp each record purged. Bytes FIRST, for the
 * reason `sweepExpiredExports` gives: a stamp that fails is retried as a no-op remove next hour,
 * while the opposite order leaves files nothing points at.
 */
export async function sweepExpiredChatExports(admin: SupabaseClient, limit = 100): Promise<{ purged: number }> {
  const { data, error } = await admin.rpc("chat_exports_expired", { p_limit: limit });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; storage_paths: string[] }>;
  if (rows.length === 0) return { purged: 0 };
  const { error: removeError } = await admin.storage.from(DQ_EXPORT_BUCKET).remove(rows.flatMap((r) => r.storage_paths));
  if (removeError) throw new Error(removeError.message);
  for (const r of rows) {
    const { error: stampError } = await admin.rpc("chat_export_purged", { p_export: r.id });
    if (stampError) throw new Error(stampError.message);
  }
  return { purged: rows.length };
}
