import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocumentProfileId } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { anthropicClient } from "../../lib/anthropic.js";
import {
  executeRead,
  failUnavailableRead,
  ocrEngine,
  TransientModelError,
  type ExecuteReadOutcome,
  type ReadGateFor,
  type RecognisePage,
} from "../../modules/document-reading/index.js";
import { shippingDocumentReadGate } from "../../modules/hazmat/index.js";
import { roadsideReportReadGate } from "../../modules/inspections/index.js";
import { compliancePaperReadGate } from "../../modules/evidence/index.js";
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
 * failure only while `attempts < max_attempts` (`fail_job`). Every OTHER throw ends the job for good, and
 * so does a transient one on the last attempt: then this handler ends the read as `model_unavailable`
 * first — otherwise the job fails and the read polls as `reading` for ever — and rethrows, so the job's
 * error column still says what went wrong.
 *
 * Until 10/12/2026 a configuration error (a bad key, a retired model, an empty credit balance) was only
 * rethrown, on the reasoning that it is not a READING failure. Production showed the cost: the owner's
 * first two reads hit "credit balance is too low" (400), their jobs failed in three seconds, and both
 * reads stayed `reading` — the screen waited three minutes and then said "It will keep going". The read
 * now ends `model_unavailable`, an operational failure that READ_FAILURE_KIND keeps out of the reader's
 * accuracy, and the cause stays in the job's error for whoever fixes it.
 */
const gatesFor = (env: Env) =>
  ({
    shipping_document: (admin, orgId) => shippingDocumentReadGate(admin, orgId),
    roadside_inspection_report: async () => roadsideReportReadGate(env),
    compliance_paper: async () => compliancePaperReadGate(env),
  }) as const satisfies Record<DocumentProfileId, (...a: Parameters<ReadGateFor>) => ReturnType<ReadGateFor>>;
const gateForEnv = (env: Env): ReadGateFor => (admin, orgId, profile) => gatesFor(env)[profile](admin, orgId);

// The OCR witness's engine (§7B A5): one per process, started by the first read that needs it.
let engine: RecognisePage | undefined;
const ocrFor = (env: Env): RecognisePage | undefined =>
  env.DOC_OCR_WITNESS === "off" ? undefined : (engine ??= ocrEngine({ cacheDir: env.DOC_OCR_CACHE_DIR ?? join(tmpdir(), "silvicom-ocr-models"), prepare: env.DOC_OCR_PREPARE !== "off" }));

/**
 * One `[metrics]` line per finished read (TWO-CLICK-READER-PLAN TC0.2, D-TC4), the same prefix the request summary
 * uses (requestMetrics.ts), so a read's stages can be grepped out of Railway's log stream beside the row's
 * `stage_timings`. Ids and numbers only — never a page's words.
 */
export function documentReadMetricsLine(readId: string, r: Exclude<ExecuteReadOutcome, { outcome: "skipped" }>): string {
  return `[metrics] ${JSON.stringify({
    documentRead: readId,
    outcome: r.outcome === "done" ? (r.cacheHit ? "cache_hit" : "done") : `failed:${r.code}`,
    ...(r.outcome === "done" ? { pages: r.pages } : {}),
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    stagesMs: r.stageTimings,
  })}`;
}

export const documentReadHandler: JobHandler = async (ctx, job) => {
  const readId = typeof job.payload.readId === "string" ? job.payload.readId : "";
  if (!readId) throw new Error("document_read job has no readId");
  try {
    const r = await executeRead(ctx.admin, job.org_id, readId, { client: anthropicClient(ctx.env), gateFor: gateForEnv(ctx.env), env: ctx.env, ocr: ocrFor(ctx.env) });
    if (r.outcome !== "skipped") console.log(documentReadMetricsLine(readId, r));
    return { readId, ...r };
  } catch (e) {
    const retried = e instanceof TransientModelError && job.attempts < job.max_attempts;
    // A failure to END the read must not replace the error that killed it: the job's error says why.
    if (!retried) {
      try {
        await failUnavailableRead(ctx.admin, job.org_id, readId);
      } catch {
        // Settled later: `getRead` ends a read whose job failed the next time the screen asks for it.
      }
    }
    throw e;
  }
};
