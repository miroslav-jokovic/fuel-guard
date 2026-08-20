import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DOCUMENTS_BUCKET,
  PSP_STATUS,
  documentStoragePath,
  PSP_SOURCE_API,
  buildPspDraft,
  isCleanRecord,
  pspNameParts,
  resolveCarrierIdentity,
  missingAuthorizations,
  validatePspRequest,
  type AuthorizationPurpose,
  type AuthorizationRow,
  type CarrierIdentity,
  type PspReport,
  type PspRequestDraft,
} from "@fuelguard/shared";
import { pspApiKey, pspApiKeyVar, type Env } from "../env.js";

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

/**
 * What the GATES need, which is less than an order needs.
 *
 * Split out so the preflight does not have to invent a user id it has no use for. It used to pass
 * `userId: ""`, and a fabricated value in a struct is the kind of thing that is harmless until
 * somebody adds a gate that reads it.
 */
export interface PspGateInput {
  orgId: string;
  driverId: string;
  /** Whether the caller presented a fresh re-authentication on THIS request. */
  stepUp: boolean;
  /**
   * Request-SHAPING rather than gate-deciding, but the gates hand back the draft they validated, so
   * the draft's inputs belong here. Both are optional: the preflight builds a draft only to run the
   * validator over it and never sends one.
   *
   * §5.4.1 requires `userIPAddress` and never defines it for a system-to-system caller (Q4).
   * `monitor` enrols the transaction in 45-day monitoring — off unless asked for; §6 explains why,
   * and nothing asks for it until P8 exists to read what it reports.
   */
  userIPAddress?: string | null;
  monitor?: boolean;
}

export interface PspOrderInput extends PspGateInput {
  userId: string;
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
 * Splitting a name for PSP now lives in `@fuelguard/shared` (psp/identity.ts), because the readiness
 * report has to split it the SAME way — a report that judged a different name from the one the order
 * sends would call a driver ready whom PSP then refuses, and PSP bills on Failure (§8). Kept as a
 * named export here for the callers that already had it.
 */
const nameParts = pspNameParts;

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

/**
 * Which carrier is asking — the organisation's own DOT number, falling back to the deployment's.
 *
 * Org-filtered like every other read here: the service role bypasses RLS, and "read one row by the
 * id I was given" is exactly the query that quietly crosses a tenant boundary when the id is wrong.
 */
async function carrierIdentity(admin: SupabaseClient, env: Env, orgId: string): Promise<CarrierIdentity> {
  const { data } = await admin
    .from("organizations")
    .select("dot_number")
    .eq("id", orgId)
    .maybeSingle();
  return resolveCarrierIdentity({
    orgDotNumber: (data as { dot_number: string | null } | null)?.dot_number ?? null,
    envDotNumber: env.PSP_DOT_NUMBER ?? null,
    envMotorCarrierId: env.PSP_MOTOR_CARRIER_ID ?? null,
    environment: env.PSP_ENVIRONMENT,
  });
}

/**
 * Every refusal, in the order legality → authority → budget → correctness.
 *
 * `opts.authority` exists for the preflight, which asks what stands in the way BEFORE anybody has
 * been asked for a password. It used to get that answer by passing `stepUp: true` — asserting
 * something false to skip a check — and this says the same thing truthfully: run every gate except
 * the one about who is asking. The ORDER path never passes it, so there is no way to skip the
 * password on a request that spends money.
 */
export async function checkPspGates(
  admin: SupabaseClient,
  env: Env,
  input: PspGateInput,
  driver: DriverRow,
  opts: { authority?: boolean } = {},
): Promise<PspRefusal | { draft: PspRequestDraft }> {
  if (!env.PSP_ORDERS_ENABLED) {
    return { code: "psp_disabled", message: "PSP ordering is switched off for this deployment." };
  }

  // The production interlock. `PSP_ENVIRONMENT` is a one-word edit that turns every subsequent order
  // into a real charge against a live account-holder agreement and a real person's violation history,
  // so it is not allowed to be the only thing standing there. Both switches, or neither means
  // anything — a typo, a copied `.env` or a deploy template carrying the wrong value cannot start
  // spending on its own.
  if (env.PSP_ENVIRONMENT === "production" && !env.PSP_PRODUCTION_ACKNOWLEDGED) {
    return {
      code: "psp_disabled",
      message:
        "PSP is pointed at PRODUCTION, where every request is a real charge. Set "
        + "PSP_PRODUCTION_ACKNOWLEDGED=true to confirm that is intended.",
    };
  }
  if (!pspApiKey(env)) {
    return {
      code: "psp_not_configured",
      message: `PSP is not configured: ${pspApiKeyVar(env)} is unset.`,
    };
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
  if (opts.authority !== false && !input.stepUp) {
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
  //
  // The carrier on the request is THIS ORG, not the deployment (psp/identity.ts). `internalRefId` is
  // our key, stored by PSP and echoed on every response and on the 45-day report (§6), so a reply
  // resolves back to a driver without a mapping table and without name-matching.
  const draft = buildPspDraft({
    driver,
    carrier: await carrierIdentity(admin, env, input.orgId),
    internalRefId: input.driverId,
    consent: true,
    userIPAddress: input.userIPAddress ?? null,
    monitor: input.monitor === true,
  });
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
      //
      // `source` is STATED here rather than inferred downstream (P9). A reader cannot tell an
      // ordered record for a driver with no inspections from an unread import by looking at the
      // counts, because both have none — see psp/provenance.ts.
      detail: {
        source: PSP_SOURCE_API,
        summary: report.summary,
        inspections: report.inspections.length,
        crashes: report.crashes.length,
      },
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
      // The rate at the moment we decided to spend (0219). Stamped here rather than at settle so it
      // survives a settle that never completes, and null when nobody has told us the price (Q2) —
      // which reads as "we were not told", not as "free".
      unit_price_usd: env.PSP_UNIT_PRICE_USD ?? null,
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

export { billedThisMonth, carrierIdentity, nameParts, redactRequest, ingestReport };
export type { DriverRow };

/**
 * What ordering this record would cost and what stands in its way — P9's confirmation, computed
 * without touching the vendor.
 *
 * ── STEP-UP IS NOT REPORTED AS A BLOCKER HERE ──────────────────────────────────────────────────
 * `checkPspGates` refuses in the order legality → authority → budget → correctness, and the preview
 * runs it with `stepUp: true` on purpose. Asking somebody to re-type their password and only THEN
 * telling them the driver never signed the disclosure is the wrong order to learn things in. The
 * password is the last step before spending, not the first step towards finding out whether we may.
 */
export async function pspOrderPreflight(
  admin: SupabaseClient,
  env: Env,
  input: { orgId: string; driverId: string },
): Promise<{
  enabled: boolean;
  environment: string;
  /** Who the request would name as the requesting carrier — the org's own number, or the fallback. */
  carrier: CarrierIdentity;
  budget: { used: number; limit: number; remaining: number };
  unitPriceUsd: number | null;
  /** The §8.5 outcomes that carry the transaction fee, read from the status table, never listed here. */
  billsOn: string[];
  refusal: PspRefusal | null;
}> {
  const used = await billedThisMonth(admin, input.orgId, new Date());
  const budget = { used, limit: env.PSP_MONTHLY_LIMIT, remaining: Math.max(0, env.PSP_MONTHLY_LIMIT - used) };
  const billsOn = Object.values(PSP_STATUS).filter((s) => s.billed).map((s) => s.outcome);

  const { data: driver } = await admin
    .from("drivers")
    .select(DRIVER_COLS)
    .eq("id", input.driverId)
    .eq("org_id", input.orgId)
    .maybeSingle();

  const base = {
    enabled: env.PSP_ORDERS_ENABLED && pspApiKey(env) !== null,
    environment: env.PSP_ENVIRONMENT,
    carrier: await carrierIdentity(admin, env, input.orgId),
    budget,
    unitPriceUsd: env.PSP_UNIT_PRICE_USD ?? null,
    billsOn,
  };
  if (!driver) {
    return { ...base, refusal: { code: "invalid_request", message: "Driver not found", issues: [] } };
  }

  const gated = await checkPspGates(
    admin, env,
    { orgId: input.orgId, driverId: input.driverId, stepUp: false },
    driver as DriverRow,
    { authority: false },
  );
  return { ...base, refusal: "code" in gated ? gated : null };
}
