import { describe, expect, it } from "vitest";
import { CAMPAIGN_EVENTS, CAMPAIGN_STATES, stepCampaign, type CampaignActor } from "@silvicom/shared";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { campaign, createAdsWorld, ORG } from "../../../testing/adsWorld.js";
import { applyCampaignEvent, loadCampaign, type TransitionActor } from "./transitions.js";

const AGENT: TransitionActor = { kind: "agent", name: "Ads orchestrator" };
const PERSON: TransitionActor = { kind: "person", id: "11111111-1111-4111-8111-111111111111", name: "Recruiter" };
const ACTORS: Record<CampaignActor, TransitionActor> = {
  agent: AGENT,
  person: PERSON,
  approver: { kind: "approver", id: PERSON.kind === "person" ? PERSON.id : "", name: "Owner" },
  platform: { kind: "platform", name: "Meta" },
};

describe("applyCampaignEvent — the machine decides, the writer obeys", () => {
  it("every (state, event, actor): a legal move advances with one succeeded row, an illegal one changes nothing and is recorded refused", async () => {
    let checked = 0;
    for (const state of CAMPAIGN_STATES) {
      for (const event of CAMPAIGN_EVENTS) {
        for (const actor of Object.keys(ACTORS) as CampaignActor[]) {
          const w = createAdsWorld({ campaigns: [campaign("c1", state)] });
          const verdict = stepCampaign(state, event, actor);
          const r = await applyCampaignEvent(w.admin, (await loadCampaign(w.admin, ORG, "c1"))!, { event, actor: ACTORS[actor] }, w.now().toISOString());
          const rows = w.transitions();
          if (!verdict.ok) {
            expect(r, `${state} + ${event} by ${actor}`).toEqual({ kind: "refused", reason: verdict.reason });
            expect(w.byId("c1").state).toBe(state);
            expect(rows).toEqual([expect.objectContaining({ status: "refused", error_code: verdict.reason })]);
            expect(w.rec.forTable("ads_campaigns").some((q) => q.write)).toBe(false);
          } else if (verdict.transition.to === state && event === "kill") {
            expect(r).toEqual({ kind: "no_op", state });
            expect(rows).toEqual([]);
          } else {
            expect(r, `${state} + ${event} by ${actor}`).toEqual({ kind: "moved", from: state, to: verdict.transition.to });
            expect(w.byId("c1").state).toBe(verdict.transition.to);
            expect(rows).toEqual([expect.objectContaining({ status: "succeeded", request: expect.objectContaining({ from: state, event, to: verdict.transition.to }) })]);
          }
          expectOrgScoped(w.rec, ORG);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(CAMPAIGN_STATES.length * CAMPAIGN_EVENTS.length * 4);
  });

  it("a person's move is recorded with their id; the machine's 'approver' is the ledger's person", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "paused")] });
    await applyCampaignEvent(w.admin, (await loadCampaign(w.admin, ORG, "c1"))!, { event: "launch", actor: ACTORS.approver }, w.now().toISOString());
    expect(w.transitions()[0]).toMatchObject({ actor_kind: "person", actor_id: PERSON.kind === "person" ? PERSON.id : null, status: "succeeded" });
  });
});

describe("applyCampaignEvent — racing writers and crashes", () => {
  it("a second writer moved the campaign first: this move does not happen and its row completes failed (state_moved)", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "live")] });
    const stale = (await loadCampaign(w.admin, ORG, "c1"))!;
    expect((await applyCampaignEvent(w.admin, stale, { event: "pause", actor: PERSON }, w.now().toISOString())).kind).toBe("moved");
    const r = await applyCampaignEvent(w.admin, stale, { event: "platform_paused", actor: ACTORS.platform }, w.now().toISOString());
    expect(r).toEqual({ kind: "state_moved" });
    expect(w.byId("c1").state).toBe("pausing");
    expect(w.transitions().map((a) => [a.status, a.error_code])).toEqual([["succeeded", null], ["failed", "state_moved"]]);
  });

  // Found by the 7d mutation pass (G6): with the stamp dropped from the compare-and-set, every other
  // test stayed green, because only `pausing` moves to itself. A writer holding an earlier stint of
  // `pausing` must lose to the move that started the current one, not overwrite it.
  it("a stale read of an earlier stint of the SAME state loses: the stamp, not the state, is what the move compares", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "pausing")] });
    const stale = (await loadCampaign(w.admin, ORG, "c1"))!;
    expect((await applyCampaignEvent(w.admin, stale, { event: "pause_failed", actor: AGENT, error: "rate_limited" }, w.now().toISOString())).kind).toBe("moved");
    const restamped = w.byId("c1").state_changed_at;
    expect(restamped).not.toBe(stale.state_changed_at);
    const r = await applyCampaignEvent(w.admin, stale, { event: "paused", actor: AGENT }, w.now().toISOString());
    expect(r).toEqual({ kind: "state_moved" });
    expect(w.byId("c1")).toMatchObject({ state: "pausing", state_changed_at: restamped, last_error: "rate_limited" });
  });

  it("a crash between the move and its completion is settled from the campaign's own stamp at the next move", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "composing")] });
    w.crashOnWrite("ads_actions", 2); // 1 = the started row, 2 = its completion
    await expect(applyCampaignEvent(w.admin, (await loadCampaign(w.admin, ORG, "c1"))!, { event: "creatives_ready", actor: AGENT }, w.now().toISOString())).rejects.toThrow(/injected crash/);
    expect(w.byId("c1").state).toBe("review");
    expect(w.transitions()[0]!.status).toBe("started");

    await applyCampaignEvent(w.admin, (await loadCampaign(w.admin, ORG, "c1"))!, { event: "creatives_approved", actor: PERSON }, w.now().toISOString());
    expect(w.transitions().map((a) => [a.status, (a.request as { to: string }).to])).toEqual([["succeeded", "review"], ["succeeded", "approved"]]);
  });

  it("a crash before the move: the row it left is reused by the retry, which moves once", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "composing")] });
    w.crashOnWrite("ads_campaigns", 1);
    const read = (await loadCampaign(w.admin, ORG, "c1"))!;
    await expect(applyCampaignEvent(w.admin, read, { event: "creatives_ready", actor: AGENT }, w.now().toISOString())).rejects.toThrow(/injected crash/);
    expect(w.byId("c1").state).toBe("composing");
    expect(await applyCampaignEvent(w.admin, read, { event: "creatives_ready", actor: AGENT }, w.now().toISOString())).toEqual({ kind: "moved", from: "composing", to: "review" });
    expect(w.transitions()).toEqual([expect.objectContaining({ status: "succeeded" })]);
  });

  it("a delivered-twice move finds its finished row and writes nothing more", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "composing")] });
    const read = (await loadCampaign(w.admin, ORG, "c1"))!;
    await applyCampaignEvent(w.admin, read, { event: "creatives_ready", actor: AGENT }, w.now().toISOString());
    expect(await applyCampaignEvent(w.admin, read, { event: "creatives_ready", actor: AGENT }, w.now().toISOString())).toEqual({ kind: "already_recorded", status: "succeeded" });
    expect(w.transitions()).toHaveLength(1);
  });

  it("an error travels with the move into last_error, and the next move clears it", async () => {
    const w = createAdsWorld({ campaigns: [campaign("c1", "composing")] });
    await applyCampaignEvent(w.admin, (await loadCampaign(w.admin, ORG, "c1"))!, { event: "compose_failed", actor: AGENT, cause: "renderer down", error: "renderer down" }, w.now().toISOString());
    expect(w.byId("c1")).toMatchObject({ state: "failed", last_error: "renderer down" });
    await applyCampaignEvent(w.admin, (await loadCampaign(w.admin, ORG, "c1"))!, { event: "resume_compose", actor: PERSON }, w.now().toISOString());
    expect(w.byId("c1")).toMatchObject({ state: "composing", last_error: null });
  });
});
