import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AD_FORMATS, ADS_SETTINGS_UNSET, adMotionSchema, FORMAT_SIZE, MOTION_FORMAT, MOTION_FPS, MOTION_SIZE, type AdBrandKit, type AdBrief, type AdPresetRecipe, type AdsSettings } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";
import { assetKey } from "../creative/brandAssets.js";
import { renderStep } from "../creative/higgsfield/render.js";
import { drawSimulatedClip, renderChoiceFor, renderClientFor, SIMULATED_CLIP_FPS, SIMULATED_PUSH_IN, SIMULATED_RENDER_CENTS, stopSimulatedRenderForTests } from "../creative/higgsfield/simulatedRender.js";
import { clipImageField, HIGGSFIELD_VIDEO_CANDIDATES, HIGGSFIELD_VIDEO_MODEL, motionClipParams, SIMULATED_VIDEO_MODEL } from "../creative/higgsfield/videoModels.js";
import { clipKey, prepareClip, readAdClip, storeAdClip } from "../creative/motion/motionClip.js";
import { frameStill } from "../creative/overlay/overlay.js";
import { makeMotion } from "./creativeMotion.js";

/**
 * The simulator's video model (V4j), and with it the whole road of a motion ad on a server with no Higgsfield key:
 * the REAL render step, ledger, budget and storage copy against the in-process fake, then the real layers, frame
 * check and join. Only the clip's pixels are not a model's. Needs ffmpeg, as the server does; CI's `test-api` has it.
 */
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const onFile = HAS_FFMPEG ? it : it.skip;

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const STAGING = { DEPLOY_ENVIRONMENT: "staging" }, PRODUCTION = { DEPLOY_ENVIRONMENT: "production" };
/** The simulator's clip is the still's frame: it is drawn from the picture the model is sent, cut at the still's size. */
const { width: W, height: H } = FORMAT_SIZE[MOTION_FORMAT];
const settings: AdsSettings = { ...ADS_SETTINGS_UNSET, budgets: { ...ADS_SETTINGS_UNSET.budgets, higgsfield_usd_cents_monthly: 10, agents_enabled: { renderer: true } } };
const KIT = { overlays: Object.fromEntries(AD_FORMATS.map((f) => [f, { zone: null, text_color: "#FFFFFF", plate_color: "#07130E" }])), phone: "(555) 010-0142", logo: null, colors: [{ name: "primary", hex: "#0B3D2E" }, { name: "accent", hex: "#F2B01E" }, { name: "white", hex: "#FFFFFF" }] } as unknown as AdBrandKit;
const BRIEF = { claims: [{ kind: "money", cents: 68, per: "mile" }, { kind: "term", term: "home weekly" }] } as unknown as AdBrief;
const RECIPE = { layout: "bottom_plate", look: "photo", overlay_slots: { headline: "hook", cta: "cta", subline: "support" } } as unknown as AdPresetRecipe;
const COPY = {
  en: { hook: "Earn $0.68/mile and be home weekly", cta: "Apply today", support: "Home weekly" },
  es: { hook: "Gana $0.68/milla y vuelve a casa cada semana", cta: "Solicita hoy", support: "En casa cada semana" },
};

let dir: string;
let PICTURE: Buffer;
let BASE: { sha256: string; format: "png" };
let ledger: Array<Record<string, unknown>>;
let objects: Map<string, Buffer>;
let db: SupabaseRecorder;
let seq = 0;

function generations(q: RecordedQuery) {
  if (q.write?.method === "insert") {
    const row: Record<string, unknown> = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, output: null, ...(q.write.payload as Record<string, unknown>) };
    if (ledger.some((r) => r.org_id === row.org_id && r.idempotency_key === row.idempotency_key)) return { data: null, error: { code: "23505", message: "duplicate" } };
    ledger.push(row);
    return [row];
  }
  const f = Object.fromEntries(q.filters().map((x) => [x.col, x.val]));
  if (q.write?.method === "update") {
    const row = ledger.find((r) => r.id === f.id && r.org_id === f.org_id && r.status === f.status);
    if (row) Object.assign(row, q.write.payload as object);
    return row ? [row] : [];
  }
  if ("idempotency_key" in f) return ledger.filter((r) => r.org_id === f.org_id && r.idempotency_key === f.idempotency_key);
  return ledger.filter((r) => r.org_id === f.org_id && r.provider === f.provider).map((r) => ({ ...r, price: (r.request as { price_ticks?: number | null }).price_ticks?.toString() ?? null }));
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ads-sim-motion-"));
  // A picture with something in it to see move: a dark frame with a light block left of centre.
  PICTURE = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#1C2228" } })
    .composite([{ input: await sharp({ create: { width: 200, height: 200, channels: 3, background: "#C8CCD0" } }).png().toBuffer(), left: 100, top: 150 }]).png().toBuffer();
  BASE = { sha256: createHash("sha256").update(PICTURE).digest("hex"), format: "png" };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  ledger = []; seq = 0;
  objects = new Map([[assetKey(ORG, BASE), PICTURE]]);
  db = createSupabaseRecorder({
    tables: {
      ads_settings_versions: () => [{ id: "v1", org_id: ORG, version: 1, settings, kill_switch: false, kill_reason: null, created_at: "2026-11-01T00:00:00Z", created_by_name: "X" }],
      ad_generations: generations,
      ads_platform_connections: [{ id: "conn-1", org_id: ORG, provider: "simulator" }],
    },
    storage: {
      download: (k: string) => (objects.has(k) ? { data: new Blob([new Uint8Array(objects.get(k)!)]), error: null } : { data: null, error: { message: "Object not found" } }),
      upload: (k: string, b: Buffer) => (objects.has(k) ? { data: null, error: { statusCode: "409", message: "The resource already exists" } } : (objects.set(k, Buffer.from(b)), { data: { path: k }, error: null })),
    },
  });
});
afterEach(async () => stopSimulatedRenderForTests());

const frame = (file: string, n: number, w: number, h: number) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `select=eq(n\\,${n})`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: w * h + 1024 });

describe("the simulator's video model — which, where, and how it is asked", () => {
  it("in CI ffmpeg is installed: a run without it fails here instead of skipping the file tests", () => {
    if (process.env.CI === "true") expect(HAS_FFMPEG, "ffmpeg and ffprobe must be on CI's test-api runner (ci.yml)").toBe(true);
  });

  it("a simulator connection off production sets stills moving in the simulator; a real one, or production, with the chosen model or none", async () => {
    expect((await renderChoiceFor(db.client, ORG, "conn-1", STAGING)).videoModel).toBe(SIMULATED_VIDEO_MODEL);
    expect((await renderChoiceFor(db.client, ORG, "conn-1", PRODUCTION)).videoModel).toBe(HIGGSFIELD_VIDEO_MODEL);
    const meta = createSupabaseRecorder({ tables: { ads_platform_connections: [{ id: "conn-1", org_id: ORG, provider: "meta" }] } });
    expect((await renderChoiceFor(meta.client, ORG, "conn-1", STAGING)).videoModel).toBe(HIGGSFIELD_VIDEO_MODEL);
  });

  it("its job is refused in production whatever queued it, needs no key on staging, and is priced like the simulated still", async () => {
    expect(await renderClientFor(db.client, testEnv(), ORG, SIMULATED_VIDEO_MODEL, PRODUCTION)).toMatchObject({ ok: false, reason: expect.stringMatching(/^simulator_not_allowed/) });
    expect(await renderClientFor(db.client, testEnv(), ORG, SIMULATED_VIDEO_MODEL, STAGING)).toMatchObject({ ok: true });
    expect(SIMULATED_RENDER_CENTS[SIMULATED_VIDEO_MODEL]).toBe(1);
  });

  it("it is asked as a real model is — a first frame, whole seconds, no sound — and is not one of the sitting's candidates", () => {
    expect(motionClipParams(SIMULATED_VIDEO_MODEL, { prompt: "slow push-in" })).toEqual({ ok: true, seconds: 5, params: { prompt: "slow push-in", duration: 5, generate_audio: false } });
    expect(clipImageField(SIMULATED_VIDEO_MODEL)).toEqual({ field: "image_url", shape: "single" });
    expect(Object.keys(HIGGSFIELD_VIDEO_CANDIDATES)).not.toContain(SIMULATED_VIDEO_MODEL);
    expect(HIGGSFIELD_VIDEO_MODEL).not.toBe(SIMULATED_VIDEO_MODEL);
  });
});

describe("drawSimulatedClip — the frame it was sent, pushed in slowly", () => {
  onFile("an MP4 of the frame's own shape, the seconds asked, no sound; the first frame is the picture and the last is closer", async () => {
    const first = await frameStill(PICTURE, MOTION_FORMAT);
    const clip = await drawSimulatedClip([first], { duration: 4 });
    expect(await prepareClip(clip)).toMatchObject({ kind: "ready", ref: { format: "mp4", width: W, height: H, duration_ms: 4000, has_audio: false } });
    const file = join(dir, "sim.mp4");
    writeFileSync(file, clip);
    const sent = await sharp(first).greyscale().raw().toBuffer();
    const f0 = frame(file, 0, W, H), last = frame(file, 4 * SIMULATED_CLIP_FPS - 1, W, H);
    const diff = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i += 97) s += Math.abs(a[i]! - b[i]!); return s / Math.ceil(a.length / 97); };
    expect(diff(f0, sent)).toBeLessThan(3);
    expect(diff(last, sent)).toBeGreaterThan(diff(f0, sent) + 1);
    // Pushed in: the light block's right edge has moved outward from the centre, by about the push-in's share.
    const edge = (g: Buffer) => { const y = Math.round(H * 0.25); let x = 0; for (let i = 0; i < W / 2; i += 1) if (g[y * W + i]! > 120) x = i; return x; };
    const moved = (W / 2 - edge(last)) / (W / 2 - edge(sent));
    expect(moved).toBeGreaterThan(1.04);
    expect(moved).toBeLessThan(SIMULATED_PUSH_IN + 0.03);
  });

  onFile("with no frame sent it moves the empty road, and a length it is not told is five seconds", async () => {
    expect(await prepareClip(await drawSimulatedClip([]))).toMatchObject({ kind: "ready", ref: { width: 1600, height: 2000, duration_ms: 5000, has_audio: false } });
  });

  it("a server without ffmpeg says so by name", async () => {
    await expect(drawSimulatedClip([PICTURE], {}, { ffmpeg: "/nonexistent/ffmpeg" })).rejects.toThrow("simulated clip: ffmpeg is not installed on this server");
  });
});

describe("a motion ad with no Higgsfield key: the real render step and the real join over the simulator", () => {
  onFile("one step stores the clip under the simulator's name at one cent; makeMotion makes a video per language from it, and a second run buys nothing", async () => {
    const sim = await renderClientFor(db.client, testEnv(), ORG, SIMULATED_VIDEO_MODEL, STAGING);
    if (!sim.ok) throw new Error(sim.reason);
    const render = (input: Parameters<typeof renderStep>[1]) => renderStep({ admin: db.client, client: sim.client, now: () => new Date("2026-11-17T18:00:00Z") }, input);
    const run = () => makeMotion({
      videoModel: SIMULATED_VIDEO_MODEL, render,
      readAsset: async (org, ref) => objects.get(assetKey(org, ref))!,
      readClip: (org, ref) => readAdClip(db.client, org, ref), storeClip: (org, bytes) => storeAdClip(db.client, org, bytes),
    }, { ids: { orgId: ORG, campaignId: "camp-1", creativeId: "cr-1" }, attempt: 1, picture: 1, base: BASE, brief: BRIEF, recipe: RECIPE, kit: KIT, copy: COPY });

    const out = await run();
    if (out.kind !== "made") throw new Error(JSON.stringify(out));
    expect(adMotionSchema.safeParse(out.motion).success).toBe(true);
    expect(out.motion).toMatchObject({ model: SIMULATED_VIDEO_MODEL, clip: { width: W, height: H, duration_ms: 5000, has_audio: false }, frames_checked: 11 });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ model: SIMULATED_VIDEO_MODEL, status: "succeeded", cost_units: "0.0100", cost_unit: "usd", asset_path: clipKey(ORG, out.motion.clip), output: { clip: out.motion.clip } });
    // The clip and both languages' files are in our bucket under their own hashes.
    for (const key of [clipKey(ORG, out.motion.clip), ...out.motion.files.map((f) => f.path)]) {
      expect(key.endsWith(`${createHash("sha256").update(objects.get(key)!).digest("hex")}.mp4`), key).toBe(true);
    }
    // The joined files are the motion frame (Q-APX17): the clip covered up to it, the words painted at it.
    expect(out.motion.files.map((f) => [f.language, f.width, f.height])).toEqual([["en", MOTION_SIZE.width, MOTION_SIZE.height], ["es", MOTION_SIZE.width, MOTION_SIZE.height]]);
    // Each file is the five seconds of motion and the still held after it, in whole frames of the ad's rate.
    for (const f of out.motion.files) {
      expect(f.duration_ms).toBeGreaterThanOrEqual(7000);
      expect(Math.abs((f.duration_ms * MOTION_FPS) / 1000 - Math.round((f.duration_ms * MOTION_FPS) / 1000))).toBeLessThan(0.05);
    }

    const before = objects.size;
    const again = await run();
    expect(again).toMatchObject({ kind: "made", motion: { clip: out.motion.clip } });
    expect({ rows: ledger.length, objects: objects.size }).toEqual({ rows: 1, objects: before });
    expectOrgScoped(db, ORG);
  });
});
