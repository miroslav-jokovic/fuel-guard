import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../../testing/testEnv.js";
import { AD_FORMATS } from "@silvicom/shared";
import { frameStill } from "../overlay/overlay.js";
import { HIGGSFIELD_CREDIT_PRICES, HIGGSFIELD_STILL_MODEL, SIMULATED_STILL_MODEL } from "./prices.js";
import { drawSimulatedStill, renderChoiceFor, renderClientFor, SIMULATED_RENDER_PRICES, stopSimulatedRenderForTests } from "./simulatedRender.js";

/**
 * The render half of the simulator: reachable from a simulator connection off production, and from nothing else.
 * The step itself is `render.test.ts`'s ("a simulated render…"); this file holds the two gates and the picture.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const STAGING = { DEPLOY_ENVIRONMENT: "staging" };
const PRODUCTION = { DEPLOY_ENVIRONMENT: "production" };
const env = testEnv();
const PHOTO = readFileSync(new URL("../../workers/checker/fixtures/images/reference.jpg", import.meta.url));

const connections = (provider: string, org = ORG) => createSupabaseRecorder({ tables: { ads_platform_connections: [{ id: "conn-1", org_id: org, provider, token_sealed: null, status: "connected", is_sandbox: false }] } });

afterEach(async () => stopSimulatedRenderForTests());

describe("renderChoiceFor — the campaign's connection decides, and only off production", () => {
  it("a simulator connection on staging draws with the simulated still", async () => {
    const rec = connections("simulator");
    expect(await renderChoiceFor(rec.client, ORG, "conn-1", STAGING)).toEqual({ model: SIMULATED_STILL_MODEL, prices: SIMULATED_RENDER_PRICES });
    expectOrgScoped(rec, ORG);
  });

  it("a real Meta connection on staging keeps the real choice, so it still stops at V4", async () => {
    expect(await renderChoiceFor(connections("meta").client, ORG, "conn-1", STAGING)).toEqual({ model: HIGGSFIELD_STILL_MODEL, prices: HIGGSFIELD_CREDIT_PRICES });
  });

  it("a simulator connection in production, or on a nameless built server, keeps the real choice", async () => {
    const real = { model: HIGGSFIELD_STILL_MODEL, prices: HIGGSFIELD_CREDIT_PRICES };
    expect(await renderChoiceFor(connections("simulator").client, ORG, "conn-1", PRODUCTION)).toEqual(real);
    expect(await renderChoiceFor(connections("simulator").client, ORG, "conn-1", { NODE_ENV: "production" })).toEqual(real);
  });

  it("another org's simulator connection is not this org's", async () => {
    const row = { id: "conn-1", org_id: "11111111-1111-4111-8111-111111111111", provider: "simulator" };
    const rec = createSupabaseRecorder({ tables: { ads_platform_connections: (q) => (q.filters().some((f) => f.col === "org_id" && f.val === row.org_id) ? [row] : []) } });
    expect((await renderChoiceFor(rec.client, ORG, "conn-1", STAGING)).model).toBe(HIGGSFIELD_STILL_MODEL);
  });
});

describe("renderClientFor — the job asks the gate again", () => {
  it("the simulated model is refused in production, whatever queued it", async () => {
    const out = await renderClientFor(connections("simulator").client, env, ORG, SIMULATED_STILL_MODEL, PRODUCTION);
    expect(out).toMatchObject({ ok: false, reason: expect.stringMatching(/^simulator_not_allowed/) });
  });

  it("the simulated model needs no key on staging and carries the simulated price", async () => {
    const rec = createSupabaseRecorder({ tables: { ads_platform_connections: [] } });
    expect(await renderClientFor(rec.client, env, ORG, SIMULATED_STILL_MODEL, STAGING)).toMatchObject({ ok: true, prices: SIMULATED_RENDER_PRICES });
  });

  it("any other model on staging needs the carrier's own key", async () => {
    const rec = createSupabaseRecorder({ tables: { ads_platform_connections: [] } });
    expect(await renderClientFor(rec.client, env, ORG, "alibaba/qwen-image-3/edit", STAGING)).toEqual({ ok: false, reason: "not_connected" });
  });
});

describe("drawSimulatedStill — a picture the real checks can judge", () => {
  it("gives the kit photo back as a PNG with the photo's own size", async () => {
    const [drawn, photo] = await Promise.all([drawSimulatedStill([PHOTO]).then((b) => sharp(b).metadata()), sharp(PHOTO).metadata()]);
    expect(drawn).toMatchObject({ format: "png", width: photo.width, height: photo.height });
  });

  it("asked for a shape it answers in that shape, from the kit photo and from the road alike; asked for one it does not know it changes nothing (AG4)", async () => {
    for (const inputs of [[PHOTO], []]) {
      expect(await sharp(await drawSimulatedStill(inputs, { prompt: "x", aspect_ratio: "4:5" })).metadata()).toMatchObject({ format: "png", width: 1600, height: 2000 });
      expect(await sharp(await drawSimulatedStill(inputs, { prompt: "x", aspect_ratio: "1:1" })).metadata()).toMatchObject({ format: "png", width: 1600, height: 1600 });
    }
    const photo = await sharp(PHOTO).metadata();
    expect(await sharp(await drawSimulatedStill([PHOTO], { aspect_ratio: "21:9" })).metadata()).toMatchObject({ width: photo.width, height: photo.height });
  });

  it("draws an empty road with no input, and it frames in every ad format", async () => {
    const road = await drawSimulatedStill([]);
    expect(await sharp(road).metadata()).toMatchObject({ format: "png", width: 1600, height: 2000 });
    for (const f of AD_FORMATS) expect((await sharp(await frameStill(road, f)).metadata()).format).toBe("png");
  });
});
