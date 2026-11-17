import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { campaign, CONN, createAdsWorld, ORG, type AdsWorld } from "../../../../testing/adsWorld.js";
import { FakeMeta } from "../simulator/fakeMeta.js";
import type { VideoFate } from "../simulator/fakeMetaVideos.js";
import { MetaGraph, resetGraphThrottles } from "./graphClient.js";
import { publishPaused, type PublishInput } from "./publisher.js";
import type { PublishCreative } from "./publisherAds.js";
import { readVideoStatus, VIDEO_READY_POLLS, VIDEO_READY_WAIT_MS } from "./publisherVideo.js";

/**
 * The publisher's video road (V4) against FakeMeta over real HTTP: what a motion ad sends, how its video's
 * status is read, and what every interrupted step leaves for the next one. The fake-only suite — it plants
 * fates and reads the fake's library; what must be true of Meta itself is in `publisher.contract.test.ts`.
 */
const TOKEN = "EAAB-video-token-0123456789";
const ACCOUNT = "2001";
const PAGE = "3001";
const PAGE_TOKEN = "EAAB-video-page-token-9876543210";
const CAMPAIGN = "ab12cd34-0000-4000-8000-000000000001";
const CREATIVE = "9f8e7d6c-0000-4000-8000-0000000000c1";

function png(tag: string): Buffer {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12, "ascii");
  head.writeUInt32BE(1080, 16);
  head.writeUInt32BE(1350, 20);
  return Buffer.concat([head, Buffer.from(tag)]);
}
/** The first box of an MP4 as FakeMeta reads it (`ftyp`), then a tag: not a playable file, and the fake does not play it. */
function mp4(tag: string): Buffer {
  const box = Buffer.alloc(16);
  box.writeUInt32BE(16, 0);
  box.write("ftypisom", 4, "latin1");
  return Buffer.concat([box, Buffer.from(tag)]);
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const STILL = { en: png("en 4:5"), es: png("es 4:5") };
const CLIP = { en: mp4("en motion ad"), es: mp4("es motion ad") };
const IMAGES = new Map([[sha(STILL.en), STILL.en], [sha(STILL.es), STILL.es]]);
const CLIPS = new Map([[sha(CLIP.en), CLIP.en], [sha(CLIP.es), CLIP.es]]);
const FILES = (["en", "es"] as const).map((language) => ({ language, sha256: sha(CLIP[language]), byte_size: CLIP[language].length }));

const creative = (patch: Partial<PublishCreative> = {}): PublishCreative => ({
  id: CREATIVE, preset_key: "P2",
  copy: { en: { hook: "Home every weekend", cta: "Apply now", body: "Regional lanes out of Joliet.", title: "Class A drivers" },
          es: { hook: "En casa cada fin de semana", cta: "Aplica ya", body: "Rutas regionales desde Joliet.", title: "Choferes Clase A" } },
  assets: [{ format: "4:5", language: "en", sha256: sha(STILL.en) }, { format: "4:5", language: "es", sha256: sha(STILL.es) }],
  platform_slots: { primary_text: "body", headline: "title" }, motion: { files: FILES }, ...patch,
});

let meta: FakeMeta;
let base: string;
let w: AdsWorld;
let waits: number[];
let clipReads: string[];

beforeEach(async () => {
  resetGraphThrottles();
  meta = new FakeMeta({ token: TOKEN, accounts: [{ id: ACCOUNT, spend_cap_cents: 300_000, amount_spent_cents: 0, account_status: 1, currency: "USD" }, { id: "2002", spend_cap_cents: 0, amount_spent_cents: 0, account_status: 1, currency: "USD" }],
    pages: [{ id: PAGE, name: "Carrier Page", access_token: PAGE_TOKEN, tasks: ["ADVERTISE"] }] });
  base = await meta.start();
  w = createAdsWorld({ campaigns: [campaign(CAMPAIGN, "creating")] });
  waits = [];
  clipReads = [];
});
afterEach(() => meta.stop());

const input = (patch: Partial<PublishInput> = {}): PublishInput => ({
  orgId: ORG, campaignId: CAMPAIGN, connectionId: CONN, accountId: ACCOUNT, pageId: PAGE, platform: "meta",
  brief_source: "recruiting_opening", brief_ref: "op-1@v3", created_at: "2026-11-02T15:00:00Z",
  area: { label: "Joliet yard", latitude: 41.525, longitude: -88.0817, radius_miles: 25, reason: "Drivers report to the Joliet yard daily" },
  daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, key: `${CAMPAIGN}:stint-1`,
  claims: [{ kind: "money", cents: 62, per: "mile" }], form_questions: ["class_a_held", "class_a_years"], creatives: [creative()], privacy_url: "https://app.silvicom360.com/privacy", ...patch,
});
const graph = (token = TOKEN) => new MetaGraph({ token, throttleKey: "conn-video", baseUrl: base, uploadBase: new URL(base).origin, timeoutMs: 300, sleep: async () => {} });
const publish = (patch: Partial<PublishInput> = {}) => publishPaused({
  admin: w.admin, graph: graph(), pageGraph: graph(PAGE_TOKEN), now: w.now,
  readAsset: async (_o, ref) => IMAGES.get(ref.sha256) ?? Promise.reject(new Error(`no asset ${ref.sha256}`)),
  readClip: async (_o, ref) => { clipReads.push(ref.sha256); return CLIPS.get(ref.sha256) ?? Promise.reject(new Error(`no clip ${ref.sha256}`)); },
  sleep: async (ms) => { waits.push(ms); },
}, input(patch));
const stint = (n: number) => ({ key: `${CAMPAIGN}:stint-${n}` });

const START = /^act_\d+\/video_ads$/;
const UPLOAD = /^video-ads-upload\//;
/** Requests the fake received, as `phase` words: start, finish, upload, and status reads of a video. */
const sent = () => meta.requests.flatMap((r) => {
  const path = r.path.replace(/^\/(v[\d.]+\/)?/, "");
  if (r.method === "POST" && START.test(path)) return [r.body.upload_phase!];
  if (r.method === "POST" && UPLOAD.test(path)) return ["upload"];
  if (r.method === "POST" && /adcreatives$/.test(path)) return ["creative"];
  return r.method === "GET" && r.body.fields === "status" ? ["status"] : [];
});
const count = (word: string) => sent().filter((x) => x === word).length;
const rows = (level: string) => w.actions.filter((a) => a.kind === "create_paused" && String((a.request as { level?: string }).level).startsWith(level));
const videos = () => [...meta.videos.videos.values()];

describe("a video's status, read for its errors as well as its words", () => {
  const phases = (uploading: unknown, processing: unknown, publishing: unknown = { status: "not_started" }) => ({ uploading_phase: uploading, processing_phase: processing, publishing_phase: publishing });
  it.each([
    ["ready", { video_status: "ready", ...phases({ status: "complete" }, { status: "complete" }, { status: "complete" }) }, { state: "ready", uploaded: true, ended: true }],
    ["nothing uploaded yet", { video_status: "processing", ...phases({ status: "not_started", bytes_transferred: 0 }, { status: "not_started" }) }, { state: "pending", uploaded: false, ended: false }],
    ["uploaded, session not ended", { video_status: "processing", ...phases({ status: "complete" }, { status: "not_started" }) }, { state: "pending", uploaded: true, ended: false }],
    ["uploaded, spelt the Reels guide's way", { video_status: "processing", ...phases({ status: "completed" }, { status: "not_started" }) }, { state: "pending", uploaded: true, ended: false }],
    ["encoding", { video_status: "processing", ...phases({ status: "complete" }, { status: "in_progress" }) }, { state: "pending", uploaded: true, ended: true }],
    ["failed, in words", { video_status: "error", ...phases({ status: "complete" }, { status: "error", error: { message: "Bad codec" } }) }, { state: "failed", reason: "Bad codec" }],
    ["failed, by video_status alone", { video_status: "error", ...phases({ status: "complete" }, { status: "in_progress" }) }, { state: "failed", reason: "error" }],
    ["failed, said only by an error object", { video_status: "processing", ...phases({ status: "complete" }, { status: "in_progress", error: { message: "Bad codec" } }) }, { state: "failed", reason: "Bad codec" }],
    ["failed, by a phase's word alone", { video_status: "processing", ...phases({ status: "error" }, { status: "not_started" }) }, { state: "failed", reason: "processing" }],
    ["expired", { video_status: "expired", ...phases({ status: "not_started" }, { status: "not_started" }) }, { state: "failed", reason: "expired" }],
    ["a word no page lists", { video_status: "upload_complete" }, { state: "pending", uploaded: false, ended: false }],
  ])("%s", (_l, status, want) => {
    expect(readVideoStatus({ id: "1", status })).toMatchObject(want);
  });

  it("an answer with no status is pending and nothing is taken as done — never ready", () => {
    for (const body of [null, {}, { status: null }, { status: "ready" }]) expect(readVideoStatus(body)).toEqual({ state: "pending", uploaded: false, ended: false, reason: null });
  });
});

describe("Meta publisher — a motion ad (V4)", () => {
  it("uploads each language's video and makes a video lead ad: the file, then the creative with the still as its thumbnail, our words, our form", async () => {
    const r = await publish();
    if (!r.ok) throw new Error(r.error_code);
    expect(sent()).toEqual(["start", "upload", "finish", "status", "status", "creative", "start", "upload", "finish", "status", "status", "creative"]);
    expect(rows("").map((x) => (x.request as { level: string }).level)).toEqual(["campaign", "adset", "form:en", "form:es",
      "video:9f8e7d6c:EN", "videofile:9f8e7d6c:EN", "creative:9f8e7d6c:EN", "ad:9f8e7d6c:EN", "video:9f8e7d6c:ES", "videofile:9f8e7d6c:ES", "creative:9f8e7d6c:ES", "ad:9f8e7d6c:ES"]);
    expect(rows("").every((x) => x.status === "succeeded")).toBe(true);

    for (const language of ["en", "es"] as const) {
      const ad = r.platform_refs.ads.find((a) => a.language === language)!;
      const video = meta.videos.videos.get(ad.video_id!)!;
      expect(video).toMatchObject({ account_id: ACCOUNT, finished: true, sha256: sha(CLIP[language]), received: CLIP[language].length });
      expect(meta.ads.images.get(ad.image_hash)).toMatchObject({ width: 1080, height: 1350 });
      const form = r.platform_refs.meta_form_ids[language];
      expect(meta.ads.creatives.get(ad.meta_creative_id)!.object_story_spec).toEqual({
        page_id: PAGE,
        video_data: {
          video_id: ad.video_id, image_hash: ad.image_hash,
          message: language === "en" ? "Regional lanes out of Joliet." : "Rutas regionales desde Joliet.", title: language === "en" ? "Class A drivers" : "Choferes Clase A",
          call_to_action: { type: "APPLY_NOW", value: { link: "https://fb.me/", lead_gen_form_id: form } },
        },
      });
      expect(meta.sets.ads.get(ad.meta_ad_id)).toMatchObject({ status: "PAUSED", creative: { id: ad.meta_creative_id } });
      expect(rows(`video:9f8e7d6c:${language.toUpperCase()}`)[0]).toMatchObject({ creative_id: CREATIVE, platform_refs: { meta_video_id: ad.video_id }, request: { sha256: sha(CLIP[language]) } });
    }
    // The upload carries the guide's two headers, and the token never lands in the fake's log.
    const up = meta.requests.find((x) => UPLOAD.test(x.path.slice(1)))!;
    expect(up.body).toEqual({ offset: "0", file_size: String(CLIP.en.length), bytes: String(CLIP.en.length) });
    expect(JSON.stringify(meta.requests)).not.toContain(TOKEN);
    expectOrgScoped(w.rec, ORG);
  });

  it("a creative with no motion ad is an image ad exactly as before: no video call, link_data, no video_id", async () => {
    const r = await publish({ creatives: [creative({ motion: null })] });
    if (!r.ok) throw new Error(r.error_code);
    expect([count("start"), count("upload"), count("status")]).toEqual([0, 0, 0]);
    expect(r.platform_refs.ads.map((a) => "video_id" in a)).toEqual([false, false]);
    expect(Object.keys(meta.ads.creatives.get(r.platform_refs.ads[0]!.meta_creative_id)!.object_story_spec)).toEqual(["page_id", "link_data"]);
  });

  it("a motion ad missing one language's file is refused before any call — never published as its still", async () => {
    expect(await publish({ creatives: [creative({ motion: { files: FILES.slice(0, 1) } })] })).toEqual({ ok: false, error_code: "motion_file_missing" });
    expect(meta.requests).toEqual([]);
    expect(w.actions.at(-1)).toMatchObject({ status: "refused", error_code: "motion_file_missing" });
  });

  it("the creative is made only after Meta says the video is ready, with a wait between reads", async () => {
    meta.videos.processingReads = 3;
    expect((await publish()).ok).toBe(true);
    const en = sent().slice(0, sent().indexOf("creative"));
    expect(en).toEqual(["start", "upload", "finish", "status", "status", "status", "status"]);
    expect(waits.slice(0, 3)).toEqual([VIDEO_READY_WAIT_MS, VIDEO_READY_WAIT_MS, VIDEO_READY_WAIT_MS]);
  });

  it("a finished phase spelt `completed` is read as done", async () => {
    meta.videos.doneWord = "completed";
    expect((await publish()).ok).toBe(true);
    expect(count("finish")).toBe(2);
  });
});

describe("Meta publisher — a video that is not ready, or never will be", () => {
  it("still encoding after the wait: the step fails video_not_ready, no creative is made, and the next stint waits for the SAME video", async () => {
    meta.videos.processingReads = 1_000;
    const first = await publish();
    expect(first).toMatchObject({ ok: false, error_code: "video_not_ready", response: { polls: VIDEO_READY_POLLS } });
    expect([count("status"), count("creative"), waits.length]).toEqual([VIDEO_READY_POLLS, 0, VIDEO_READY_POLLS - 1]);
    const [held] = videos();
    expect(rows("videofile")).toMatchObject([{ status: "failed", error_code: "video_not_ready", platform_refs: { meta_video_id: held!.id } }]);

    meta.videos.processingReads = 0;
    const second = await publish(stint(2));
    if (!second.ok) throw new Error(second.error_code);
    // English: nothing sent again. Spanish: its own start, upload and finish.
    expect([count("start"), count("upload"), count("finish")]).toEqual([2, 2, 2]);
    expect(second.platform_refs.ads[0]!.video_id).toBe(held!.id);
    expect(videos().length).toBe(2);
    expect(rows("video:9f8e7d6c:EN").at(-1)).toMatchObject({ status: "succeeded", response: { adopted: true }, platform_refs: { meta_video_id: held!.id } });
    expect(clipReads).toEqual([sha(CLIP.en), sha(CLIP.es)]);
  });

  it.each<[VideoFate, string]>([["error", "The video could not be processed."], ["error_object_only", "The video could not be processed."], ["expired", "expired"]])(
    "Meta's encoding ends in %s: the step fails with Meta's reason and makes no creative; the next stint uploads the file anew", async (fate, reason) => {
      meta.videos.fate = fate;
      const first = await publish();
      expect(first).toMatchObject({ ok: false, error_code: "video_processing_failed", response: { reason } });
      expect(count("creative")).toBe(0);

      meta.videos.fate = "ready";
      const second = await publish(stint(2));
      if (!second.ok) throw new Error(second.error_code);
      const failed = videos()[0]!;
      expect(failed.fate).toBe(fate);
      expect(second.platform_refs.ads.map((a) => a.video_id)).not.toContain(failed.id);
      expect(videos().length).toBe(3);
    });

  it("a video the ledger kept that Meta no longer knows is uploaded anew, not waited for", async () => {
    meta.videos.processingReads = 1_000;
    await publish();
    meta.videos.videos.clear();
    meta.videos.processingReads = 0;
    expect((await publish(stint(2))).ok).toBe(true);
    expect(videos().length).toBe(2);
  });

  it("a session is adopted only on the connection that opened it: another connection's ledger row opens a new one", async () => {
    meta.videos.processingReads = 1_000;
    await publish();
    meta.videos.processingReads = 0;
    const r = await publish({ ...stint(2), connectionId: "conn-other" });
    if (!r.ok) throw new Error(r.error_code);
    expect(r.platform_refs.ads[0]!.video_id).not.toBe(videos()[0]!.id);
    expect(videos().length).toBe(3);
  });

  it("a session is one ad's: two languages holding the very same file still get a video each", async () => {
    const r = await publish({ creatives: [creative({ motion: { files: [FILES[0]!, { ...FILES[0]!, language: "es" }] } })] });
    if (!r.ok) throw new Error(r.error_code);
    expect(new Set(r.platform_refs.ads.map((a) => a.video_id)).size).toBe(2);
    expect(videos().length).toBe(2);
  });

  it("a session is adopted only for the same file: another file under the same ad's name opens its own", async () => {
    meta.videos.processingReads = 1_000;
    await publish();
    meta.videos.processingReads = 0;
    const other = mp4("en motion ad, made again");
    CLIPS.set(sha(other), other);
    const r = await publish({ ...stint(2), creatives: [creative({ motion: { files: [{ language: "en", sha256: sha(other), byte_size: other.length }, FILES[1]!] } })] });
    if (!r.ok) throw new Error(r.error_code);
    expect(meta.videos.videos.get(r.platform_refs.ads[0]!.video_id!)!.sha256).toBe(sha(other));
    expect(videos().length).toBe(3);
  });
});

describe("Meta publisher — every interrupted video step leaves one video", () => {
  /** Videos in the account's library (ended sessions), per file. */
  const inLibrary = () => videos().filter((v) => v.finished).map((v) => v.sha256).sort();
  const BOTH = [sha(CLIP.en), sha(CLIP.es)].sort();

  it.each([
    ["the start, lost after Meta opened the session", START, { kind: "applied_then_temporary" }],
    ["the start, timed out", START, { kind: "hang" }],
    ["the upload, a 5xx", UPLOAD, { kind: "temporary" }],
    ["the upload, lost after Meta took the file", UPLOAD, { kind: "applied_then_temporary" }],
    ["the upload, timed out", UPLOAD, { kind: "hang" }],
  ] as const)("%s: sent again in the same step, and the library holds each file once", async (_l, path, fault) => {
    meta.inject("POST", path, fault);
    expect((await publish()).ok).toBe(true);
    expect(inLibrary()).toEqual(BOTH);
  });

  it("the finish, lost after Meta ended the session: the video's own status is believed and finish is not sent twice", async () => {
    // The first video_ads POST is the start; the fault waits for the second, the finish.
    meta.inject("POST", START, { kind: "applied_then_temporary" }, 1, 1);
    const r = await publish();
    expect(r.ok).toBe(true);
    expect([count("finish"), count("start")]).toEqual([2, 2]);
    expect(inLibrary()).toEqual(BOTH);
  });

  it.each([["timed out", { kind: "hang" }, "timeout"], ["a 429", { kind: "throttle", regainMinutes: 1 }, "rate_limited"]] as const)(
    "the finish %s before Meta took it: the step fails as itself, and the next stint ends the SAME session without sending the file again", async (_l, fault, code) => {
      meta.inject("POST", START, fault, 1, 1);
      const first = await publish();
      expect(first).toMatchObject({ ok: false, error_code: code, response: { step: "video_finish" } });
      expect(rows("videofile")).toMatchObject([{ status: "failed", error_code: code }]);
      expect(inLibrary()).toEqual([]);

      resetGraphThrottles();
      const second = await publish(stint(2));
      expect(second.ok).toBe(true);
      expect([count("start"), count("upload")]).toEqual([2, 2]);
      expect(inLibrary()).toEqual(BOTH);
      expect(videos().length).toBe(2);
    });

  it("a token revoked while the video is read stops there as token_invalid — the code the connection alert knows", async () => {
    // The first four reads of an id are the campaign's, the ad set's and the two forms' read-backs.
    meta.inject("GET", /^\d+$/, { kind: "token_expired" }, 1, 4);
    expect(await publish()).toMatchObject({ ok: false, error_code: "token_invalid", response: { step: "video_status" } });
    expect(count("creative")).toBe(0);
  });

  it("the same step delivered again after it finished sends nothing and answers the same video", async () => {
    const first = await publish();
    const before = meta.requests.filter((x) => x.method === "POST").length;
    const second = await publish();
    if (!first.ok || !second.ok) throw new Error("publish failed");
    expect(meta.requests.filter((x) => x.method === "POST").length - before).toBe(2); // the two image uploads, which set a value
    expect(second.platform_refs.ads.map((a) => a.video_id)).toEqual(first.platform_refs.ads.map((a) => a.video_id));
    expect(videos().length).toBe(2);
  });

  it("the same step delivered while its first delivery is still opening the session opens no second one", async () => {
    w.actions.push({ id: "in-flight", org_id: ORG, campaign_id: CAMPAIGN, creative_id: CREATIVE, connection_id: CONN, kind: "create_paused", status: "started",
      idempotency_key: `create_paused:${CAMPAIGN}:stint-1:video:9f8e7d6c:EN`, request: { level: "video:9f8e7d6c:EN", sha256: sha(CLIP.en) }, platform_refs: null, response: null });
    expect(await publish()).toEqual({ ok: false, error_code: "create_outcome_unknown" });
    expect(count("start")).toBe(0);
  });
});

describe("Meta publisher — a creative found under a motion ad's name must be that motion ad", () => {
  it.each([
    ["another video", (spec: { video_data?: Record<string, unknown> }) => { spec.video_data!.video_id = "1"; }, ["video_id"]],
    ["another thumbnail", (spec: { video_data?: Record<string, unknown> }) => { spec.video_data!.image_hash = "0".repeat(32); }, ["image_hash"]],
    ["a link that is not the lead-ad link", (spec: { video_data?: Record<string, unknown> }) => { (spec.video_data!.call_to_action as { value: { link: string } }).value.link = "https://example.com/"; }, ["link"]],
    ["an image ad", (spec: { video_data?: Record<string, unknown>; link_data?: Record<string, unknown> }) => { spec.link_data = spec.video_data; delete spec.video_data; }, ["link_data", "video_id", "image_hash", "message", "title", "call_to_action", "link"]],
  ] as const)("found showing %s: refused as a mismatch naming the fields, never adopted", async (_l, tamper, fields) => {
    const first = await publish();
    if (!first.ok) throw new Error(first.error_code);
    const en = first.platform_refs.ads.find((a) => a.language === "en")!;
    tamper(meta.ads.creatives.get(en.meta_creative_id)!.object_story_spec);
    expect(await publish(stint(2))).toEqual({ ok: false, error_code: "readback_mismatch", response: { id: en.meta_creative_id, fields } });
    expect(meta.ads.creatives.size).toBe(2);
  });
});

describe("FakeMeta's video library — what it refuses (each OUR reading until L4)", () => {
  const start = async (account = ACCOUNT) => (await graph().post<{ video_id: string; upload_url: string }>(`act_${account}/video_ads`, { upload_phase: "start" }, { idempotent: true }));
  const finish = (id: string) => graph().post(`act_${ACCOUNT}/video_ads`, { upload_phase: "finish", video_id: id }, { idempotent: false });
  const creativeWith = (video_data: Record<string, unknown>) => graph().post(`act_${ACCOUNT}/adcreatives`, { name: "x", object_story_spec: { page_id: PAGE, video_data } }, { idempotent: false });

  it("start answers a video id and Meta's own upload host; the file must be an MP4 of the length its header says; a session ends once", async () => {
    const s = await start();
    if (!s.ok) throw new Error(s.error.error_code);
    expect(s.data.upload_url).toBe(`https://rupload.facebook.com/video-ads-upload/v26.0/${s.data.video_id}`);
    expect(await finish(s.data.video_id)).toMatchObject({ ok: false, error: { message: expect.stringContaining("No file was uploaded") } });
    expect(await graph().upload(s.data.upload_url, png("not a video"))).toMatchObject({ ok: false, error: { code: 352 } });
    expect((await graph().upload(s.data.upload_url, CLIP.en)).ok).toBe(true);
    expect((await finish(s.data.video_id)).ok).toBe(true);
    expect(await finish(s.data.video_id)).toMatchObject({ ok: false, error: { message: expect.stringContaining("already ended") } });
    expect(await graph().upload(s.data.upload_url, CLIP.en)).toMatchObject({ ok: false, error: { message: expect.stringContaining("has ended") } });
  });

  it("the upload host takes the file only with the token: another token is refused as 190 and nothing is stored", async () => {
    const s = await start();
    if (!s.ok) throw new Error(s.error.error_code);
    expect(await graph("someone-else").upload(s.data.upload_url, CLIP.en)).toMatchObject({ ok: false, error: { kind: "token_invalid", code: 190 } });
    expect(meta.videos.videos.get(s.data.video_id)!.received).toBe(0);
  });

  it("a session that was never ended is not in the account's list; an ended one is", async () => {
    const [a, b] = [await start(), await start()];
    if (!a.ok || !b.ok) throw new Error("start failed");
    await graph().upload(b.data.upload_url, CLIP.en);
    await finish(b.data.video_id);
    const list = await graph().get<{ data: Array<{ id: string }> }>(`act_${ACCOUNT}/video_ads`);
    expect(list.ok && list.data.data.map((v) => v.id)).toEqual([b.data.video_id]);
  });

  it("a creative is refused a video still encoding, another account's video, an unknown thumbnail and a link that is not fb.me", async () => {
    const r = await publish();
    if (!r.ok) throw new Error(r.error_code);
    const ok = meta.ads.creatives.get(r.platform_refs.ads[0]!.meta_creative_id)!.object_story_spec.video_data!;
    expect((await creativeWith(ok)).ok).toBe(true);

    const encoding = await start();
    const foreign = await start("2002");
    if (!encoding.ok || !foreign.ok) throw new Error("start failed");
    await graph().upload(encoding.data.upload_url, CLIP.en);
    await finish(encoding.data.video_id);
    // The other account's video is finished and READY there — refused here for whose it is, not for its state.
    await graph().upload(foreign.data.upload_url, CLIP.en);
    await graph().post("act_2002/video_ads", { upload_phase: "finish", video_id: foreign.data.video_id }, { idempotent: false });
    for (let i = 0; i < 2; i += 1) await graph().get(foreign.data.video_id, { fields: "status" });
    expect(meta.videos.usable(foreign.data.video_id, "2002")).toBe("ok");
    const cta = ok.call_to_action as { type: string; value: Record<string, unknown> };
    for (const bad of [
      { video_id: encoding.data.video_id }, { video_id: foreign.data.video_id }, { video_id: "1" }, { image_hash: "f".repeat(32) },
      { call_to_action: { ...cta, value: { ...cta.value, link: "https://example.com/" } } }, { call_to_action: { ...cta, type: "WATCH_MORE" } },
    ]) expect((await creativeWith({ ...ok, ...bad })).ok, JSON.stringify(bad)).toBe(false);
    // One spec holds a picture or a video, not both.
    const both = await graph().post(`act_${ACCOUNT}/adcreatives`, { name: "x", object_story_spec: { page_id: PAGE, video_data: ok, link_data: {} } }, { idempotent: false });
    expect(both.ok).toBe(false);
  });
});
