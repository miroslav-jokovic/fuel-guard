import type { SupabaseClient } from "@supabase/supabase-js";
import { fleetpalInvoiceFilesSchema, type FleetpalInvoiceAttachment, type FleetpalInvoiceFiles, type WorkOrderFile, type WorkOrderFilesDto } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { FleetpalClient } from "./client.js";
import { getApiKey } from "./credentials.js";

/**
 * The vendor's paper behind a work order: the files a shop attached to each invoice in FleetPal
 * (FLEETPAL-INTEGRATION-PLAN F16, D-FP28). The owner, 2026-11-18: on the roadside inspection page "we can
 * see work order numbers but not the work order, and we can't see whether a receipt is attached".
 *
 * ── THE FILES WERE ALWAYS THERE; OUR COPY OF THE SPEC WAS NOT ─────────────────────────────────────
 * Q-IC12 (2026-10-15) and D-FP27 (2026-11-17) were both ruled believing "FleetPal's API serves no files".
 * That was true of the spec the owner downloaded before 2026-09-09 (71 paths). FleetPal's live document
 * (`/v1/openapi.json`, 174 paths) gives every purchase-order invoice an `attachments` array, and on
 * 2026-11-18 358 of the 365 invoices updated since 10-01 carried one — a PDF, every one sampled. Invoices
 * since 2025-04 carry files at 85–100% a month.
 *
 * ── READ LIVE, NEVER STORED (D-FP28) ──────────────────────────────────────────────────────────────
 * Each file's link is pre-signed and expires in an hour, so a stored link is a dead link by lunch, and
 * storing the BYTES would make us a second, unbacked copy of FleetPal's paper (see the 10/26 storage
 * deletion). So the list is asked of FleetPal when a person opens a work order, and the bytes when they
 * open a file — one call per invoice, a handful per work order. The certified roadside record is the one
 * place a frozen copy may be right (a filed document is frozen); that is Q-FP16, not this file.
 *
 * ── ORG SCOPE COMES FROM OUR TABLES, BEFORE FLEETPAL IS ASKED ─────────────────────────────────────
 * The API reads with the service role. Which invoices a work order has is read from OUR staged rows,
 * filtered by org, and the file route refuses an invoice id that is not on that list — so an id typed
 * into a URL never reaches FleetPal, even though the org's own key could not read another carrier's.
 */

/** A work order's invoices, as FleetPal ids, in the order the drawer lists them; null when not this org's. */
export async function readWorkOrderInvoiceIds(admin: SupabaseClient, orgId: string, rowId: string): Promise<string[] | null> {
  const wo = await admin.from("fleetpal_work_orders").select("fleetpal_id").eq("org_id", orgId).eq("id", rowId).maybeSingle();
  if (wo.error) throw new Error(`fleetpal_work_orders: ${wo.error.message}`);
  const fleetpalId = (wo.data as { fleetpal_id: string } | null)?.fleetpal_id;
  if (!fleetpalId) return null;
  const pos = await admin.from("fleetpal_purchase_orders").select("fleetpal_id").eq("org_id", orgId).eq("work_order_fleetpal_id", fleetpalId).order("id");
  if (pos.error) throw new Error(`fleetpal_purchase_orders: ${pos.error.message}`);
  const poIds = ((pos.data ?? []) as { fleetpal_id: string }[]).map((p) => p.fleetpal_id);
  if (poIds.length === 0) return [];
  const inv = await admin.from("fleetpal_po_invoices").select("fleetpal_id").eq("org_id", orgId).in("purchase_order_fleetpal_id", poIds).order("id");
  if (inv.error) throw new Error(`fleetpal_po_invoices: ${inv.error.message}`);
  return ((inv.data ?? []) as { fleetpal_id: string }[]).map((i) => i.fleetpal_id);
}

/** What the org's FleetPal connection lets us do right now. */
async function clientFor(admin: SupabaseClient, env: Env, orgId: string, fetchImpl?: typeof fetch): Promise<FleetpalClient | null> {
  const credential = await getApiKey(admin, env, orgId).catch(() => null);
  return credential ? new FleetpalClient({ ...credential, timeoutMs: 10_000, maxRetries: 1, fetchImpl }) : null;
}

const invoicePath = (invoiceId: string) => `/v1/purchase-order-invoices/${encodeURIComponent(invoiceId)}/`;

/**
 * The files on a work order's invoices, without their links. "No file" is only ever answered after
 * FleetPal was asked and said so — a missing key or a FleetPal outage is its own state, because "no
 * receipt attached" is a statement about the shop's paperwork and must not be said about our connection.
 */
export async function listWorkOrderFiles(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  invoiceIds: readonly string[],
  fetchImpl?: typeof fetch,
): Promise<WorkOrderFilesDto> {
  if (invoiceIds.length === 0) return { state: "read", files: [] };
  const client = await clientFor(admin, env, orgId, fetchImpl);
  if (!client) return { state: "not_connected" };
  let invoices: FleetpalInvoiceFiles[];
  try {
    invoices = await Promise.all(invoiceIds.map((id) => client.get(invoicePath(id), fleetpalInvoiceFilesSchema)));
  } catch {
    return { state: "unreachable" };
  }
  const files: WorkOrderFile[] = invoices.flatMap((inv) =>
    inv.attachments.map((a) => ({ invoiceId: inv.id, index: a.index, filename: a.filename, contentType: a.content_type ?? null })),
  );
  return { state: "read", files };
}

/** A scanned bill is tens of kilobytes (33 KB sampled); this only stops a wrong link streaming forever. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type InvoiceFileResult =
  | { kind: "file"; filename: string; contentType: string; bytes: Buffer }
  | { kind: "not_connected" }
  | { kind: "missing" }
  | { kind: "unreachable" }
  | { kind: "too_large" };

/**
 * One file's bytes. The caller has already checked the invoice is on the org's work order. The signed
 * link is fetched fresh, WITHOUT the API key (the vendor's instruction), and only over https.
 */
export async function fetchInvoiceFile(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  invoiceId: string,
  index: number,
  fetchImpl: typeof fetch = fetch,
): Promise<InvoiceFileResult> {
  const client = await clientFor(admin, env, orgId, fetchImpl);
  if (!client) return { kind: "not_connected" };
  let invoice: FleetpalInvoiceFiles;
  try {
    invoice = await client.get(invoicePath(invoiceId), fleetpalInvoiceFilesSchema);
  } catch {
    return { kind: "unreachable" };
  }
  const file = invoice.attachments.find((a) => a.index === index);
  if (!file) return { kind: "missing" };
  return followSignedLink(file, fetchImpl);
}

/** One signed link, fetched without our key, https only, size-capped. */
async function followSignedLink(file: FleetpalInvoiceAttachment, fetchImpl: typeof fetch): Promise<InvoiceFileResult> {
  if (!file.url.startsWith("https://")) return { kind: "unreachable" };
  let res: Response;
  try {
    res = await fetchImpl(file.url, { signal: AbortSignal.timeout(20_000) });
  } catch {
    return { kind: "unreachable" };
  }
  if (!res.ok) return { kind: "unreachable" };
  if (Number(res.headers.get("content-length") ?? 0) > MAX_FILE_BYTES) return { kind: "too_large" };
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES) return { kind: "too_large" };
  const contentType = file.content_type ?? res.headers.get("content-type") ?? "application/octet-stream";
  return { kind: "file", filename: file.filename, contentType, bytes };
}

export interface DownloadedInvoiceFile {
  invoiceId: string;
  index: number;
  filename: string;
  contentType: string;
  bytes: Buffer;
}

/**
 * EVERY file on the given invoices, bytes and all — for freezing a copy when a roadside repair is certified
 * (Q12 (a), F16c). All or nothing: a certification that copied some bills and silently missed one would
 * certify paper it does not hold, so any failure answers the whole call. Read only at that moment; the
 * drawer never calls this.
 */
export async function downloadInvoiceFiles(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  invoiceIds: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ state: "read"; files: DownloadedInvoiceFile[] } | { state: "not_connected" | "unreachable" | "too_large" }> {
  if (invoiceIds.length === 0) return { state: "read", files: [] };
  const client = await clientFor(admin, env, orgId, fetchImpl);
  if (!client) return { state: "not_connected" };
  const files: DownloadedInvoiceFile[] = [];
  for (const invoiceId of [...new Set(invoiceIds)]) {
    let invoice: FleetpalInvoiceFiles;
    try {
      invoice = await client.get(invoicePath(invoiceId), fleetpalInvoiceFilesSchema);
    } catch {
      return { state: "unreachable" };
    }
    for (const a of invoice.attachments) {
      const got = await followSignedLink(a, fetchImpl);
      if (got.kind !== "file") return { state: got.kind === "too_large" ? "too_large" : "unreachable" };
      files.push({ invoiceId, index: a.index, filename: got.filename, contentType: got.contentType, bytes: got.bytes });
    }
  }
  return { state: "read", files };
}
