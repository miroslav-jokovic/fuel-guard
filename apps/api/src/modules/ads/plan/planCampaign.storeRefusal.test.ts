import { describe, expect, it, vi } from "vitest";
import type { CampaignPlan, EvidencePack } from "@silvicom/shared";

/**
 * The one branch of the planning step no real input reaches: the Strategist's plan passed its check and the
 * store then refused it. The two run the same `checkPlan` on the same plan and pack, so it takes a fault of
 * ours to get here — and if it happens the step must FAIL, never answer `ok`: `ok` moves the campaign into
 * `plan_review`, where a person would be shown a campaign with no plan to read. The three collaborators are
 * replaced here because nothing else can make them disagree.
 */
const plan = { audience: "x", audience_evidence: [], angles: [] } as unknown as CampaignPlan;
const evidence: EvidencePack = [];

vi.mock("./evidencePack.js", () => ({ buildEvidencePack: async () => ({ ok: true, brief: { claims: [] }, evidence }) }));
vi.mock("../workers/strategist/strategist.js", () => ({
  findingWords: () => "",
  writePlan: async () => ({ kind: "ready", generationId: "gen-1", plan, evidence, replayed: false }),
}));
const storeAgentPlan = vi.fn();
vi.mock("./planStore.js", () => ({ storeAgentPlan: (...args: unknown[]) => storeAgentPlan(...args) }));

const { planCampaign } = await import("./planCampaign.js");
const deps = { admin: {}, client: {}, now: () => new Date("2026-11-15T18:20:00Z"), quality: { qualitySince: async () => [] } } as unknown as Parameters<typeof planCampaign>[0];

describe("planCampaign — the store has the last word", () => {
  it("a plan the store refuses fails the step, so no campaign reaches plan review without a plan", async () => {
    storeAgentPlan.mockResolvedValueOnce({ kind: "refused", findings: [], off_schema: "plan: invalid" });
    expect(await planCampaign(deps, { id: "c-1", org_id: "org-a" }, "c-1:t")).toEqual({ ok: false, error: "the plan passed its check and was then refused by the store" });
  });

  it("a stored plan is the only answer that reads as done", async () => {
    storeAgentPlan.mockResolvedValueOnce({ kind: "stored", plan: {}, replayed: false });
    expect(await planCampaign(deps, { id: "c-1", org_id: "org-a" }, "c-1:t")).toEqual({ ok: true });
    expect(storeAgentPlan.mock.calls.at(-1)![1]).toMatchObject({ orgId: "org-a", campaignId: "c-1", generationId: "gen-1" });
  });
});
