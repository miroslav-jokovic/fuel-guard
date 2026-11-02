import { createHash } from "node:crypto";
import { APIError } from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiGate, canonicalJson, type AdAiAgent, type AiGateRefusal } from "@silvicom/shared";
import { callForcedTool, toolInputSchema, type ForcedTool, type MessagesClient } from "../../../lib/anthropic.js";
import { settingsInForce } from "../settings/settingsVersions.js";
import {
  anthropicTokensThisMonth,
  completeGeneration,
  generationByKey,
  insertGeneration,
  type GenerationRow,
} from "./generationLedger.js";

/**
 * The ads AI rail (ADS-AGENT-BUILD-WORKFLOW.md A4; D-AD13, D-RA9): the ONE way an ads worker asks
 * Claude. The copywriter, art director, checker and analyst (B/C/F) each call `generateWithClaude`
 * with their own tool schema; none of them holds a client, reads a budget or writes provenance.
 *
 * In order, and each step is a reason the next may not happen:
 *   1. REPLAY. The idempotency key is the call's purpose (a creative's copy, attempt n). A row under
 *      it already answers: a success is returned from the row (re-validated against today's schema),
 *      a failure or budget refusal is returned as it was, and a `started` row is a call in flight or
 *      one that crashed mid-way — `in_flight`, never a second call. No model is asked in any of these.
 *      A retry after a failure is a NEW key (attempt n+1), which the orchestrator (A6) owns.
 *   2. THE SWITCH (D-RA9). An agent switched off is refused with no row: nothing was asked.
 *   3. THE BUDGET (D-AD13). Unset or spent → a `budget_exhausted` row written INSTEAD of the call.
 *      Null refuses here, the reverse of `withinBudget` (`aiRail.ts` says why).
 *   4. `started` is written BEFORE the call, so a crash after the vendor billed us still leaves a row
 *      that says a call was made; the call; then ONE completion with the tokens billed, whatever the
 *      outcome. Only an answer that parses against the worker's Zod schema becomes `value`.
 *
 * A completion write that fails after the call throws: the row stays `started` (so the key reads as
 * `in_flight` and is never re-asked), and the job that called fails visibly. Losing that answer is the
 * price of never paying for the same purpose twice.
 */

export interface ClaudeGenerationRequest<T> {
  orgId: string;
  agent: AdAiAgent;
  campaignId?: string | null;
  creativeId?: string | null;
  /** The call's purpose, unique per org: `copy:<creative id>:<attempt>`. 1–200 characters (0537). */
  idempotencyKey: string;
  promptVersion: string;
  /** From `AI_MODELS` (`packages/shared/src/ai.ts`) — the one place model names live. */
  model: string;
  system: string;
  user: string;
  tool: ForcedTool<T>;
  maxTokens: number;
}

export interface ClaudeGenerationDeps {
  admin: SupabaseClient;
  client: MessagesClient;
  now: () => Date;
}

export type ClaudeGenerationOutcome<T> =
  | { kind: "succeeded"; generationId: string; value: T; replayed: boolean }
  | { kind: "failed"; generationId: string; errorCode: string; replayed: boolean }
  | { kind: "budget_exhausted"; generationId: string; refusal: Exclude<AiGateRefusal, "agent_off">; replayed: boolean }
  | { kind: "in_flight"; generationId: string; startedAt: string }
  | { kind: "agent_off" };

export async function generateWithClaude<T>(deps: ClaudeGenerationDeps, req: ClaudeGenerationRequest<T>): Promise<ClaudeGenerationOutcome<T>> {
  const admin = deps.admin;
  const orgId = req.orgId;
  const prior = await generationByKey(admin, orgId, req.idempotencyKey);
  if (prior) return replay(prior, req.tool);

  const { settings } = await settingsInForce(admin, orgId);
  const now = deps.now();
  const gate = aiGate(settings, req.agent, await anthropicTokensThisMonth(admin, orgId, now));
  if (!gate.open && gate.refusal === "agent_off") return { kind: "agent_off" };

  const request = {
    model: req.model,
    system: req.system,
    user: req.user,
    tool: { name: req.tool.name, description: req.tool.description, input_schema: toolInputSchema(req.tool) },
    max_tokens: req.maxTokens,
  };
  const row = {
    org_id: orgId,
    campaign_id: req.campaignId ?? null,
    creative_id: req.creativeId ?? null,
    agent: req.agent,
    provider: "anthropic" as const,
    model: req.model,
    prompt_version: req.promptVersion,
    input_hash: createHash("sha256").update(canonicalJson(request)).digest("hex"),
    idempotency_key: req.idempotencyKey,
    request,
    started_at: now.toISOString(),
  };

  if (!gate.open) {
    const refusal = gate.refusal as Exclude<AiGateRefusal, "agent_off">;
    const ins = await insertGeneration(admin, { ...row, status: "budget_exhausted", error_code: refusal, finished_at: now.toISOString() });
    if (ins === "duplicate") return replayKey(admin, orgId, req);
    return { kind: "budget_exhausted", generationId: ins.id, refusal, replayed: false };
  }

  const ins = await insertGeneration(admin, { ...row, status: "started", error_code: null, finished_at: null });
  if (ins === "duplicate") return replayKey(admin, orgId, req);

  const finish = (status: "succeeded" | "failed", fields: { output?: unknown; requestId?: string | null; tokens?: number | null; errorCode?: string | null }) =>
    completeGeneration(admin, orgId, ins.id, {
      status,
      output: fields.output ?? null,
      provider_request_id: fields.requestId ?? null,
      cost_units: fields.tokens ?? null,
      error_code: fields.errorCode ?? null,
      finished_at: deps.now().toISOString(),
    });

  let result;
  try {
    result = await callForcedTool(deps.client, { model: req.model, system: req.system, user: req.user, tool: req.tool, maxTokens: req.maxTokens });
  } catch (err) {
    const errorCode = err instanceof APIError && err.status ? `provider_${err.status}` : "provider_error";
    await finish("failed", { errorCode });
    return { kind: "failed", generationId: ins.id, errorCode, replayed: false };
  }
  const tokens = result.usage.input + result.usage.output;
  if (result.kind === "ok") {
    await finish("succeeded", { output: result.value, requestId: result.requestId, tokens });
    return { kind: "succeeded", generationId: ins.id, value: result.value, replayed: false };
  }
  // Kept as evidence of what the model said, never handed on: `output` on a failed row is not a value.
  const output = result.kind === "off_schema" ? { raw: result.raw, issues: result.issues } : { stop_reason: result.stopReason };
  await finish("failed", { output, requestId: result.requestId, tokens, errorCode: result.kind });
  return { kind: "failed", generationId: ins.id, errorCode: result.kind, replayed: false };
}

/** Lost an insert race for the key: the winner's row answers, exactly as a replay would. */
async function replayKey<T>(admin: SupabaseClient, orgId: string, req: ClaudeGenerationRequest<T>): Promise<ClaudeGenerationOutcome<T>> {
  const row = await generationByKey(admin, orgId, req.idempotencyKey);
  if (!row) throw new Error(`ad_generations: key ${req.idempotencyKey} refused as a duplicate but not found`);
  return replay(row, req.tool);
}

function replay<T>(row: GenerationRow, tool: ForcedTool<T>): ClaudeGenerationOutcome<T> {
  switch (row.status) {
    case "started":
      return { kind: "in_flight", generationId: row.id, startedAt: row.started_at };
    case "budget_exhausted":
      return { kind: "budget_exhausted", generationId: row.id, refusal: row.error_code === "budget_unset" ? "budget_unset" : "budget_spent", replayed: true };
    case "failed":
      return { kind: "failed", generationId: row.id, errorCode: row.error_code ?? "failed", replayed: true };
    case "succeeded": {
      // Stored before today's schema existed, perhaps: an answer that no longer parses is not handed on.
      const parsed = tool.schema.safeParse(row.output);
      if (!parsed.success) return { kind: "failed", generationId: row.id, errorCode: "replay_off_schema", replayed: true };
      return { kind: "succeeded", generationId: row.id, value: parsed.data, replayed: true };
    }
  }
}
