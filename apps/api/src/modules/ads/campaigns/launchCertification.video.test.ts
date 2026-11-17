import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADS_CAMPAIGN_WORKERS, type AdsReadinessLevel } from "@silvicom/shared";
import { ORG, campaign, createAdsWorld } from "../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";
import { launchCampaign } from "./campaignDoors.js";
import { CAMPAIGN_CREATIVE_KIND, creativeKindOf, launchCertification, plannedKind, type LaunchReadiness } from "./launchCertification.js";

/**
 * A campaign that holds a motion ad is a VIDEO campaign (V4): Launch reads its kind off the creatives a person
 * approved and asks the registry's `meta:video` row which workers it uses. Today that row is a still's — the same
 * Renderer and Publisher make and publish the video, and their own levels carry its needs — so what this file
 * holds is that the kind is READ, with a table in which the two kinds differ.
 */
const STILL = ADS_CAMPAIGN_WORKERS[`meta:${CAMPAIGN_CREATIVE_KIND}`]!;
const levelKey = (u: { worker: string; platform: string | null }) => (u.platform ? `${u.worker}|${u.platform}` : u.worker);
/** Every worker a still uses at L4, and one worker only a video uses (a stand-in: the driver clip's speech-to-text) at `video`. */
const readiness = (video: AdsReadinessLevel): LaunchReadiness => ({
  workers: { ...ADS_CAMPAIGN_WORKERS, "meta:video": [...STILL, { worker: "Captioner", platform: null }], "meta:plannedvideo": [...STILL, { worker: "Strategist", platform: null }, { worker: "Captioner", platform: null }] },
  levels: { ...Object.fromEntries(STILL.map((u) => [levelKey(u), "L4" as AdsReadinessLevel])), Strategist: "L4", Captioner: video },
});

describe("the registry's video rows", () => {
  it("a video campaign is listed, with a still's workers today, and its planned kind adds the Strategist as a still's does", () => {
    expect(ADS_CAMPAIGN_WORKERS["meta:video"]).toEqual(STILL);
    expect(ADS_CAMPAIGN_WORKERS[`meta:${plannedKind("video")}`]).toEqual(ADS_CAMPAIGN_WORKERS[`meta:${plannedKind(CAMPAIGN_CREATIVE_KIND)}`]);
    // The two workers a video leans on beyond a still's work are in the row: nothing publishes or renders it unlisted.
    expect(ADS_CAMPAIGN_WORKERS["meta:video"]!.map((u) => u.worker)).toEqual(expect.arrayContaining(["Publisher (per adapter)", "Renderer / Higgsfield client"]));
  });
});

describe("creativeKindOf — what the campaign IS, from its approved creatives", () => {
  it("one motion ad among them makes it a video campaign; none, or no creative at all, a still", () => {
    expect(creativeKindOf([{ motion: null }, { motion: { files: [] } }])).toBe("video");
    expect(creativeKindOf([{ motion: null }, {}, { motion: undefined }])).toBe("still");
    expect(creativeKindOf([])).toBe("still");
  });
});

describe("launchCertification — the kind picks the row", () => {
  it("a video campaign waits on a worker only a video uses; a still campaign on the same server does not", () => {
    expect(launchCertification({ provider: "meta" }, readiness("L2"), undefined, "video")).toMatchObject({ ok: false, refusal: "not_certified", missing: [{ worker: "Captioner", level: "L2", needs: "L4" }] });
    expect(launchCertification({ provider: "meta" }, readiness("L2"), undefined, "still")).toEqual({ ok: true, exempt: null });
    expect(launchCertification({ provider: "meta" }, readiness("L2"))).toEqual({ ok: true, exempt: null });
    expect(launchCertification({ provider: "meta", planned: true }, readiness("L2"), undefined, "video")).toMatchObject({ ok: false, missing: [{ worker: "Captioner" }] });
    expect(launchCertification({ provider: "meta" }, readiness("L4"), undefined, "video")).toEqual({ ok: true, exempt: null });
  });

  it("a kind nobody listed cannot launch", () => {
    const { "meta:video": _gone, ...workers } = readiness("L4").workers;
    expect(launchCertification({ provider: "meta" }, { ...readiness("L4"), workers }, undefined, "video")).toMatchObject({ ok: false, refusal: "platform_not_listed" });
  });
});

describe("launchCampaign — the door reads the kind off the campaign's approved creatives", () => {
  beforeEach(() => vi.stubEnv("DEPLOY_ENVIRONMENT", "production"));
  afterEach(() => vi.unstubAllEnvs());

  const C = "70000000-0000-4000-8000-000000000001";
  const OTHER_CAMPAIGN = "70000000-0000-4000-8000-000000000002";
  const OTHER_ORG = "99999999-0000-4000-8000-000000000009";
  const MOTION = { format: "4:5", files: [] };
  const approvals = [{ id: "ap-1", org_id: ORG, campaign_id: C, kind: "launch", withdraws_id: null, approved_by: "u-admin", approved_by_name: "Owner", daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, created_at: "2026-11-02T11:00:00Z" }];
  const creative = (id: string, over: Record<string, unknown>) => ({ id, org_id: ORG, campaign_id: C, state: "approved", motion: null, ...over });
  const launch = async (creatives: Array<Record<string, unknown>>) => {
    const w = createAdsWorld({ campaigns: [campaign(C, "paused")], approvals, extraTables: { ads_creatives: creatives } });
    const out = await launchCampaign(w.admin, ORG, { id: "u-admin", name: "Owner" }, C, { daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 }, new Date("2026-11-17T19:00:00Z"), readiness("L2"), { env: testEnv() });
    expectOrgScoped(w.rec, ORG);
    return out;
  };
  const refusedForVideo = { kind: "launch_refused", refusal: "not_certified", missing: [{ worker: "Captioner", level: "L2", needs: "L4" }] };

  it("an approved motion ad makes it a video campaign: Launch waits on the video's worker", async () => {
    expect(await launch([creative("c1", {}), creative("c2", { motion: MOTION })])).toMatchObject(refusedForVideo);
  });

  it("only approved creatives of THIS campaign in THIS org count: a rejected motion ad, another campaign's, another carrier's do not", async () => {
    const out = await launch([
      creative("c1", {}),
      creative("c2", { motion: MOTION, state: "rejected" }),
      creative("c3", { motion: MOTION, state: "ready" }),
      creative("c4", { motion: MOTION, campaign_id: OTHER_CAMPAIGN }),
      creative("c5", { motion: MOTION, org_id: OTHER_ORG }),
    ]);
    expect(out.kind).not.toBe("launch_refused");
  });

  it("a campaign of stills is not held back by a worker only a video uses", async () => {
    expect((await launch([creative("c1", {})])).kind).not.toBe("launch_refused");
  });
});
