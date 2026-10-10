import type { DocumentProfileId } from "@silvicom/shared";
import { anthropicClient } from "../../lib/anthropic.js";
import { executeRead, failUnavailableRead, TransientModelError, type ReadGateFor } from "../../modules/document-reading/index.js";
import { shippingDocumentReadGate } from "../../modules/hazmat/index.js";
import type { JobHandler } from "../types.js";

/**
 * `document_read` — one document read (DOCUMENT-READER-PLAN.md Step 1.6, §2 Queue). Payload `{ readId }`.
 *
 * This is the composition root: the reader knows no consumer (D-DR1), so each profile's gate is wired
 * here — `shipping_document` passes the Hazmat Calculator's (documentReadGate.ts). A profile added to
 * the registry without a gate fails to compile below rather than reading ungated.
 *
 * IDEMPOTENT (plan Q9): a read already `done` or `failed` is skipped, and `reading → reading` is the
 * RPC's no-op, so a lease-expired retry re-runs a read that never finished and touches one that did not.
 *
 * Transient vs terminal (§2): `executeRead` RETHROWS a transient model error, so the queue's backoff
 * retries it. The queue counts an attempt when it claims the job (0095 `claim_next_job`) and requeues a
 * failure only while `attempts < max_attempts` (`fail_job`), so on the last attempt this handler ends
 * the read as `model_unavailable` first — otherwise the job would fail and the read would poll as
 * `reading` for ever — and then rethrows, so the job records the error too.
 */
const GATES = {
  shipping_document: (admin, orgId) => shippingDocumentReadGate(admin, orgId),
} as const satisfies Record<DocumentProfileId, (...a: Parameters<ReadGateFor>) => ReturnType<ReadGateFor>>;
const gateFor: ReadGateFor = (admin, orgId, profile) => GATES[profile](admin, orgId);

export const documentReadHandler: JobHandler = async (ctx, job) => {
  const readId = typeof job.payload.readId === "string" ? job.payload.readId : "";
  if (!readId) throw new Error("document_read job has no readId");
  try {
    const r = await executeRead(ctx.admin, job.org_id, readId, { client: anthropicClient(ctx.env), gateFor, env: ctx.env });
    return { readId, ...r };
  } catch (e) {
    if (e instanceof TransientModelError && job.attempts >= job.max_attempts) await failUnavailableRead(ctx.admin, job.org_id, readId);
    throw e;
  }
};
