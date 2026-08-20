import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DOCUMENTS_BUCKET,
  documentStoragePath,
  isCleanRecord,
  missingAuthorizations,
  validatePspRequest,
  type AuthorizationPurpose,
  type AuthorizationRow,
  type PspReport,
  type PspRequestDraft,
} from "@fuelguard/shared";
import type { Env } from "../env.js";

/**
 * Ordering a PSP record — P6 and P7 (HIRING-PLAN H7).
 *
 * **Governance is the feature here, not the vendor call.** §8 charges the transaction fee on
 * `Success`, `Partial` AND `Failure`, so every gate below is a gate on money as well as on law, and
 * each one refuses BEFORE the ledger row exists so a refusal costs nothing and leaves no trace to
 * explain.
 *
 * The order is deliberate: legality first, then authority, then budget, then correctness. Asking
 * "can we afford it" before "are we allowed" would be the wrong question in the wrong order even
 * when both answers refuse.
 */

export type PspRefusal =
  | { code: "psp_disabled"; message: string }
  | { code: "psp_not_configured"; message: string }
  | { code: "authorization_missing"; message: string; missing: AuthorizationPurpose[] }
  | { code: "step_up_required"; message: string }
  | { code: "budget_exceeded"; message: string; used: number; limit: number }
  | { code: "invalid_request"; message: string; issues: Array<{ field: string; message: string }> }
  | { code: "already_in_flight"; message: string };

export interface PspOrderResult {
  requestId: string;
  report: PspReport;
  documentId: string | null;
  recordId: string | null;
  clean: boolean;
}

export interface PspOrderInput {
  orgId: string;
  driverId: string;
  userId: string;
  /** Whether the caller presented a fresh re-authentication on THIS request. */
  stepUp: boolean;
  /** §5.4.1 requires it and never defines it for a system-to-system caller (PSP-PLAN Q4). */
  userIPAddress?: string | null;
  /** §5.4.1 — enrol in 45-day monitoring. Off unless asked for; §6 explains why. */
  monitor?: boolean;
}

interface DriverRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  date_of_birth: string | null;
  cdl_number: string | null;
  cdl_state: string | null;
}

/** Count what we have actually bought this month. See `checkBudget`. */
async function billedThisMonth(admin: SupabaseClient, orgId: string, now: Date): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count } = await admin
    .from("psp_requests")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("billed", true)
    .gte("created_at", monthStart);
  return count ?? 0;
}

/**
 * Names are split for PSP, which wants them separately and holds each to 20 characters (§8.5 details
 * 2, 25). `drivers.full_name` is NOT NULL and the structured parts are not, so this falls back to
 * splitting the full name — and the validator then refuses whatever that produced if it is not
 * something PSP will match on. Guessing badly and being refused for free beats not asking.
 */
function nameParts(driver: DriverRow): { first: string; last: string } {
  if (driver.first_name?.trim() && driver.last_name?.trim()) {
    return { first: driver.first_name.trim(), last: driver.last_name.trim() };
  }
  const parts = driver.full_name.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.length > 1 ? parts[parts.length - 1]! : "" };
}

/**
 * Redact the request body before it is stored. It carries a licence number and a date of birth, and
 * `psp_requests.request_body` is read by anyone debugging an order — the `redactCardXml` rule
 * (9a7a125) applied to the two fields that matter.
 */
function redactRequest(draft: PspRequestDraft): Record<string, unknown> {
  return {
    driverFirstName: draft.driverFirstName,
    driverLastName: draft.driverLastName,
    driverDOB: "[redacted]",
    dotNumber: draft.dotNumber ?? null,
    motorCarrierId: draft.motorCarrierId ?? null,
    internalRefId: draft.internalRefId,
    monitor: draft.monitor === true,
    licenseQueries: draft.licenseQueries.map((q) => ({
      dlState: q.dlState,
      dlNum: "[redacted]",
      dlLastName: q.dlLastName,
    })),
  };
}

/** Every refusal, in the order legality → authority → budget → correctness. */
export async function checkPspGates(
  admin: SupabaseClient,
  env: Env,
  input: PspOrderInput,
  driver: DriverRow,
): Promise<PspRefusal | { draft: PspRequestDraft }> {
  if (!env.PSP_ORDERS_ENABLED) {
    return { code: "psp_disabled", message: "PSP ordering is switched off for this deployment." };
  }
  if (!env.PSP_API_KEY) {
    return { code: "psp_not_configured", message: "PSP is not configured." };
  }

  // 1. LEGALITY. PSP refuses the request without the driver's authorization (§8.5 detail 17) and so
  //    do we — before the request is even built, so nothing can send `driverConsent: true` on the
  //    strength of a developer's opinion.
  const { data: auths } = await admin
    .from("driver_authorizations")
    .select("id, purpose, accepted_at, revokes")
    .eq("org_id", input.orgId)
    .eq("driver_id", input.driverId);
  const missing = missingAuthorizations((auths ?? []) as AuthorizationRow[], "psp_record");
  if (missing.length > 0) {
    return {
      code: "authorization_missing",
      message: "The driver has not signed everything a PSP request requires.",
      missing,
    };
  }

  // 2. AUTHORITY. It spends money and pulls a person's record.
  if (!input.stepUp) {
    return { code: "step_up_required", message: "Confirm your password to order a PSP record." };
  }

  // 3. BUDGET.
  const used = await billedThisMonth(admin, input.orgId, new Date());
  if (used >= env.PSP_MONTHLY_LIMIT) {
    return {
      code: "budget_exceeded",
      message: `This month's PSP limit of ${env.PSP_MONTHLY_LIMIT} records has been reached.`,
      used,
      limit: env.PSP_MONTHLY_LIMIT,
    };
  }

  // 4. CORRECTNESS — the cost control. A Failure costs the same as a hit (§8), so a licence number
  //    with a space in it is a purchase we can decline to make.
  const { first, last } = nameParts(driver);
  const draft: PspRequestDraft = {
    driverFirstName: first,
    driverLastName: last,
    driverDOB: driver.date_of_birth ?? "",
    dotNumber: env.PSP_DOT_NUMBER ?? null,
    motorCarrierId: env.PSP_MOTOR_CARRIER_ID ?? null,
    // Our key, stored by PSP and echoed on every response and on the 45-day report (§6), so a reply
    // resolves back to a driver without a mapping table and without name-matching.
    internalRefId: input.driverId,
    driverConsent: true,
    userIPAddress: input.userIPAddress ?? null,
    monitor: input.monitor === true,
    licenseQueries: [
      {
        dlNum: driver.cdl_number ?? "",
        dlState: driver.cdl_state ?? "",
        dlFirstName: first,
        dlLastName: last,
      },
    ],
  };
  const issues = validatePspRequest(draft, new Date().toISOString().slice(0, 10));
  if (issues.length > 0) {
    return {
      code: "invalid_request",
      message: "This driver's details would not match a PSP record.",
      issues: issues.map((i) => ({ field: i.field, message: i.message })),
    };
  }

  return { draft };
}

/** P7: file the PDF into `documents`, then cite it from a `qualification_records` row. */
async function ingestReport(
  admin: SupabaseClient,
  input: PspOrderInput,
  report: PspReport,
  pdf: Buffer | null,
): Promise<{ documentId: string | null; recordId: string | null }> {
  let documentId: string | null = null;
  if (pdf) {
    documentId = randomUUID();
    const path = documentStoragePath(input.orgId, "driver", input.driverId, documentId, "application/pdf");
    const { error: uploadError } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, pdf, { contentType: "application/pdf", upsert: false });
    if (uploadError) {
      // The report is bought and the row is worth keeping even if the bytes did not land; the PDF is
      // re-fetchable for 120 hours (§7) and the raw response holds everything but the rendering.
      documentId = null;
    } else {
      await admin.from("documents").insert({
        id: documentId,
        org_id: input.orgId,
        subject_type: "driver",
        subject_id: input.driverId,
        kind: "psp_report",
        storage_path: path,
        content_type: "application/pdf",
        bytes: pdf.byteLength,
        sha256: createHash("sha256").update(pdf).digest("hex"),
        uploaded_by: input.userId,
      });
    }
  }

  const { data: record } = await admin
    .from("qualification_records")
    .insert({
      org_id: input.orgId,
      driver_id: input.driverId,
      kind: "psp_report",
      occurred_on: (report.requestDate ?? new Date().toISOString()).slice(0, 10),
      result: isCleanRecord(report) ? "clean" : report.outcome,
      reference: report.authCode,
      document_id: documentId,
      // The projection, never the raw response: `psp_requests.response_raw` is the evidence, and a
      // second whole copy in the file would be a second thing to redact and to purge.
      detail: { summary: report.summary, inspections: report.inspections.length, crashes: report.crashes.length },
      created_by: input.userId,
    })
    .select("id")
    .single();

  return { documentId, recordId: (record as { id: string } | null)?.id ?? null };
}

const DRIVER_COLS = "id, first_name, last_name, full_name, date_of_birth, cdl_number, cdl_state";

/**
 * Order one PSP record end to end: gates, ledger, vendor, PDF, ingest, settle.
 *
 * The ledger row goes in AFTER every gate and BEFORE the vendor call, which is the only ordering
 * that is honest in both directions — a refused order leaves no row to explain, and a dispatched one
 * is recorded before it can be charged for.
 */
export async function orderPspRecord(
  admin: SupabaseClient,
  env: Env,
  input: PspOrderInput,
  deps: {
    requestRecord: typeof import("../psp/client.js").requestRecord;
    fetchRecordPdf: typeof import("../psp/client.js").fetchRecordPdf;
  },
): Promise<PspOrderResult | PspRefusal> {
  const { data: driver } = await admin
    .from("drivers")
    .select(DRIVER_COLS)
    .eq("id", input.driverId)
    .eq("org_id", input.orgId)
    .maybeSingle();
  if (!driver) return { code: "invalid_request", message: "Driver not found", issues: [] };

  const gated = await checkPspGates(admin, env, input, driver as DriverRow);
  if ("code" in gated) return gated;
  const { draft } = gated;

  // Written before dispatch. The unique partial index refuses a second in-flight row for this
  // driver, which is what stops two operators clicking at once from buying the same report twice.
  const idempotencyKey = createHash("sha256")
    .update(`${input.orgId}:${input.driverId}:${draft.licenseQueries[0]?.dlNum ?? ""}:${new Date().toISOString().slice(0, 10)}`)
    .digest("hex");
  const { data: ledger, error: ledgerError } = await admin
    .from("psp_requests")
    .insert({
      org_id: input.orgId,
      driver_id: input.driverId,
      internal_ref_id: draft.internalRefId,
      idempotency_key: idempotencyKey,
      request_body: redactRequest(draft),
      status: "sent",
      monitor: draft.monitor === true,
      created_by: input.userId,
    })
    .select("id")
    .single();
  if (ledgerError || !ledger) {
    // The one-in-flight index is the likely cause, and it is a refusal rather than an error: somebody
    // else is already buying this record.
    return { code: "already_in_flight", message: "A PSP request for this driver is already running." };
  }
  const requestId = (ledger as { id: string }).id;

  // Org-scoped as well as id-scoped. The id came from an insert we just made, so this is belt and
  // braces — but the service role bypasses RLS and the house rule is that every query carries its own
  // tenant filter, with no exceptions for ids we believe we know. Caught by "scopes every read to the org".
  const settle = async (patch: Record<string, unknown>) => {
    await admin
      .from("psp_requests")
      .update({ ...patch, settled_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("org_id", input.orgId);
  };

  let report: PspReport;
  let raw: unknown;
  try {
    const result = await deps.requestRecord(env, draft);
    report = result.report;
    raw = result.raw;
  } catch (e) {
    const err = e as { message?: string; charged?: boolean | null };
    // `charged: null` is the transport case — we do not know whether PSP billed us, so the row does
    // not claim either way and a human settles it. NEVER retried (client.ts).
    await settle({
      status: err.charged === null ? "indeterminate" : "failed",
      billed: err.charged === true,
      error: err.message ?? "PSP call failed",
    });
    throw e;
  }

  // The PDF is fetched in the SAME call, because the authCode dies after 120 hours (§7). There is no
  // later, so there is no "download it later".
  let pdf: Buffer | null = null;
  if (report.authCode) {
    pdf = await deps.fetchRecordPdf(env, report.authCode).catch(() => null);
  }

  const filed =
    report.outcome === "success" || report.outcome === "partial"
      ? await ingestReport(admin, input, report, pdf)
      : { documentId: null, recordId: null };

  await settle({
    status:
      report.outcome === "success" ? "succeeded"
      : report.outcome === "partial" ? "partial"
      : report.outcome === "failure" ? "failed"
      : "indeterminate",
    psp_status: report.status,
    psp_status_detail: report.statusDetail,
    psp_status_description: report.statusDescription,
    auth_code: report.authCode,
    // Read from the §8.5 table, not inferred here — and stored, so an invoice reconciliation reads
    // what was true on the day.
    billed: report.billed,
    response_raw: raw,
    document_id: filed.documentId,
  });

  return { requestId, report, ...filed, clean: isCleanRecord(report) };
}

export { billedThisMonth, nameParts, redactRequest, ingestReport };
export type { DriverRow };
