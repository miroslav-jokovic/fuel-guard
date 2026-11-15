import { PLAN_ANGLES_MIN, type LeadQuality } from "@silvicom/shared";
import type { ClaudeGenerationDeps } from "../generations/claudeGeneration.js";
import type { WorkerResult } from "../orchestrator/workers.js";
import { findingWords, writePlan, type WritePlanOutcome } from "../workers/strategist/strategist.js";
import { availableConcepts } from "./concepts.js";
import { buildEvidencePack } from "./evidencePack.js";
import { storeAgentPlan } from "./planStore.js";

/**
 * The planning step (ADS-PLATFORM-V2-PLAN V2c): the evidence pack built by code, the Strategist's plan from
 * it, and the plan stored as the campaign's next version. This is what `CampaignWorkers.plan` will call; the
 * runner turns `ok` into `plan_ready` (a person's turn), an error into `plan_failed` with the reason, and
 * `pending` into no move at all.
 *
 * ── IDEMPOTENT ON THE STINT ────────────────────────────────────────────────────────────────────────────
 * `key` is `<campaign id>:<state_changed_at>`. Run twice, the step replays both of the Strategist's asks
 * under their keys (no second model call, and each checked against the pack it was sent) and the store finds
 * the row the first run wrote by its generation. A `replan` is a new stint, so a new key and a new ask.
 *
 * ── EVERY FAILURE SAYS WHY, IN WORDS THE OFFICE CAN ACT ON ─────────────────────────────────────────────
 * The reason becomes the campaign's `last_error`, which a person reads: "switched off" and "the month's AI
 * budget is spent" are settings they can change; a plan refused twice names what was wrong with it.
 */

export interface PlanCampaignDeps extends ClaudeGenerationDeps {
  quality: LeadQuality;
}

/** How many findings a failure names; the rest are counted. `last_error` is read on a card, not in a log. */
const FINDINGS_SHOWN = 3;

export async function planCampaign(deps: PlanCampaignDeps, campaign: { id: string; org_id: string }, key: string): Promise<WorkerResult> {
  const pack = await buildEvidencePack(deps, campaign);
  if (!pack.ok) return { ok: false, error: pack.error };

  // A plan is at least three angles that differ in kind, each a kind of ad the carrier can make: with fewer
  // kinds enabled no plan can pass, so the model is not asked and the reason is one a person can act on.
  const concepts = await availableConcepts(deps.admin, campaign.org_id);
  if (concepts.length < PLAN_ANGLES_MIN) {
    return { ok: false, error: `a plan needs at least ${PLAN_ANGLES_MIN} different kinds of ad, and ${concepts.length} ${concepts.length === 1 ? "is" : "are"} enabled: enable more ad presets in Settings, each with its own lead and picture` };
  }

  const ask = { orgId: campaign.org_id, campaignId: campaign.id, stint: key, brief: pack.brief };
  let out: WritePlanOutcome = await writePlan(deps, { ...ask, attempt: 1, evidence: pack.evidence, concepts });
  // The one second ask: the same evidence and concepts the refused plan was written from, with the plan and its findings.
  if (out.kind === "refused") out = await writePlan(deps, { ...ask, attempt: 2, evidence: out.evidence, concepts: out.concepts, revise: { plan: out.plan, findings: out.findings } });

  switch (out.kind) {
    case "ready": {
      const stored = await storeAgentPlan(deps.admin, { orgId: campaign.org_id, campaignId: campaign.id, generationId: out.generationId, plan: out.plan, evidence: out.evidence, brief: pack.brief, concepts: out.concepts });
      // The store runs the same check on the same plan and pack, so anything but `stored` here is a fault of ours.
      return stored.kind === "stored" ? { ok: true } : { ok: false, error: "the plan passed its check and was then refused by the store" };
    }
    case "refused": {
      const shown = out.findings.slice(0, FINDINGS_SHOWN).map(findingWords).join(" ");
      const more = out.findings.length - FINDINGS_SHOWN;
      return { ok: false, error: `the plan was refused twice: ${shown}${more > 0 ? ` (and ${more} more)` : ""}` };
    }
    case "in_flight": return { ok: false, pending: true, why: "the Strategist is still writing" };
    case "agent_off": return { ok: false, error: "the Strategist is switched off in the ads settings" };
    case "budget_exhausted": return { ok: false, error: out.refusal === "budget_unset" ? "no monthly AI budget is set in the ads settings" : "this month's AI budget is spent" };
    case "failed": return { ok: false, error: `the Strategist's answer could not be used (${out.errorCode})` };
  }
}
