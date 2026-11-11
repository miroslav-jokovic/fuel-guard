import { Router } from "express";
import { requireAuth, requireOrg } from "../../../middleware/auth.js";
import { ASSISTANT_ANSWER_MAX, ASSISTANT_QUESTION_MAX, ASSISTANT_TOOL_MODULES, assistantAnswerPages, assistantHistoryForRequest, assistantToolsFor } from "@silvicom/shared";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { orgModuleSet } from "../../../middleware/requireModule.js";
import { writeAudit } from "../../../lib/audit.js";
import { askData } from "../askData.js";
import { alertAssistantBudget, assistantLogLine, readAssistantBudget, recordAssistantAnswer } from "../assistantUsage.js";

export function aiRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // Natural-language question over the org's data (safe tool-calling; never raw SQL).
  //
  // WHO MAY ASK, in two layers (F21 R5):
  //   · the screen — `requireSurface("ask-ai")`, a STAFF screen that starts off for every editable role
  //     (Q-SET15) and that an admin turns on per role or per person; the link hides by the same answer;
  //   · the DATA — each tool's own section(s) (`assistantContract.ts`, D-AI1, owner's Q-AI2/Q-AI5 rulings
  //     2026-11-10), resolved per request from the caller's token. This replaced Q-SET14 (b)'s single
  //     `requireSection("fuel", "view")`, which was right while every tool was a fuel tool and would have
  //     handed a finance or recruiting tool to anyone with fuel access.
  router.post(
    "/ask",
    requireOrg,
    requireSurface("ask-ai"),
    asyncHandler(async (req, res) => {
      // F21 R5 (D-AI1): the person's tools, from their section access as their token carries it. None
      // means this screen was turned on for someone whose areas have no questions yet — refused here,
      // and the launcher is hidden for them on the same answer (`useAssistantAccess`). A dispatch tool
      // also needs the carrier to have bought Dispatch, read the way its page's `requireModule` reads it.
      // A failed read closes the module-gated tools only (logged), never the whole assistant.
      const modules = await orgModuleSet(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, ASSISTANT_TOOL_MODULES).catch((e: unknown) => {
        console.warn(`[ai] org=${req.auth!.orgId} module read failed, module tools withheld: ${e instanceof Error ? e.message : String(e)}`);
        return new Set<never>();
      });
      const allowed = assistantToolsFor(req.auth!.role, req.auth!.sections ?? null, modules);
      if (allowed.length === 0) {
        res.status(403).json(apiError("ai_no_tools", "Ask AI has no questions for your role's areas yet."));
        return;
      }
      const env = getAppLocals(req).env;
      if (!env.ANTHROPIC_API_KEY) {
        res.status(503).json(apiError("ai_unavailable", "AI is not configured"));
        return;
      }
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const body = (req.body ?? {}) as { question?: unknown; history?: unknown };
      const question = String(body.question ?? "").slice(0, ASSISTANT_QUESTION_MAX).trim();
      // F21 R3a: the conversation so far, trimmed by the one shared rule. Absent from an older web:
      // the question is then answered alone, as before.
      const history = assistantHistoryForRequest(Array.isArray(body.history) ? body.history : undefined);
      if (!question) {
        res.status(400).json(apiError("bad_request", "A question is required"));
        return;
      }
      const userId = req.auth!.userId;
      // F21 R2: the carrier's token limit and the owner's $50 cap, checked before the model is reached.
      const now = new Date();
      const budget = await readAssistantBudget(admin, orgId, now);
      if (!budget.open) {
        console.warn(`[ai] org=${orgId} refused: ${budget.reason}`);
        res.status(429).json(apiError("ai_budget_exhausted", budget.message));
        return;
      }
      const started = Date.now();
      const { answer, tools, usage, outcome } = await askData(admin, env, orgId, question, allowed, now, history);
      const latencyMs = Date.now() - started;
      const toolNames = tools.map((t) => t.name);
      console.log(assistantLogLine(orgId, usage, latencyMs, toolNames, outcome));
      await recordAssistantAnswer(admin, { orgId, userId, usage, latencyMs, tools: toolNames, outcome });
      await alertAssistantBudget(admin, orgId, { beforeMicroUsd: budget.spentMicroUsd, costMicroUsd: usage.costMicroUsd }, now);
      // The answer and the tools behind it, not only the question (AUDIT P4): on 2026-11-09 the owner
      // asked for nine units' MPG and nobody could see what the assistant had said back, or which tool
      // it had tried. Capped so one long table cannot bloat the audit log; retention stays Q-AI4's.
      await writeAudit(admin, {
        orgId, actorId: userId, action: "ai.ask",
        meta: { question, answer: answer.slice(0, ASSISTANT_ANSWER_MAX), tools, outcome, cost_micro_usd: Math.round(usage.costMicroUsd), history_turns: history.length },
      });
      if (outcome === "error") {
        res.status(503).json(apiError("ai_unavailable", answer));
        return;
      }
      // F21 R4a: the pages behind the answer, as surface keys, for its "Open in …" links. Structured,
      // never parsed out of the model's text (D-AI8). Additive: an older web ignores it.
      res.json({ answer, pages: assistantAnswerPages(tools) });
    }),
  );

  return router;
}
