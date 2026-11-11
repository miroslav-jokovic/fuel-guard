import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture, type FixtureRow } from "../../../testing/postgrestFixture.js";
import { decideCreative, type DecideCreativeAsk } from "./decideCreative.js";

/**
 * A person's decision on a creative (S1d's half in `compose/`): the move follows a recorded approval row and
 * nothing else, happens once under a race, and only from `ready` while the campaign is in review.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const CAMP = "c0000000-0000-4000-8000-000000000001";
const CR = "c7000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-04T20:00:00Z");

function world(o: { creative?: string; campaign?: string; approvals?: FixtureRow[]; race?: string } = {}) {
  const creatives: FixtureRow[] = [
    { id: CR, org_id: ORG, campaign_id: CAMP, state: o.creative ?? "ready" },
    // Another carrier's creative with the same ids must never be the one read or moved.
    { id: CR, org_id: OTHER, campaign_id: CAMP, state: "ready" },
  ];
  const approvals: FixtureRow[] = o.approvals ?? [
    { id: "ap-yes", org_id: ORG, campaign_id: CAMP, creative_id: CR, kind: "approve_creative", withdraws_id: null },
    { id: "ap-no", org_id: ORG, campaign_id: CAMP, creative_id: CR, kind: "reject_creative", withdraws_id: null },
  ];
  const rec = createSupabaseRecorder({
    tables: {
      ads_approvals: postgrestFixture(approvals),
      ads_campaigns: postgrestFixture([{ id: CAMP, org_id: ORG, state: o.campaign ?? "review" }, { id: CAMP, org_id: OTHER, state: "review" }]),
      ads_creatives: (q) => {
        if (q.write?.method === "update") {
          // `race`: another person's decision lands between our read and our write — BEFORE our update's filter
          // is applied, so only an update conditioned on `state = 'ready'` misses it.
          if (o.race) for (const c of creatives) if (c.org_id === ORG) c.state = o.race;
          const hit = postgrestFixture(creatives)({ ...q, ops: q.ops.filter((x) => x.method !== "select") }) as FixtureRow[];
          for (const h of hit) Object.assign(creatives.find((c) => c.id === h.id && c.org_id === h.org_id)!, q.write.payload as object);
          return hit.map((h) => ({ id: h.id }));
        }
        return postgrestFixture(creatives)(q);
      },
    },
  });
  return { rec, creatives, mine: () => creatives.find((c) => c.org_id === ORG)!, theirs: () => creatives.find((c) => c.org_id === OTHER)! };
}

const ask = (patch: Partial<DecideCreativeAsk> = {}): DecideCreativeAsk => ({ campaignId: CAMP, creativeId: CR, decision: "approve", approvalId: "ap-yes", now: NOW, ...patch });

describe("decideCreative — a person's recorded decision moves one creative", () => {
  it("an approval row for this creative moves it ready → approved, in this org only", async () => {
    const w = world();
    expect(await decideCreative(w.rec.client, ORG, ask())).toEqual({ ok: true, state: "approved", moved: true });
    expect([w.mine().state, w.theirs().state]).toEqual(["approved", "ready"]);
    expectOrgScoped(w.rec, ORG);
  });

  it("a rejection row moves it ready → rejected, which Regenerate later supersedes", async () => {
    const w = world();
    expect(await decideCreative(w.rec.client, ORG, ask({ decision: "reject", approvalId: "ap-no" }))).toEqual({ ok: true, state: "rejected", moved: true });
    expect(w.mine().state).toBe("rejected");
  });

  it.each([
    ["approval_not_found", ask({ approvalId: "nope" })],
    ["approval_mismatch", ask({ approvalId: "ap-no" })],
    ["approval_mismatch", ask({ creativeId: "c7000000-0000-4000-8000-000000000099" })],
  ] as const)("no matching recorded decision, no move: %s", async (refusal, a) => {
    const w = world();
    expect(await decideCreative(w.rec.client, ORG, a)).toEqual({ ok: false, refusal });
    expect(w.mine().state).toBe("ready");
  });

  it("another carrier's approval row cannot move ours", async () => {
    const w = world({ approvals: [{ id: "ap-yes", org_id: OTHER, campaign_id: CAMP, creative_id: CR, kind: "approve_creative", withdraws_id: null }] });
    expect(await decideCreative(w.rec.client, ORG, ask())).toEqual({ ok: false, refusal: "approval_not_found" });
    expect(w.mine().state).toBe("ready");
  });

  it("a withdrawn approval moves nothing", async () => {
    const w = world({ approvals: [
      { id: "ap-yes", org_id: ORG, campaign_id: CAMP, creative_id: CR, kind: "approve_creative", withdraws_id: null },
      { id: "ap-wd", org_id: ORG, campaign_id: CAMP, creative_id: null, kind: "withdraw", withdraws_id: "ap-yes" },
    ] });
    expect(await decideCreative(w.rec.client, ORG, ask())).toEqual({ ok: false, refusal: "approval_withdrawn" });
    expect(w.mine().state).toBe("ready");
  });

  it("only from ready, and only while the campaign is in review", async () => {
    expect(await decideCreative(world({ creative: "check_failed" }).rec.client, ORG, ask())).toEqual({ ok: false, refusal: "not_ready", state: "check_failed" });
    const w = world({ campaign: "composing" });
    expect(await decideCreative(w.rec.client, ORG, ask())).toEqual({ ok: false, refusal: "campaign_not_in_review" });
    expect(w.mine().state).toBe("ready");
  });

  it("on a live campaign, a retired ad's replacement may be decided (Q-AD68); any other creative of a live campaign may not", async () => {
    const replacement = world({ campaign: "live" });
    replacement.creatives.push({ id: "c7000000-0000-4000-8000-0000000000aa", org_id: ORG, campaign_id: CAMP, state: "approved", platform_status: "retired", supersedes_id: null });
    Object.assign(replacement.mine(), { supersedes_id: "c7000000-0000-4000-8000-0000000000aa", platform_status: null });
    expect(await decideCreative(replacement.rec.client, ORG, ask())).toEqual({ ok: true, state: "approved", moved: true });
    expectOrgScoped(replacement.rec, ORG);

    const ordinary = world({ campaign: "live" });
    Object.assign(ordinary.mine(), { supersedes_id: null, platform_status: null });
    expect(await decideCreative(ordinary.rec.client, ORG, ask())).toEqual({ ok: false, refusal: "campaign_not_in_review" });
    expect(ordinary.mine().state).toBe("ready");
  });

  it("a Regenerate's successor on a live campaign is not a replacement: it names a rejected creative, not a retired one", async () => {
    const w = world({ campaign: "live" });
    w.creatives.push({ id: "c7000000-0000-4000-8000-0000000000bb", org_id: ORG, campaign_id: CAMP, state: "rejected", platform_status: null, supersedes_id: null });
    Object.assign(w.mine(), { supersedes_id: "c7000000-0000-4000-8000-0000000000bb", platform_status: null });
    expect(await decideCreative(w.rec.client, ORG, ask())).toEqual({ ok: false, refusal: "campaign_not_in_review" });
  });

  it("the same decision twice is already done, not an error", async () => {
    const w = world();
    await decideCreative(w.rec.client, ORG, ask());
    expect(await decideCreative(w.rec.client, ORG, ask())).toEqual({ ok: true, state: "approved", moved: false });
    // …even after the campaign has moved on: a screen retrying a decision that landed is told it landed.
    const later = world({ creative: "approved", campaign: "approved" });
    expect(await decideCreative(later.rec.client, ORG, ask())).toEqual({ ok: true, state: "approved", moved: false });
  });

  it("two people at once: the one whose write lands wins; the other is told, never overwrites", async () => {
    const lost = world({ race: "rejected" });
    expect(await decideCreative(lost.rec.client, ORG, ask())).toEqual({ ok: false, refusal: "not_ready", state: "rejected" });
    expect(lost.mine().state).toBe("rejected");
    expect(await decideCreative(world({ race: "approved" }).rec.client, ORG, ask())).toEqual({ ok: true, state: "approved", moved: false });
  });
});
