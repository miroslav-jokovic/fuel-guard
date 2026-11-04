import { describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, type AdsSettings } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import type { QueueDriver } from "../../../queue/types.js";
import type { RenderInput } from "../creative/higgsfield/render.js";
import { queuedRender } from "./workers.js";

/**
 * Compose's render (C5b2): read where the render stands, queue `ads_render` if it is not finished, answer
 * `pending`. The job — one at a time — is what calls Higgsfield; this never does.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const MODEL = "fixture/still";
const input: RenderInput = { orgId: ORG, campaignId: "c-1", creativeId: "cr-1", attempt: 2, model: MODEL, params: { prompt: "a road, no text, no logos, no lettering" } };
const settings = (on: boolean): AdsSettings => ({ ...ADS_SETTINGS_UNSET, budgets: { ...ADS_SETTINGS_UNSET.budgets, higgsfield_credits_monthly: 100, agents_enabled: { renderer: on } } });

function world(row: Record<string, unknown> | null, on = true) {
  const rec = createSupabaseRecorder({
    tables: {
      ad_generations: row ? [{ id: "g-1", started_at: "2026-11-04T17:00:00Z", output: null, error_code: null, ...row }] : [],
      ads_settings_versions: [{ id: "v1", settings: settings(on), kill_switch: false }],
    },
  });
  const enqueue = vi.fn(async () => ({ jobId: "j-1" }));
  const driver = { enqueue } as unknown as QueueDriver;
  return { rec, enqueue, render: queuedRender(rec.client, driver, { [MODEL]: 3 }) };
}

describe("queuedRender — compose never calls Higgsfield itself", () => {
  it("no render yet: queues one ads_render job for this creative and attempt, and answers pending", async () => {
    const w = world(null);
    expect(await w.render(input)).toMatchObject({ kind: "pending", why: "render job queued" });
    expect(w.enqueue).toHaveBeenCalledWith("ads_render", { orgId: ORG, payload: input, dedupKey: "ads_render:cr-1:2" });
    expectOrgScoped(w.rec, ORG);
  });

  it("a render still started is queued again under the same key, so a job whose retries ran out resumes", async () => {
    const w = world({ status: "started" });
    expect(await w.render(input)).toMatchObject({ kind: "pending", generationId: "g-1" });
    expect(w.enqueue).toHaveBeenCalledTimes(1);
  });

  it("a finished render answers from its row and queues nothing", async () => {
    const asset = { sha256: "e".repeat(64), format: "png", source_format: "png", width: 2, height: 2, byte_size: 9 };
    const w = world({ status: "succeeded", output: { assets: [asset] } });
    expect(await w.render(input)).toEqual({ kind: "stored", generationId: "g-1", assets: [asset], replayed: true });
    expect(w.enqueue).not.toHaveBeenCalled();
  });

  it("a model nobody priced, or the renderer switched off, is refused at once — never a job that writes no row", async () => {
    const unpriced = world(null);
    expect(await queuedRender(unpriced.rec.client, { enqueue: unpriced.enqueue } as unknown as QueueDriver, {})(input)).toEqual({ kind: "refused", refusal: "price_unknown" });
    const off = world(null, false);
    expect(await off.render(input)).toEqual({ kind: "refused", refusal: "agent_off" });
    expect(unpriced.enqueue).not.toHaveBeenCalled();
    expect(off.enqueue).not.toHaveBeenCalled();
  });
});
