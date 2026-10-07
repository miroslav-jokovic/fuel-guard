import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DriverFuelFileFormat, DriverFuelRow, IftaReceiptRaw, IftaReceiptSource, IftaReceiptUploadSummary, IftaTruckBasis,
} from "@silvicom/shared";

/**
 * The one writer of `ifta_fuel_receipt_uploads` and `ifta_fuel_receipts` (0436), and their reads
 * (IFTA-PRECISION-PLAN IP8). Every query is org-filtered by hand: the service role bypasses RLS.
 *
 * Both tables are append-only by trigger. The writes here are an INSERT of an upload, one INSERT of
 * all its receipts, and the void stamp — nothing else is possible, and nothing else is attempted.
 */

const SOURCE_OF: Record<DriverFuelFileFormat, IftaReceiptSource> = {
  fuel_app_csv: "fuel_app",
  mcleod_ticket_export: "mcleod_export",
};

interface ReceiptRow {
  id: string;
  vehicle_id: string;
  jurisdiction: string;
  fueled_on: string;
  gallons: number | string;
  price_per_gal: number | string | null;
  amount_paid: number | string | null;
  station: string | null;
  city: string | null;
  unit_as_filed: string | null;
  ifta_fuel_receipt_uploads: { format: DriverFuelFileFormat } | null;
}

const num = (v: number | string | null) => (v == null ? null : Number(v));

/** The live uploaded receipts in `[fromDay, toDayExclusive)`, optionally one jurisdiction, as IFTA receipts. */
export async function readUploadedReceipts(
  admin: SupabaseClient,
  orgId: string,
  fromDay: string,
  toDayExclusive: string,
  jurisdiction?: string,
): Promise<IftaReceiptRaw[]> {
  const out: IftaReceiptRaw[] = [];
  // Paged: PostgREST caps every response at 1,000 rows (postgrest-caps-every-response-at-1000).
  for (let from = 0; ; from += 1000) {
    let q = admin
      .from("ifta_fuel_receipts")
      .select("id, vehicle_id, jurisdiction, fueled_on, gallons, price_per_gal, amount_paid, station, city, unit_as_filed, ifta_fuel_receipt_uploads!inner(format)")
      .eq("org_id", orgId)
      .is("voided_at", null)
      .gte("fueled_on", fromDay)
      .lt("fueled_on", toDayExclusive)
      .order("id")
      .range(from, from + 999);
    if (jurisdiction) q = q.eq("jurisdiction", jurisdiction);
    const { data, error } = await q;
    if (error) throw new Error(`ifta_fuel_receipts read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as ReceiptRow[];
    for (const r of rows) {
      out.push({
        externalId: r.id,
        source: SOURCE_OF[r.ifta_fuel_receipt_uploads?.format ?? "fuel_app_csv"],
        vehicleId: r.vehicle_id,
        unitAsFiled: r.unit_as_filed ?? "",
        jurisdiction: r.jurisdiction,
        receiptDate: r.fueled_on,
        gallons: Number(r.gallons),
        location: [r.station, r.city].filter(Boolean).join(" · ") || null,
        pricePerGal: num(r.price_per_gal),
        totalCost: num(r.amount_paid),
      });
    }
    if (rows.length < 1000) break;
  }
  return out;
}

/** Which of these fingerprints already have a live receipt — the rows a re-upload must not add again. */
export async function readLiveFingerprints(admin: SupabaseClient, orgId: string, fingerprints: string[]): Promise<Set<string>> {
  const live = new Set<string>();
  for (let i = 0; i < fingerprints.length; i += 200) {
    const { data, error } = await admin
      .from("ifta_fuel_receipts")
      .select("fingerprint")
      .eq("org_id", orgId)
      .is("voided_at", null)
      .in("fingerprint", fingerprints.slice(i, i + 200));
    if (error) throw new Error(`ifta_fuel_receipts read failed: ${error.message}`);
    for (const r of (data ?? []) as Array<{ fingerprint: string }>) live.add(r.fingerprint);
  }
  return live;
}

export interface UploadToRecord {
  fileName: string;
  fileSha256: string;
  format: DriverFuelFileFormat;
  rowsInFile: number;
  rowsAlreadyPresent: number;
  rowsRefused: number;
  uploadedBy: string | null;
  receipts: Array<{ row: DriverFuelRow; vehicleId: string; truckBasis: IftaTruckBasis }>;
}

/**
 * Lands one upload. The receipts go in ONE insert statement, so they land together or not at all;
 * if that insert fails after the upload row exists, the upload is voided with the reason, so no
 * upload ever claims receipts it does not have.
 */
export async function recordUpload(admin: SupabaseClient, orgId: string, u: UploadToRecord): Promise<string> {
  const { data: upload, error } = await admin
    .from("ifta_fuel_receipt_uploads")
    .insert({
      org_id: orgId,
      file_name: u.fileName,
      file_sha256: u.fileSha256,
      format: u.format,
      rows_in_file: u.rowsInFile,
      rows_imported: u.receipts.length,
      rows_already_present: u.rowsAlreadyPresent,
      rows_refused: u.rowsRefused,
      uploaded_by: u.uploadedBy,
    })
    .select("id")
    .single();
  if (error || !upload) throw new Error(`ifta_fuel_receipt_uploads insert failed: ${error?.message ?? "no row"}`);
  const uploadId = (upload as { id: string }).id;
  if (u.receipts.length === 0) return uploadId;

  const { error: rowsError } = await admin.from("ifta_fuel_receipts").insert(
    u.receipts.map(({ row, vehicleId, truckBasis }) => ({
      org_id: orgId,
      upload_id: uploadId,
      vehicle_id: vehicleId,
      truck_basis: truckBasis,
      jurisdiction: row.jurisdiction,
      fueled_on: row.fueledOn,
      fueled_time_local: row.fueledTimeLocal,
      gallons: row.gallons,
      price_per_gal: row.pricePerGal,
      amount_paid: row.amountPaid,
      fuel_type: row.fuelType,
      station: row.station,
      city: row.city,
      postal_code: row.postalCode,
      external_ref: row.externalRef,
      unit_as_filed: row.unitAsFiled,
      driver_as_filed: row.driverAsFiled,
      fingerprint: row.fingerprint,
      raw: row.raw,
    })),
  );
  if (rowsError) {
    await admin
      .from("ifta_fuel_receipt_uploads")
      .update({ voided_at: new Date().toISOString(), void_reason: `receipts did not land: ${rowsError.message}`.slice(0, 500) })
      .eq("org_id", orgId)
      .eq("id", uploadId);
    throw new Error(`ifta_fuel_receipts insert failed: ${rowsError.message}`);
  }
  return uploadId;
}

/**
 * Voids an upload and every live receipt it brought — the undo for a wrong file. Receipts first: an
 * upload marked void whose receipts still count would be the worse half-state. Returns false when
 * the upload is not this org's or is already void.
 */
export async function voidUpload(
  admin: SupabaseClient,
  orgId: string,
  uploadId: string,
  actorId: string | null,
  reason: string,
): Promise<{ voided: boolean; receipts: number }> {
  const { data: upload, error } = await admin
    .from("ifta_fuel_receipt_uploads")
    .select("id, voided_at")
    .eq("org_id", orgId)
    .eq("id", uploadId)
    .maybeSingle();
  if (error) throw new Error(`ifta_fuel_receipt_uploads read failed: ${error.message}`);
  if (!upload || (upload as { voided_at: string | null }).voided_at) return { voided: false, receipts: 0 };

  const stamp = { voided_at: new Date().toISOString(), voided_by: actorId, void_reason: reason };
  const { data: receipts, error: rErr } = await admin
    .from("ifta_fuel_receipts")
    .update(stamp)
    .eq("org_id", orgId)
    .eq("upload_id", uploadId)
    .is("voided_at", null)
    .select("id");
  if (rErr) throw new Error(`ifta_fuel_receipts void failed: ${rErr.message}`);
  const { error: uErr } = await admin
    .from("ifta_fuel_receipt_uploads")
    .update(stamp)
    .eq("org_id", orgId)
    .eq("id", uploadId);
  if (uErr) throw new Error(`ifta_fuel_receipt_uploads void failed: ${uErr.message}`);
  return { voided: true, receipts: (receipts ?? []).length };
}

interface UploadListRow {
  id: string;
  file_name: string;
  format: DriverFuelFileFormat;
  uploaded_at: string;
  uploaded_by: string | null;
  rows_imported: number;
  rows_already_present: number;
  rows_refused: number;
  voided_at: string | null;
  void_reason: string | null;
}

/** The latest uploads, newest first, each with the gallons and dates of the receipts it brought. */
export async function listUploads(admin: SupabaseClient, orgId: string, limit = 50): Promise<IftaReceiptUploadSummary[]> {
  const { data, error } = await admin
    .from("ifta_fuel_receipt_uploads")
    .select("id, file_name, format, uploaded_at, uploaded_by, rows_imported, rows_already_present, rows_refused, voided_at, void_reason")
    .eq("org_id", orgId)
    .order("uploaded_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`ifta_fuel_receipt_uploads read failed: ${error.message}`);
  const uploads = (data ?? []) as UploadListRow[];
  if (uploads.length === 0) return [];

  const facts = new Map<string, { gallons: number; first: string | null; last: string | null }>();
  const ids = uploads.map((u) => u.id);
  for (let i = 0; i < ids.length; i += 50) {
    for (let from = 0; ; from += 1000) {
      const { data: rows, error: rErr } = await admin
        .from("ifta_fuel_receipts")
        .select("upload_id, fueled_on, gallons")
        .eq("org_id", orgId)
        .in("upload_id", ids.slice(i, i + 50))
        .order("id")
        .range(from, from + 999);
      if (rErr) throw new Error(`ifta_fuel_receipts read failed: ${rErr.message}`);
      const page = (rows ?? []) as Array<{ upload_id: string; fueled_on: string; gallons: number | string }>;
      for (const r of page) {
        const f = facts.get(r.upload_id) ?? { gallons: 0, first: null, last: null };
        f.gallons += Number(r.gallons);
        if (!f.first || r.fueled_on < f.first) f.first = r.fueled_on;
        if (!f.last || r.fueled_on > f.last) f.last = r.fueled_on;
        facts.set(r.upload_id, f);
      }
      if (page.length < 1000) break;
    }
  }
  return uploads.map((u) => {
    const f = facts.get(u.id);
    return {
      id: u.id,
      fileName: u.file_name,
      format: u.format,
      uploadedAt: u.uploaded_at,
      uploadedBy: u.uploaded_by,
      rowsImported: u.rows_imported,
      rowsAlreadyPresent: u.rows_already_present,
      rowsRefused: u.rows_refused,
      gallons: Math.round((f?.gallons ?? 0) * 1000) / 1000,
      firstDay: f?.first ?? null,
      lastDay: f?.last ?? null,
      voidedAt: u.voided_at,
      voidReason: u.void_reason,
    };
  });
}
