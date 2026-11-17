import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TOLL_PROVIDER_LABEL,
  fetchAllPaged,
  tollStatementFormatOf,
  type TollProvider,
  type TollStatementConfirm,
  type TollStatementDto,
  type TollStatementFormat,
} from "@silvicom/shared";

/**
 * The toll statements the office uploaded (TOLLS-PER-TRUCK-PLAN.md TL4a, migration 0626).
 *
 * Upload is two calls, as lumper RCs and chat files are: the API signs a place for the bytes, the
 * browser puts them there, and only then is the row written, after the stored bytes are read back
 * and held to the size and SHA-256 the browser declared and found to be a statement-shaped file.
 * A row is the claim "this statement is on file", so it is not written on the browser's word.
 *
 * A refused file's bytes are deleted from the bucket at once: nothing points at them, and a
 * statement nobody kept must not sit in storage holding account numbers.
 *
 * Every query filters on the org itself: the API reads with the service role, which bypasses RLS.
 */
export const TOLL_STATEMENTS_BUCKET = "toll-statements";
const LINK_SECONDS = 300;

export type StatementRefusal = { refused: true; status: 404 | 409 | 422; code: string; message: string };
const refuse = (status: StatementRefusal["status"], code: string, message: string): StatementRefusal => ({ refused: true, status, code, message });
export const isStatementRefusal = (x: unknown): x is StatementRefusal => typeof x === "object" && x != null && (x as StatementRefusal).refused === true;

const objectKey = (orgId: string, fileId: string) => `${orgId}/${fileId}`;

interface StatementRow {
  id: string; provider: TollProvider; file_name: string; format: TollStatementFormat; byte_size: number | string;
  uploaded_by: string; created_at: string; period_start: string | null; period_end: string | null;
  printed_total: number | string | null; read_at: string | null; removed_at: string | null; removed_by: string | null; remove_reason: string | null;
}
const COLUMNS = "id, provider, file_name, format, byte_size, uploaded_by, created_at, period_start, period_end, printed_total, read_at, removed_at, removed_by, remove_reason";

async function namesOf(admin: SupabaseClient, userIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(userIds)];
  for (let i = 0; i < ids.length; i += 50) {
    // `user_profiles` is keyed by the person, not the org; the ids come from this org's own rows.
    const { data, error } = await admin.from("user_profiles").select("user_id, full_name").in("user_id", ids.slice(i, i + 50));
    if (error) throw new Error(`[tolls] names not read: ${error.message}`);
    for (const r of (data ?? []) as { user_id: string; full_name: string | null }[]) if (r.full_name) out.set(r.user_id, r.full_name);
  }
  return out;
}

async function toDtos(admin: SupabaseClient, rows: readonly StatementRow[]): Promise<TollStatementDto[]> {
  const names = await namesOf(admin, rows.flatMap((r) => [r.uploaded_by, r.removed_by]).filter((id): id is string => id != null));
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    fileName: r.file_name,
    format: r.format,
    byteSize: Number(r.byte_size),
    uploadedAt: r.created_at,
    uploadedByName: names.get(r.uploaded_by) ?? null,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    printedTotal: r.printed_total == null ? null : Number(r.printed_total),
    readAt: r.read_at,
    removedAt: r.removed_at,
    removedByName: r.removed_by ? (names.get(r.removed_by) ?? null) : null,
    removeReason: r.remove_reason,
  }));
}

/** Every statement the org kept, newest first; removed ones too, so a correction stays visible. */
export async function listTollStatements(admin: SupabaseClient, orgId: string): Promise<TollStatementDto[]> {
  const rows = await fetchAllPaged<StatementRow>((from, to) =>
    admin.from("toll_statements").select(COLUMNS).eq("org_id", orgId).order("created_at", { ascending: false }).order("id").range(from, to),
  );
  return toDtos(admin, rows);
}

/** Step one: a place to put the bytes. Nothing is kept until `keepTollStatement` checks them. */
export async function startTollStatementUpload(admin: SupabaseClient, orgId: string, newId: () => string = randomUUID): Promise<{ fileId: string; uploadUrl: string }> {
  const fileId = newId();
  const { data, error } = await admin.storage.from(TOLL_STATEMENTS_BUCKET).createSignedUploadUrl(objectKey(orgId, fileId));
  if (error || !data) throw new Error(`[tolls] upload URL: ${error?.message ?? "no URL"}`);
  return { fileId, uploadUrl: data.signedUrl };
}

async function discard(admin: SupabaseClient, path: string): Promise<void> {
  const { error } = await admin.storage.from(TOLL_STATEMENTS_BUCKET).remove([path]);
  if (error) console.warn(`[tolls] refused statement bytes not deleted (${path}): ${error.message}`);
}

/**
 * Step two: keep the statement if the stored bytes are the file that was picked (same size, same
 * SHA-256) and are a PDF, spreadsheet or CSV inside, whatever the name says (D-TL5). The format
 * recorded is the one read from the bytes.
 */
export async function keepTollStatement(admin: SupabaseClient, orgId: string, userId: string, f: TollStatementConfirm): Promise<TollStatementDto | StatementRefusal> {
  const path = objectKey(orgId, f.fileId);
  const { data, error } = await admin.storage.from(TOLL_STATEMENTS_BUCKET).download(path);
  if (error || !data) return refuse(422, "file_missing", `${f.fileName} did not arrive. Upload it again.`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.length !== f.byteSize || createHash("sha256").update(bytes).digest("hex") !== f.sha256) {
    await discard(admin, path);
    return refuse(422, "file_changed", `${f.fileName} arrived different from the file that was picked. Upload it again.`);
  }
  const format = tollStatementFormatOf(bytes.subarray(0, 64 * 1024));
  if (!format) {
    await discard(admin, path);
    return refuse(422, "not_a_statement", `${f.fileName} is not a PDF, spreadsheet or CSV inside, whatever its name says.`);
  }
  const { error: insertErr } = await admin.from("toll_statements").insert({
    id: f.fileId, org_id: orgId, provider: f.provider, file_name: f.fileName, format,
    byte_size: f.byteSize, sha256: f.sha256, storage_path: path, uploaded_by: userId,
  });
  if (insertErr) {
    if (insertErr.code === "23505") {
      await discard(admin, path);
      const { data: earlier } = await admin.from("toll_statements").select("file_name, provider")
        .eq("org_id", orgId).eq("sha256", f.sha256).is("removed_at", null).maybeSingle();
      const was = earlier as { file_name: string; provider: TollProvider } | null;
      return refuse(409, "already_uploaded", was
        ? `This file is already on the list, as ${was.file_name} under ${TOLL_PROVIDER_LABEL[was.provider]}.`
        : "This file is already on the list.");
    }
    throw new Error(`[tolls] statement not kept: ${insertErr.message}`);
  }
  const { data: kept, error: readErr } = await admin.from("toll_statements").select(COLUMNS).eq("org_id", orgId).eq("id", f.fileId).maybeSingle();
  if (readErr || !kept) throw new Error(`[tolls] statement kept but not read back: ${readErr?.message ?? "no row"}`);
  const [dto] = await toDtos(admin, [kept as StatementRow]);
  return dto!;
}

/** A short-lived link to the file as uploaded. Removed files open too: the record is the point. */
export async function tollStatementLink(admin: SupabaseClient, orgId: string, id: string): Promise<{ url: string; fileName: string } | StatementRefusal> {
  const { data, error } = await admin.from("toll_statements").select("storage_path, file_name").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error) throw new Error(`[tolls] statement not read: ${error.message}`);
  const row = data as { storage_path: string; file_name: string } | null;
  if (!row) return refuse(404, "not_found", "Statement not found.");
  const signed = await admin.storage.from(TOLL_STATEMENTS_BUCKET).createSignedUrl(row.storage_path, LINK_SECONDS, { download: row.file_name });
  if (signed.error || !signed.data) throw new Error(`[tolls] statement link: ${signed.error?.message ?? "no URL"}`);
  return { url: signed.data.signedUrl, fileName: row.file_name };
}

/** A wrong file is taken off the list with a reason. The row and the bytes stay (0626). */
export async function removeTollStatement(admin: SupabaseClient, orgId: string, userId: string, id: string, reason: string, now: Date): Promise<{ fileName: string; provider: TollProvider } | StatementRefusal> {
  const { data, error } = await admin
    .from("toll_statements")
    .update({ removed_at: now.toISOString(), removed_by: userId, remove_reason: reason })
    .eq("org_id", orgId).eq("id", id).is("removed_at", null)
    .select("file_name, provider");
  if (error) throw new Error(`[tolls] statement not removed: ${error.message}`);
  const row = ((data ?? []) as { file_name: string; provider: TollProvider }[])[0];
  if (!row) return refuse(404, "not_found", "Statement not found, or already removed.");
  return { fileName: row.file_name, provider: row.provider };
}
