import { describe, expect, it } from "vitest";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { createSupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { NO_FEED_TARGET } from "./feedTarget.js";
import { outcomeFeedTick } from "./outcomeTick.js";

const conns = [
  { id: "c-meta-1", org_id: "org-1", provider: "meta", status: "connected" },
  { id: "c-meta-2", org_id: "org-2", provider: "meta", status: "failing" },
  { id: "c-off", org_id: "org-3", provider: "meta", status: "disconnected" },
  { id: "c-sim", org_id: "org-4", provider: "simulator", status: "connected" },
];

describe("the ads-outcome-feed scheduler (B6)", () => {
  it("queues one run per connected or failing Meta connection whose carrier has a feed target, and no other", async () => {
    const rec = createSupabaseRecorder({ tables: { ads_platform_connections: postgrestFixture(conns) } });
    const queued: string[] = [];
    const r = await outcomeFeedTick(rec.client, { targetFor: async (org) => (org === "org-2" ? null : { dataset_id: "1" }) }, async (_o, c) => {
      queued.push(c);
      return "queued";
    });
    expect(queued).toEqual(["c-meta-1"]);
    expect(r).toEqual({ connections: 2, queued: 1, off: 1 });
  });

  it("with no feed target anywhere (Q-AD40 unruled) it queues nothing", async () => {
    const rec = createSupabaseRecorder({ tables: { ads_platform_connections: postgrestFixture(conns) } });
    const r = await outcomeFeedTick(rec.client, NO_FEED_TARGET, async () => "queued");
    expect(r.queued).toBe(0);
  });
});
