import { describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, type AdsSettings, type LeadQuality } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";
import type { CampaignRow } from "./transitions.js";
import { adsWorkers, agentHasWork } from "./workers.js";

/**
 * The planner as the shipped workers hold it (ADS-PLATFORM-V2-PLAN V2c, Q-APX6): a host plans when it was handed
 * recruiting's lead counts, and a carrier's campaigns are planned only when its Strategist switch is on.
 */
const planned = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("../plan/planCampaign.js", () => ({ planCampaign: async (...args: unknown[]) => { planned.calls.push(args); return { ok: true }; } }));
vi.mock("../../../lib/anthropic.js", () => ({ anthropicClient: () => ({ the: "client" }) }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const campaign = { id: "c-1", org_id: ORG, connection_id: "conn-1" } as CampaignRow;
const quality: LeadQuality = { qualitySince: async () => [] };
const settings = (strategist: boolean | undefined): AdsSettings => ({ ...ADS_SETTINGS_UNSET, budgets: { ...ADS_SETTINGS_UNSET.budgets, agents_enabled: strategist === undefined ? {} : { strategist } } });
const world = (s: AdsSettings | null) => createSupabaseRecorder({ tables: { ads_settings_versions: s ? [{ id: "v1", org_id: ORG, version: 1, settings: s, kill_switch: false }] : [] } });
const workers = (rec: ReturnType<typeof world>, leadQuality?: LeadQuality) => adsWorkers({ admin: rec.client, env: testEnv(), now: () => new Date("2026-11-15T18:00:00Z"), leadQuality });

describe("adsWorkers — who plans", () => {
  it("a host handed recruiting's lead counts has a planner, and runs the planning step with those counts, the campaign and the stint's key", async () => {
    const rec = world(settings(true));
    const w = workers(rec, quality);
    expect(await w.plan!(campaign, "c-1:t")).toEqual({ ok: true });
    expect(planned.calls.at(-1)).toEqual([expect.objectContaining({ admin: rec.client, quality, client: { the: "client" } }), campaign, "c-1:t"]);
    expect(agentHasWork("planning", w, false)).toBe(true);
  });

  it("a host not handed them has no planner: its drafts are composed and a planning campaign is nobody's work", () => {
    const w = workers(world(settings(true)));
    expect(w.plan).toBeNull();
    expect(agentHasWork("planning", w, false)).toBe(false);
    expect(agentHasWork("draft", w, false)).toBe(true);
  });

  it("a carrier's campaigns are planned only when its Strategist switch is on — off, never set and no settings saved all read as no", async () => {
    const on = world(settings(true));
    expect(await workers(on, quality).plansFor!(campaign)).toBe(true);
    expectOrgScoped(on, ORG);
    expect(await workers(world(settings(false)), quality).plansFor!(campaign)).toBe(false);
    expect(await workers(world(settings(undefined)), quality).plansFor!(campaign)).toBe(false);
    expect(await workers(world(null), quality).plansFor!(campaign)).toBe(false);
  });
});
