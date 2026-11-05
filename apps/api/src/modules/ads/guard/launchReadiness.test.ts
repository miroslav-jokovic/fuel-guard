import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { launchBlockedBy, workersBelowL4 } from "./launchReadiness.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const real = () => createSupabaseRecorder({ tables: { ads_platform_connections: [{ id: "c", org_id: ORG, provider: "meta", is_sandbox: false }] } });

describe("launchBlockedBy — the committed scorecard decides a real launch", () => {
  it("names the required workers not yet certified", () => {
    expect(workersBelowL4({ required: ["A", "B"], certified: ["A"] })).toEqual(["B"]);
  });

  it("a real account launches once every required worker is certified", async () => {
    const rec = real();
    expect(await launchBlockedBy(rec.client, ORG, "c", { required: ["A"], certified: ["A", "B"] })).toEqual([]);
    expectOrgScoped(rec, ORG);
  });

  it("one uncertified worker still stops a real account", async () => {
    expect(await launchBlockedBy(real().client, ORG, "c", { required: ["A", "B"], certified: ["A"] })).toEqual(["B"]);
  });
});
