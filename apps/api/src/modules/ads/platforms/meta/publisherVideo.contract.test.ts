import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { campaign, CONN, createAdsWorld, LIVE_SETTINGS, ORG, type AdsWorld } from "../../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { drawSimulatedClip } from "../../creative/higgsfield/simulatedRender.js";
import { runCampaignStep } from "../../orchestrator/runner.js";
import type { FakeMetaFault } from "../simulator/fakeMetaFaults.js";
import { openMetaTarget, type MetaTarget } from "./contract/metaTarget.js";
import { contractPublishInput } from "./contract/publishInput.js";
import { MetaGraph, resetGraphThrottles } from "./graphClient.js";
import { publishPaused, type PublishInput } from "./publisher.js";
import { readVideoStatus, VIDEO_READY_POLLS, type PublishVideoFile } from "./publisherVideo.js";

/**
 * The Meta publisher's CONTRACT SUITE, a motion ad's half (V4; §4R Publisher row). The rules are
 * `publisher.contract.test.ts`'s: FakeMeta by default, Meta's sandbox with `ADS_TARGET=sandbox`; faults on the
 * wire from the fault proxy in front of either; what was made is what the TARGET answered success to, and
 * every check of what exists reads it back through Graph. Nothing here reads FakeMeta's library.
 *
 * The videos are real MP4s — the simulator's own clip (a frame pushed in for two seconds, H.264, 1080 × 1350),
 * drawn once with ffmpeg — because the sandbox must be sent what compose stores, not a sixteen-byte header.
 * ffmpeg is on CI's `test-api` runner (ci.yml) and on the server's image; a machine without it fails this file
 * in `beforeAll`, by name.
 *
 * A verdict only the platform gives — an encoding that fails, one that never finishes — is played by the
 * proxy's overlay on the video's status read, as an ad's rejection is in the monitor's suite: the sandbox
 * will not fail an encoding on request either.
 */
vi.setConfig({ hookTimeout: 120_000 });

const VIDEO_ADS = /^act_\d+\/video_ads$/;
const UPLOAD = /^video-ads-upload\//;
const CREATIVES = /^act_\d+\/adcreatives$/;
const OBJECTS: Array<[string, RegExp]> = [["campaign", /^act_\d+\/campaigns$/], ["ad set", /^act_\d+\/adsets$/], ["form", /^\d+\/leadgen_forms$/], ["ad creative", CREATIVES], ["ad", /^act_\d+\/ads$/]];
/** Each video step, and how many earlier calls on its path are let through first (start and finish share one). */
const VIDEO_STEPS = [["start", VIDEO_ADS, 0], ["file", UPLOAD, 0], ["finish", VIDEO_ADS, 1]] as const;
const FAULTS: Array<[string, FakeMetaFault]> = [["a 429", { kind: "throttle", regainMinutes: 1 }], ["a 5xx", { kind: "temporary" }], ["a timeout", { kind: "hang" }]];

const sha = (x: Buffer) => createHash("sha256").update(x).digest("hex");
let images: Map<string, Buffer>;
let clips: Map<string, Buffer>;
let stills: [string, string];
let files: PublishVideoFile[];
beforeAll(async () => {
  const draw = (r: number, g: number, b: number) => sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r, g, b } } }).png().toBuffer();
  const pngs = [await draw(20, 60, 110), await draw(110, 60, 20)];
  const mp4s = [await drawSimulatedClip([pngs[0]!], { duration: 2 }), await drawSimulatedClip([pngs[1]!], { duration: 2 })];
  stills = pngs.map(sha) as [string, string];
  images = new Map(pngs.map((x) => [sha(x), x]));
  clips = new Map(mp4s.map((x) => [sha(x), x]));
  files = mp4s.map((x, i) => ({ language: i === 0 ? "en" as const : "es" as const, sha256: sha(x), byte_size: x.length }));
});

let t: MetaTarget;
let w: AdsWorld;
let campaignId: string;
let creativeId: string;
beforeEach(async () => {
  resetGraphThrottles();
  t = await openMetaTarget();
  campaignId = randomUUID();
  creativeId = randomUUID();
  w = createAdsWorld({
    campaigns: [campaign(campaignId, "creating")], settings: LIVE_SETTINGS,
    connections: [{ id: CONN, org_id: ORG, provider: "meta", is_sandbox: true, token_sealed: null, page_token_sealed: null, account_ref: t.accountId, page_ref: t.pageId, status: "connected" }],
  });
});
afterEach(() => t.close());

const input = (key: string): PublishInput => contractPublishInput({ t, orgId: ORG, connectionId: CONN, campaignId, creativeId, key, en: stills[0], es: stills[1], motion: files });
const graph = (token: string) => new MetaGraph({ token, throttleKey: `contract-video:${campaignId}`, baseUrl: t.base, uploadBase: new URL(t.base).origin, timeoutMs: t.timeoutMs, sleep: async () => {} });
const deps = () => ({
  admin: w.admin, graph: graph(t.token()), pageGraph: graph(t.pageToken()), now: w.now, sleep: async () => {},
  readAsset: async (_o: string, ref: { sha256: string }) => images.get(ref.sha256) ?? Promise.reject(new Error(`no asset ${ref.sha256}`)),
  readClip: async (_o: string, ref: { sha256: string }) => clips.get(ref.sha256) ?? Promise.reject(new Error(`no clip ${ref.sha256}`)),
});
const publish = (key: string) => publishPaused(deps(), input(key));
const phase = (p: string) => t.proxy.made(VIDEO_ADS).filter((c) => c.body.upload_phase === p);
/** What the target really made: one campaign, one ad set, a form, creative and ad per language — and a video ENDED per language. */
const madeCounts = () => [...OBJECTS.map(([, edge]) => t.proxy.made(edge).length), phase("finish").length];
const ONCE = [1, 1, 2, 2, 2, 2];
const videoRows = (stint: string) => w.actions.filter((a) => a.kind === "create_paused" && String(a.idempotency_key).includes(`:${stint}:video`));

describe("Meta publisher contract, a motion ad (V4) — every video step under each fault", () => {
  const cases = VIDEO_STEPS.flatMap(([step, edge, skip]) => FAULTS.map(([label, fault]) => [step, label, edge, skip, fault] as const));

  it.each(cases)("the video %s meeting %s: the step recovers or stops, no creative is made on a video not ended, and the next stint ends with every object made once", async (step, _label, edge, skip, fault) => {
    t.proxy.faults.inject("POST", edge, fault, 1, skip);
    const first = await publish("stint-1");
    expect(t.proxy.calls.some((c) => c.fault !== null)).toBe(true);

    // A start opens a session that is no video until it is ended, and the file restarts from offset 0: both are
    // re-sent after a 5xx or a timeout and the step goes on. A finish is never re-sent: the step stops.
    const retried = step !== "finish" && fault.kind !== "throttle";
    if (retried) {
      expect(first.ok).toBe(true);
    } else {
      const code = { throttle: "rate_limited", temporary: "transient", hang: "timeout" }[fault.kind as "throttle" | "temporary" | "hang"];
      expect(first).toMatchObject({ ok: false, error_code: code, response: { step: `video_${step === "file" ? "upload" : step}` } });
      expect(t.proxy.made(CREATIVES)).toEqual([]);
      expect(videoRows("stint-1").at(-1)).toMatchObject({ status: "failed", error_code: code });
      resetGraphThrottles();
      expect((await publish("stint-2")).ok).toBe(true);
    }
    expect(madeCounts()).toEqual(ONCE);
    expectOrgScoped(w.rec, ORG);
  });

  it("a finish whose answer was lost after the target ended the session: the video's status is believed, and finish is sent once", async () => {
    t.proxy.faults.inject("POST", VIDEO_ADS, { kind: "applied_then_temporary" }, 1, 1);
    expect((await publish("stint-1")).ok).toBe(true);
    expect(t.proxy.sent(VIDEO_ADS).filter((c) => c.body.upload_phase === "finish").length).toBe(2);
    expect(madeCounts()).toEqual(ONCE);
  });
});

describe("Meta publisher contract, a motion ad — a video already on the account is adopted, never uploaded twice", () => {
  it("half-created (video yes, creative no): the next stint names the SAME video and sends no file", async () => {
    t.proxy.faults.inject("POST", CREATIVES, { kind: "hang" });
    expect(await publish("stint-1")).toEqual({ ok: false, error_code: "create_outcome_unknown" });
    const [first] = phase("start");
    const videoId = (first!.upstream!.body as { video_id: string }).video_id;
    expect([phase("start").length, t.proxy.made(UPLOAD).length, phase("finish").length]).toEqual([1, 1, 1]);

    const second = await publish("stint-2");
    if (!second.ok) throw new Error(second.error_code);
    // English was adopted; only Spanish was started, sent and ended.
    expect([phase("start").length, t.proxy.made(UPLOAD).length, phase("finish").length]).toEqual([2, 2, 2]);
    expect(second.platform_refs.ads.find((a) => a.language === "en")!.video_id).toBe(videoId);
    expect(videoRows("stint-2")[0]).toMatchObject({ status: "succeeded", response: { adopted: true }, platform_refs: { meta_video_id: videoId } });
    expect(madeCounts()).toEqual(ONCE);
  });
});

describe("Meta publisher contract, a motion ad — the encoding's verdict decides whether a creative is made", () => {
  const encoding = { video_status: "processing", uploading_phase: { status: "complete" }, processing_phase: { status: "in_progress" }, publishing_phase: { status: "not_started" } };

  it.each([
    ["the word error", { ...encoding, video_status: "error", processing_phase: { status: "error", error: { message: "Unsupported codec" } } }, "Unsupported codec"],
    ["only an error object, video_status still processing", { ...encoding, processing_phase: { status: "in_progress", error: { message: "Unsupported codec" } } }, "Unsupported codec"],
    ["expired", { ...encoding, video_status: "expired" }, "expired"],
  ])("an encoding that fails (%s) fails the step with the platform's reason, and no creative names that video", async (_l, status, reason) => {
    t.proxy.overlay(/^\d+$/, { status }, 1, "status");
    expect(await publish("stint-1")).toMatchObject({ ok: false, error_code: "video_processing_failed", response: { reason } });
    expect(t.proxy.made(CREATIVES)).toEqual([]);
    expect(videoRows("stint-1").at(-1)).toMatchObject({ status: "failed", error_code: "video_processing_failed" });
  });

  it("an encoding still running after the wait fails the step video_not_ready; the next stint waits for the same video and makes the ad", async () => {
    t.proxy.overlay(/^\d+$/, { status: encoding }, VIDEO_READY_POLLS, "status");
    expect(await publish("stint-1")).toMatchObject({ ok: false, error_code: "video_not_ready" });
    expect(t.proxy.made(CREATIVES)).toEqual([]);
    expect((await publish("stint-2")).ok).toBe(true);
    expect(madeCounts()).toEqual(ONCE);
  });
});

describe("Meta publisher contract, a motion ad — a revoked token stops the step and tells an admin", () => {
  const step = () => runCampaignStep({ admin: w.admin, now: w.now, workers: { plan: null, compose: null, platform: null, refresh: null, createPaused: (_c, key) => publishPaused(deps(), input(key.replace(`${campaignId}:`, ""))) } }, ORG, campaignId);

  it.each(VIDEO_STEPS.map(([s, edge, skip]) => [s, edge, skip] as const))("a token revoked mid-run, met first at the video %s, stops there as token_invalid and tells an admin once", async (_s, edge, skip) => {
    t.proxy.faults.inject("POST", edge, { kind: "token_expired" }, 1, skip);
    expect(await step()).toMatchObject({ kind: "stepped", event: "create_failed" });
    expect(w.byId(campaignId).last_error).toBe("token_invalid");
    expect(w.connections[0]).toMatchObject({ status: "failing", last_error: "create: token_invalid" });
    expect(w.bell.map((b) => [b.category, b.severity])).toEqual([["ads_token_expiring", "critical"]]);
    expect(t.proxy.calls.filter((c) => c.method === "POST").at(-1)?.fault).toBe("token_expired");
  });
});

describe("Meta publisher contract, a motion ad — what it made, read back from the target", () => {
  it("each video is ready on the target, and each creative read back shows that video, the still as its thumbnail, our words and our form", async () => {
    const r = await publish("stint-1");
    if (!r.ok) throw new Error(r.error_code);
    const started = phase("start").map((c) => (c.upstream!.body as { video_id: string }).video_id);
    const hashes = t.proxy.made(/^act_\d+\/adimages$/).map((c) => Object.values((c.upstream!.body as { images: Record<string, { hash: string }> }).images)[0]!.hash);
    expect([started.length, hashes.length]).toEqual([2, 2]);

    for (const id of started) {
      const read = await graph(t.token()).get<unknown>(id, { fields: "status" });
      if (!read.ok) throw new Error(`video ${id}: ${read.error.error_code}`);
      expect(readVideoStatus(read.data)).toMatchObject({ state: "ready", uploaded: true, ended: true });
    }
    // The file each session received is the file compose stored, whole: its length, by the header we sent.
    expect(t.proxy.made(UPLOAD).map((c) => Number(c.body.bytes)).sort()).toEqual(files.map((f) => f.byte_size).sort());

    const made = t.proxy.made(CREATIVES);
    expect(made.length).toBe(2);
    for (const call of made) {
      const sent = JSON.parse(call.body.object_story_spec!) as { page_id: string; video_data: Record<string, unknown> };
      const read = await graph(t.token()).get<{ object_story_spec: { page_id: string; video_data?: Record<string, unknown>; link_data?: unknown } }>((call.upstream!.body as { id: string }).id, { fields: "name,object_story_spec" });
      if (!read.ok) throw new Error(read.error.error_code);
      expect(read.data.object_story_spec.link_data).toBeUndefined();
      expect(read.data.object_story_spec).toMatchObject(sent);
      expect(started).toContain(sent.video_data.video_id);
      expect(hashes).toContain(sent.video_data.image_hash);
      expect(Object.keys(sent.video_data).sort()).toEqual(["call_to_action", "image_hash", "message", "title", "video_id"]);
    }
    expect(r.platform_refs.ads.map((a) => a.video_id).sort()).toEqual([...started].sort());
  });
});
