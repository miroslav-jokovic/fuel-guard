import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";
import { HIGGSFIELD_STILL_MODEL, SIMULATED_STILL_MODEL } from "../creative/higgsfield/prices.js";
import type { CampaignRow } from "./transitions.js";
import { adsWorkers } from "./workers.js";

const composed = vi.hoisted(() => ({ deps: null as null | { renderModel: string | null } }));
vi.mock("../compose/composeCampaign.js", () => ({ composeCampaign: async (deps: { renderModel: string | null }) => { composed.deps = deps; return { ok: true }; } }));
vi.mock("../../../lib/anthropic.js", () => ({ anthropicClient: () => ({}) }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const campaign = { id: "c-1", org_id: ORG, connection_id: "conn-1" } as CampaignRow;
const run = async (provider: string) => {
  const rec = createSupabaseRecorder({ tables: { ads_platform_connections: [{ id: "conn-1", org_id: ORG, provider }] } });
  await adsWorkers({ admin: rec.client, env: testEnv(), now: () => new Date() }).compose!(campaign, "k");
  return composed.deps!.renderModel;
};

afterEach(() => vi.unstubAllEnvs());

describe("adsWorkers — compose draws where the campaign's connection is", () => {
  it("a simulator campaign on staging composes with the simulated still", async () => {
    vi.stubEnv("DEPLOY_ENVIRONMENT", "staging");
    expect(await run("simulator")).toBe(SIMULATED_STILL_MODEL);
  });

  it("a Meta campaign composes with the real model, which is V4's to choose", async () => {
    vi.stubEnv("DEPLOY_ENVIRONMENT", "staging");
    expect(await run("meta")).toBe(HIGGSFIELD_STILL_MODEL);
  });
});
