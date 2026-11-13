import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAllPaged,
  lumperCaseState,
  type LumperCaseClose,
  type LumperCaseFile,
  type LumperCaseRow,
  type LumperCasesResponse,
  type LumperCloseReason,
  type LumperFileConfirm,
  type LumperUnmatchedPayment,
} from "@silvicom/shared";
import { bytesAreKind } from "../../messaging/index.js";

/**
 * The lumper cases as the page shows them (LUMPER-REVISED-RC-PLAN.md LRC3, D-LRC5, D-LRC10).
 *
 * A case's state is never read from a column: this file gathers the McLeod facts the sweep mirrored
 * (0600) and the revised-RC files (0601), and `lumperCaseState` in @silvicom/shared says what they
 * mean. The reminder (LRC4) will call the same reader, so the page and the reminder cannot disagree.
 *
 * Every query filters on the org itself: the API reads with the service role, which bypasses RLS.
 *
 * The four McLeod tables are read whole for the org rather than by a list of order ids. They hold
 * only orders with a lumper (87 in the 90 days measured, about 350 a year), and a whole read keeps
 * the order numbers out of the URL (`.in()` overflows Node's header limit at a few hundred ids).
 * When the closed cases reach the tens of thousands this becomes a read by case page; not before.
 */
export const LUMPER_FILES_BUCKET = "lumper-files";
const LINK_SECONDS = 300;

interface CaseRecord { id: string; company_id: string; order_id: string; charge_code: string; opened_at: string; closed_at: string | null; closed_by: string | null; close_reason: LumperCloseReason | null; close_note: string | null }
interface OrderRecord { company_id: string; order_id: string; customer_name: string | null; dispatcher_user_id: string | null; dispatcher_name: string | null; consignee_name: string | null; consignee_city: string | null; consignee_state: string | null; consignee_arrived_at: string | null; consignee_departed_at: string | null }
interface ChargeRecord { company_id: string; order_id: string; charge_code: string; descr: string | null; amount: number | string }
interface PaymentRecord { company_id: string; payment_id: string; settlement_state: string; order_id: string | null; deduct_code: string; amount: number | string; transacted_at: string | null; reference_no: string | null; driver_code: string | null; tractor_unit: string | null; is_void: boolean }
interface BillRecord { company_id: string; order_id: string; bill_type: string | null; bill_date: string | null; invoice_no: string | null; lumper_amount: number | string }
interface FileRecord { id: string; case_id: string; file_name: string; mime: string; byte_size: number | string; uploaded_by: string | null; created_at: string; removed_at: string | null }

export type LumperRefusal = { refused: true; status: 404 | 409 | 422; code: string; message: string };
const refuse = (status: LumperRefusal["status"], code: string, message: string): LumperRefusal => ({ refused: true, status, code, message });
export const isLumperRefusal = (v: unknown): v is LumperRefusal => typeof v === "object" && v !== null && (v as { refused?: unknown }).refused === true;

const key = (companyId: string, orderId: string) => `${companyId}\u0000${orderId}`;
const group = <T>(rows: readonly T[], k: (r: T) => string): Map<string, T[]> => {
  const out = new Map<string, T[]>();
  for (const r of rows) (out.get(k(r)) ?? out.set(k(r), []).get(k(r))!).push(r);
  return out;
};

async function namesOf(admin: SupabaseClient, userIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(userIds)];
  for (let i = 0; i < ids.length; i += 50) {
    // `user_profiles` is keyed by the person, not the org; the ids come from this org's own rows.
    const { data, error } = await admin.from("user_profiles").select("user_id, full_name").in("user_id", ids.slice(i, i + 50));
    if (error) throw new Error(`[lumper] names not read: ${error.message}`);
    for (const r of (data ?? []) as { user_id: string; full_name: string | null }[]) if (r.full_name) out.set(r.user_id, r.full_name);
  }
  return out;
}

export async function listLumperCases(admin: SupabaseClient, orgId: string, scope: "open" | "all"): Promise<LumperCasesResponse> {
  // Each table is named literally at its own call: the table gates read string literals, and a
  // table name passed through a variable is invisible to them.
  type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  const cases = await fetchAllPaged<CaseRecord>((from, to) =>
    admin.from("lumper_cases").select("id, company_id, order_id, charge_code, opened_at, closed_at, closed_by, close_reason, close_note")
      .eq("org_id", orgId).order("opened_at").order("id").range(from, to) as unknown as Page<CaseRecord>);
  const orders = await fetchAllPaged<OrderRecord>((from, to) =>
    admin.from("mcleod_lumper_orders").select("company_id, order_id, customer_name, dispatcher_user_id, dispatcher_name, consignee_name, consignee_city, consignee_state, consignee_arrived_at, consignee_departed_at")
      .eq("org_id", orgId).order("company_id").order("order_id").range(from, to) as unknown as Page<OrderRecord>);
  const charges = await fetchAllPaged<ChargeRecord>((from, to) =>
    admin.from("mcleod_lumper_charges").select("company_id, order_id, charge_code, descr, amount")
      .eq("org_id", orgId).order("company_id").order("charge_id").range(from, to) as unknown as Page<ChargeRecord>);
  const payments = await fetchAllPaged<PaymentRecord>((from, to) =>
    admin.from("mcleod_lumper_payments").select("company_id, payment_id, settlement_state, order_id, deduct_code, amount, transacted_at, reference_no, driver_code, tractor_unit, is_void")
      .eq("org_id", orgId).order("company_id").order("settlement_state").order("payment_id").range(from, to) as unknown as Page<PaymentRecord>);
  const bills = await fetchAllPaged<BillRecord>((from, to) =>
    admin.from("mcleod_lumper_bills").select("company_id, order_id, bill_type, bill_date, invoice_no, lumper_amount")
      .eq("org_id", orgId).order("company_id").order("bill_id").range(from, to) as unknown as Page<BillRecord>);
  const files = await fetchAllPaged<FileRecord>((from, to) =>
    admin.from("lumper_case_files").select("id, case_id, file_name, mime, byte_size, uploaded_by, created_at, removed_at")
      .eq("org_id", orgId).order("created_at").order("id").range(from, to) as unknown as Page<FileRecord>);

  const orderBy = new Map(orders.map((o) => [key(o.company_id, o.order_id), o]));
  const chargesBy = group(charges, (c) => key(c.company_id, c.order_id));
  const paymentsBy = group(payments.filter((p) => p.order_id), (p) => key(p.company_id, p.order_id!));
  const billsBy = group(bills, (b) => key(b.company_id, b.order_id));
  const filesBy = group(files.filter((f) => f.removed_at == null), (f) => f.case_id);
  const names = await namesOf(admin, [...cases.map((c) => c.closed_by), ...files.map((f) => f.uploaded_by)].filter((id): id is string => id != null));

  const rows: LumperCaseRow[] = [];
  for (const c of cases) {
    const k = key(c.company_id, c.order_id);
    const order = orderBy.get(k) ?? null;
    // Q-LRC7: the case is keyed by charge code; the settlement lines and bills belong to the order.
    const caseCharges = (chargesBy.get(k) ?? []).filter((ch) => ch.charge_code === c.charge_code);
    const casePayments = paymentsBy.get(k) ?? [];
    const caseFiles = filesBy.get(c.id) ?? [];
    const reading = lumperCaseState({
      charges: caseCharges.map((ch) => ({ amount: Number(ch.amount) })),
      payments: casePayments.map((p) => ({ deduct_code: p.deduct_code, amount: Number(p.amount), is_void: p.is_void, transacted_at: p.transacted_at, reference_no: p.reference_no })),
      bills: (billsBy.get(k) ?? []).map((b) => ({ bill_type: b.bill_type, bill_date: b.bill_date, invoice_no: b.invoice_no, lumper_amount: Number(b.lumper_amount) })),
      rcOnFile: caseFiles.length > 0,
      closed: c.closed_at != null,
    });
    if (scope === "open" && !reading.open) continue;
    rows.push({
      id: c.id,
      companyId: c.company_id,
      orderId: c.order_id,
      chargeCode: c.charge_code,
      state: reading.state,
      open: reading.open,
      openedAt: c.opened_at,
      customerName: order?.customer_name ?? null,
      dispatcherUserId: order?.dispatcher_user_id ?? null,
      dispatcherName: order?.dispatcher_name ?? null,
      consigneeName: order?.consignee_name ?? null,
      consigneeCity: order?.consignee_city ?? null,
      consigneeState: order?.consignee_state ?? null,
      deliveredAt: order?.consignee_departed_at ?? order?.consignee_arrived_at ?? null,
      driverCode: casePayments.find((p) => !p.is_void && p.driver_code)?.driver_code ?? null,
      paidAmount: reading.paidAmount,
      paidAt: reading.paidAt,
      references: reading.references,
      chargeAmount: reading.chargeAmount,
      chargeDescriptions: [...new Set(caseCharges.map((ch) => ch.descr).filter((d): d is string => d != null))],
      billedAmount: reading.billedAmount,
      shortAmount: reading.shortAmount,
      invoiced: reading.invoiced,
      lastInvoiceNo: reading.lastInvoiceNo,
      lastInvoiceAt: reading.lastInvoiceAt,
      rcOnFile: caseFiles.length > 0,
      files: caseFiles.map((f): LumperCaseFile => ({
        id: f.id, fileName: f.file_name, mime: f.mime, byteSize: Number(f.byte_size),
        uploadedBy: f.uploaded_by, uploadedByName: f.uploaded_by ? (names.get(f.uploaded_by) ?? null) : null, uploadedAt: f.created_at,
      })),
      closedAt: c.closed_at,
      closedByName: c.closed_by ? (names.get(c.closed_by) ?? null) : null,
      closeReason: c.close_reason,
      closeNote: c.close_note,
    });
  }

  const unmatchedPayments: LumperUnmatchedPayment[] = payments
    .filter((p) => p.order_id == null && !p.is_void)
    .map((p) => ({
      id: `${p.settlement_state}:${p.payment_id}`, deductCode: p.deduct_code, amount: Number(p.amount), transactedAt: p.transacted_at,
      referenceNo: p.reference_no, driverCode: p.driver_code, tractorUnit: p.tractor_unit, pending: p.settlement_state === "pending",
    }));

  const { data: sweeps, error: sweepErr } = await admin.from("mcleod_lumper_sweeps").select("swept_at").eq("org_id", orgId).order("swept_at", { ascending: false }).limit(1);
  if (sweepErr) throw new Error(`[lumper] sweep time not read: ${sweepErr.message}`);

  return { cases: rows, unmatchedPayments, sweptAt: ((sweeps ?? []) as { swept_at: string }[])[0]?.swept_at ?? null };
}

async function caseOf(admin: SupabaseClient, orgId: string, caseId: string): Promise<{ id: string; order_id: string; closed_at: string | null } | null> {
  const { data, error } = await admin.from("lumper_cases").select("id, order_id, closed_at").eq("org_id", orgId).eq("id", caseId).maybeSingle();
  if (error) throw new Error(`[lumper] case not read: ${error.message}`);
  return (data as { id: string; order_id: string; closed_at: string | null } | null) ?? null;
}

const objectKey = (orgId: string, caseId: string, fileId: string) => `${orgId}/${caseId}/${fileId}`;

/** Step one of filing: a place to put the bytes. Nothing is on the case until `fileRevisedRc` checks them. */
export async function startRevisedRcUpload(admin: SupabaseClient, orgId: string, caseId: string, newId: () => string = randomUUID): Promise<{ file_id: string; upload_url: string } | LumperRefusal> {
  if (!(await caseOf(admin, orgId, caseId))) return refuse(404, "not_found", "Lumper case not found.");
  const fileId = newId();
  const { data, error } = await admin.storage.from(LUMPER_FILES_BUCKET).createSignedUploadUrl(objectKey(orgId, caseId, fileId));
  if (error || !data) throw new Error(`[lumper] upload URL: ${error?.message ?? "no URL"}`);
  return { file_id: fileId, upload_url: data.signedUrl };
}

/**
 * Step two: the file is on the case only if the stored bytes are what the browser said it sent — the
 * same size, the same SHA-256, and really a PDF, JPEG or PNG inside. The row is the record that the
 * revised RC arrived, so it is not written on the browser's word.
 */
export async function fileRevisedRc(admin: SupabaseClient, orgId: string, userId: string, caseId: string, f: LumperFileConfirm): Promise<{ fileId: string; orderId: string } | LumperRefusal> {
  const found = await caseOf(admin, orgId, caseId);
  if (!found) return refuse(404, "not_found", "Lumper case not found.");
  const path = objectKey(orgId, caseId, f.file_id);
  const { data, error } = await admin.storage.from(LUMPER_FILES_BUCKET).download(path);
  if (error || !data) return refuse(422, "file_missing", `${f.file_name} did not arrive. Attach it again.`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.length !== f.byte_size || createHash("sha256").update(bytes).digest("hex") !== f.sha256) {
    return refuse(422, "file_changed", `${f.file_name} arrived different from the file that was picked. Attach it again.`);
  }
  if (!bytesAreKind(bytes, f.mime)) return refuse(422, "file_not_its_kind", `${f.file_name} is not a PDF or a picture inside, whatever its name says.`);
  const { error: insertErr } = await admin.from("lumper_case_files").insert({
    id: f.file_id, org_id: orgId, case_id: caseId, kind: "revised_rc", file_name: f.file_name, mime: f.mime,
    byte_size: f.byte_size, sha256: f.sha256, storage_path: path, uploaded_by: userId,
  });
  if (insertErr) {
    if (insertErr.code === "23505") return refuse(409, "already_filed", "This file is already on the case.");
    throw new Error(`[lumper] revised RC not filed: ${insertErr.message}`);
  }
  return { fileId: f.file_id, orderId: found.order_id };
}

export async function revisedRcLink(admin: SupabaseClient, orgId: string, fileId: string): Promise<{ url: string; file_name: string; mime: string } | LumperRefusal> {
  const { data, error } = await admin.from("lumper_case_files").select("storage_path, file_name, mime").eq("org_id", orgId).eq("id", fileId).maybeSingle();
  if (error) throw new Error(`[lumper] file not read: ${error.message}`);
  const row = data as { storage_path: string; file_name: string; mime: string } | null;
  if (!row) return refuse(404, "not_found", "File not found.");
  const signed = await admin.storage.from(LUMPER_FILES_BUCKET).createSignedUrl(row.storage_path, LINK_SECONDS);
  if (signed.error || !signed.data) throw new Error(`[lumper] file link: ${signed.error?.message ?? "no URL"}`);
  return { url: signed.data.signedUrl, file_name: row.file_name, mime: row.mime };
}

/** A wrong paper is taken off the case with a reason. The row and the file stay (0601). */
export async function removeRevisedRc(admin: SupabaseClient, orgId: string, userId: string, fileId: string, reason: string, now: Date): Promise<{ caseId: string; fileName: string } | LumperRefusal> {
  const { data, error } = await admin
    .from("lumper_case_files")
    .update({ removed_at: now.toISOString(), removed_by: userId, remove_reason: reason })
    .eq("org_id", orgId).eq("id", fileId).is("removed_at", null)
    .select("case_id, file_name");
  if (error) throw new Error(`[lumper] file not removed: ${error.message}`);
  const row = ((data ?? []) as { case_id: string; file_name: string }[])[0];
  if (!row) return refuse(404, "not_found", "File not found, or already removed.");
  return { caseId: row.case_id, fileName: row.file_name };
}

export async function closeLumperCase(admin: SupabaseClient, orgId: string, userId: string, caseId: string, body: LumperCaseClose, now: Date): Promise<{ orderId: string } | LumperRefusal> {
  const { data, error } = await admin
    .from("lumper_cases")
    .update({ closed_at: now.toISOString(), closed_by: userId, close_reason: body.reason, close_note: body.note?.trim() ? body.note.trim() : null })
    .eq("org_id", orgId).eq("id", caseId).is("closed_at", null)
    .select("order_id");
  if (error) throw new Error(`[lumper] case not closed: ${error.message}`);
  const row = ((data ?? []) as { order_id: string }[])[0];
  if (row) return { orderId: row.order_id };
  return (await caseOf(admin, orgId, caseId)) ? refuse(409, "already_closed", "This case is already closed.") : refuse(404, "not_found", "Lumper case not found.");
}

export async function reopenLumperCase(admin: SupabaseClient, orgId: string, caseId: string): Promise<{ orderId: string; wasReason: string | null } | LumperRefusal> {
  const before = await admin.from("lumper_cases").select("order_id, close_reason, closed_at").eq("org_id", orgId).eq("id", caseId).maybeSingle();
  if (before.error) throw new Error(`[lumper] case not read: ${before.error.message}`);
  const was = before.data as { order_id: string; close_reason: string | null; closed_at: string | null } | null;
  if (!was) return refuse(404, "not_found", "Lumper case not found.");
  if (was.closed_at == null) return refuse(409, "not_closed", "This case is not closed.");
  const { error } = await admin
    .from("lumper_cases")
    .update({ closed_at: null, closed_by: null, close_reason: null, close_note: null })
    .eq("org_id", orgId).eq("id", caseId);
  if (error) throw new Error(`[lumper] case not reopened: ${error.message}`);
  return { orderId: was.order_id, wasReason: was.close_reason };
}
