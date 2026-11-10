import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ASSISTANT_MONTHLY_CAP_MICRO_USD,
  assistantBudgetVerdict,
  assistantCapCrossings,
  dayRangeInstants,
  organizationTimezone,
  todayInZone,
  type AssistantBudgetVerdict,
} from "@silvicom/shared";
import { readAiTokenBudget } from "../anomalies/index.js";
import { notify } from "../messaging/index.js";
import { aiTokensUsedThisMonth, usersWhoManage } from "../org/index.js";

/**
 * Ask AI's meter (F21 R2, PLAN.md Step 1a/1b): the gate before a question and the record after it.
 *
 * ORG-SCOPED: the service role bypasses RLS, so every read names the org, and both RPCs take it.
 */

/** What one answer spent, as `askData` accumulates it across its model rounds. */
export interface AnswerUsage {
  model: string;
  rounds: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}
export type AnswerOutcome = "answered" | "step_limit" | "refusal" | "max_tokens" | "error";

/** First instant of the carrier's current month — the cap's month is the carrier's (D-PREC6). */
export function monthStartInstant(now: Date, zone: string): string {
  const first = `${todayInZone(now, zone).slice(0, 7)}-01`;
  return dayRangeInstants(first, first, zone).start;
}

/**
 * May this carrier ask now? Checked before the model is called. The verdict rule is
 * `assistantBudgetVerdict` (shared); this only gathers its three inputs.
 *
 * ⚠ FAILS OPEN, logged. If the meter cannot be read — the minutes on staging before 0584 applies, or a
 * database hiccup — the question is answered: one answer is cents, and a meter outage that silenced the
 * assistant would be the meter costing more than it saves. The log line is what makes it visible.
 */
export async function readAssistantBudget(admin: SupabaseClient, orgId: string, now: Date): Promise<AssistantBudgetVerdict> {
  try {
    const { data: org } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
    const zone = organizationTimezone((org as { operating_hours?: object | null } | null)?.operating_hours);
    const [spend, orgTokensUsed, orgTokenBudget] = await Promise.all([
      admin.rpc("assistant_month_spend", { p_org: orgId, p_since: monthStartInstant(now, zone) }),
      aiTokensUsedThisMonth(admin, orgId, now),
      readAiTokenBudget(admin, orgId),
    ]);
    if (spend.error) throw new Error(`assistant_month_spend: ${spend.error.message}`);
    const row = (Array.isArray(spend.data) ? spend.data[0] : spend.data) as { cost_micro_usd: number | string } | null | undefined;
    return assistantBudgetVerdict({ spentMicroUsd: Number(row?.cost_micro_usd ?? 0), orgTokensUsed, orgTokenBudget });
  } catch (e) {
    console.error(`[ai] org ${orgId}: budget check failed, answering anyway: ${e instanceof Error ? e.message : String(e)}`);
    return assistantBudgetVerdict({ spentMicroUsd: 0, orgTokensUsed: 0, orgTokenBudget: null });
  }
}

/**
 * One ledger row, and the org's token counter, in one call (0584 §2). Never throws: the answer has been
 * given by the time this runs, and a person must not see an error for a bookkeeping failure. Logged.
 */
export async function recordAssistantAnswer(
  admin: SupabaseClient,
  a: { orgId: string; userId: string | null; usage: AnswerUsage; latencyMs: number; tools: string[]; outcome: AnswerOutcome },
): Promise<void> {
  const u = a.usage;
  const { error } = await admin.rpc("record_assistant_answer", {
    p_org: a.orgId,
    p_user: a.userId,
    p_model: u.model,
    p_rounds: u.rounds,
    p_input_tokens: u.inputTokens,
    p_cache_read_tokens: u.cacheReadTokens,
    p_cache_write_tokens: u.cacheWriteTokens,
    p_output_tokens: u.outputTokens,
    p_cost_micro_usd: Math.round(u.costMicroUsd),
    p_latency_ms: Math.round(a.latencyMs),
    p_tools: a.tools,
    p_outcome: a.outcome,
  });
  if (error) console.error(`[ai] org ${a.orgId}: usage not recorded: ${error.message}`);
}

/** The `[ai]` line per answer (Step 1a): counts and cost only, never the question or the answer. */
export function assistantLogLine(orgId: string, usage: AnswerUsage, latencyMs: number, tools: string[], outcome: AnswerOutcome): string {
  return (
    `[ai] org=${orgId} model=${usage.model} outcome=${outcome} rounds=${usage.rounds} in=${usage.inputTokens} ` +
    `cache_read=${usage.cacheReadTokens} cache_write=${usage.cacheWriteTokens} out=${usage.outputTokens} ` +
    `cost_usd=${(usage.costMicroUsd / 1_000_000).toFixed(4)} ms=${Math.round(latencyMs)} tools=${tools.join(",") || "-"}`
  );
}

const dollars = (micro: number) => `$${Math.floor(micro / 1_000_000)}`;

/**
 * The 80% and 100% bells (F21 R2b; Q-AI1: "admin alert at 80%"). Called after an answer is recorded, with
 * the month's spend the gate read before it and what the answer cost.
 *
 * WHO: the people who manage the admin section (`usersWhoManage(…, "admin")`, derived from the section
 * matrix) — the cap is the carrier's AI spend, and the admin section is where AI settings live. Never a
 * role list written here.
 *
 * ONCE per line per carrier per month: the dedupe key names the carrier's month (its clock, the cap's
 * month), so two answers crossing at once, or a retried request, ring once.
 *
 * Never throws: the answer has been given; a bell that fails is logged.
 */
export async function alertAssistantBudget(
  admin: SupabaseClient,
  orgId: string,
  spend: { beforeMicroUsd: number; costMicroUsd: number },
  now: Date,
): Promise<number> {
  const crossed = assistantCapCrossings(spend.beforeMicroUsd, spend.beforeMicroUsd + spend.costMicroUsd);
  if (crossed.length === 0) return 0;
  try {
    const { data: org } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
    const zone = organizationTimezone((org as { operating_hours?: object | null } | null)?.operating_hours);
    const month = todayInZone(now, zone).slice(0, 7);
    const users = await usersWhoManage(admin, orgId, "admin");
    if (users.length === 0) console.error(`[ai] org ${orgId}: budget alert has nobody to tell — no one manages the admin section`);
    const cap = dollars(ASSISTANT_MONTHLY_CAP_MICRO_USD);
    let made = 0;
    for (const line of crossed) {
      const alert =
        line === "warn"
          ? {
              title: "Ask AI is near this month's spending cap",
              body: `Ask AI has used ${dollars(ASSISTANT_MONTHLY_CAP_MICRO_USD * 0.8)} of its ${cap} for this month. At ${cap} it stops answering until the 1st.`,
            }
          : {
              title: "Ask AI has reached this month's spending cap",
              body: `Ask AI has used its ${cap} for this month and stops answering until the 1st.`,
            };
      const ids = await Promise.all(users.map((userId) => notify(admin, {
        orgId, userId, category: "ai_assistant_budget", severity: "warning", ...alert,
        entityType: "organizations", entityId: orgId, dedupeKey: `ai_assistant_budget:${line}:${orgId}:${month}`,
      })));
      made += ids.filter(Boolean).length;
    }
    return made;
  } catch (e) {
    console.error(`[ai] org ${orgId}: budget alert failed: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}
