import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AD_ASSET_MAX_BYTES, ADS_SETTINGS_UNSET, FORMAT_SIZE, MOTION_FORMAT, type AdsSettings } from "@silvicom/shared";
import { FakeClock } from "../../../../testing/fakeClock.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../../testing/supabaseRecorder.js";
import { assetKey } from "../brandAssets.js";
import { clipKey, prepareClip } from "../motion/motionClip.js";
import { frameStill } from "../overlay/overlay.js";
import { FakeHiggsfield } from "./fakeHiggsfield.js";
import { HiggsfieldClient } from "./higgsfieldClient.js";
import { renderInputFromPayload, renderStatus, renderStep, type RenderInput } from "./render.js";
import { HIGGSFIELD_VIDEO_CANDIDATES, motionClipParams } from "./videoModels.js";

/**
 * A motion ad's clip on the render road (V4e): the same step as a still, over real HTTP against FakeHiggsfield
 * and an in-memory ledger that enforces `unique (org_id, idempotency_key)` and AX011's one move from `started`,
 * as `render.test.ts`'s does. What a clip promises is a property of a FILE, so the file here is a real MP4 made
 * by ffmpeg and read by ffprobe; CI's `test-api` installs both and a run there without them fails (below).
 */
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
// Since 2026-11-17 (V4m) this file's tests are pinned by the readiness registry (Renderer L1/L2), and a pinned test
// may not be one that can be skipped (`lint:ads-readiness`). So a machine without ffmpeg FAILS here, by name, where
// it used to skip: `brew install ffmpeg`. The server's image and CI's `test-api` both have it.
const NO_FFMPEG = "ffmpeg and ffprobe are needed to run this file (brew install ffmpeg); the server's image and CI's test-api have them";
const onFile = it;

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const KEY = { id: "kid", secret: "ksecret" };
const PRICE = 40;
const STILL_MODEL = "alibaba/qwen-image-3/edit";
const PHOTO = readFileSync(new URL("../../workers/checker/fixtures/images/reference.jpg", import.meta.url));
const PHOTO_REF = { sha256: createHash("sha256").update(PHOTO).digest("hex"), format: "jpeg" as const };
const MODELS = Object.keys(HIGGSFIELD_VIDEO_CANDIDATES);
const WAN = "alibaba/wan-3.0/image-to-video";
const settings: AdsSettings = { ...ADS_SETTINGS_UNSET, budgets: { ...ADS_SETTINGS_UNSET.budgets, higgsfield_credits_monthly: 1_000, agents_enabled: { renderer: true } } };
const PRICES = Object.fromEntries([...MODELS, STILL_MODEL].map((m) => [m, PRICE]));

let dir: string;
/** A stand-in for a model's clip: not our frame, not our frame rate, six seconds where five were asked, with a tone on it. */
let CLIP = Buffer.alloc(0);
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ads-clip-test-"));
  if (!HAS_FFMPEG) throw new Error(NO_FFMPEG);
  const file = join(dir, "model.mp4");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=720x900:rate=24:duration=6",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]);
  CLIP = readFileSync(file);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let clock: FakeClock;
let hf: FakeHiggsfield;
let base: string;
let ledger: Array<Record<string, unknown>>;
let objects: Map<string, { bytes: Buffer; contentType: unknown }>;
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
  return ledger.filter((r) => r.org_id === f.org_id && r.provider === f.provider)
    .map((r) => ({ ...r, price: (r.request as { price_credits?: number }).price_credits?.toString() ?? null }));
}

async function start(clip: Buffer | undefined) {
  hf = new FakeHiggsfield({ keyId: KEY.id, keySecret: KEY.secret, webhookSecret: `whsec_${Buffer.alloc(32, 1).toString("base64")}`, balanceCents: 1_000, prices: PRICES, now: clock.now, ...(clip ? { clip } : {}) });
  base = await hf.start();
}

beforeEach(async () => {
  clock = new FakeClock("2026-11-17T12:00:00.000Z");
  await start(HAS_FFMPEG ? CLIP : undefined);
  ledger = [];
  objects = new Map([[assetKey(ORG, PHOTO_REF), { bytes: PHOTO, contentType: "image/jpeg" }]]);
  seq = 0;
  db = createSupabaseRecorder({
    tables: {
      ads_settings_versions: () => [{ id: "v1", org_id: ORG, version: 1, settings, kill_switch: false, kill_reason: null, created_at: "2026-11-01T00:00:00Z", created_by_name: "X" }],
      ad_generations: generations,
    },
    storage: {
      download: (k: string) => (objects.has(k) ? { data: new Blob([new Uint8Array(objects.get(k)!.bytes)]), error: null } : { data: null, error: { message: "Object not found" } }),
      upload: (k: string, b: Buffer, o?: { contentType?: unknown }) =>
        objects.has(k) ? { data: null, error: { statusCode: "409", message: "The resource already exists" } } : (objects.set(k, { bytes: Buffer.from(b), contentType: o?.contentType }), { data: { path: k }, error: null }),
    },
  });
});
afterEach(async () => hf.stop());

const clipInput = (model = WAN): RenderInput => {
  const asked = motionClipParams(model, { prompt: "slow push in, dust in the light" });
  if (!asked.ok) throw new Error(asked.refusal);
  return { orgId: ORG, campaignId: null, creativeId: "cr-1", attempt: 1, model, params: asked.params, reference: PHOTO_REF, clip: { format: MOTION_FORMAT, layout: "bottom_plate" } };
};
const step = (input: RenderInput) => renderStep({ admin: db.client, client: new HiggsfieldClient(KEY, { baseUrl: base }), now: clock.now, prices: PRICES }, input);
const onlyRequest = () => [...hf.requests.values()][0]!;
const submitted = () => JSON.parse(onlyRequest().params.split("\n").slice(1).join("\n")) as Record<string, unknown>;

describe("renderStep — a motion ad's clip", () => {
  it("CI's test-api runner has ffmpeg and ffprobe, so the file tests below ran", () => {
    if (process.env.CI === "true") expect(HAS_FFMPEG, "ffmpeg and ffprobe must be on CI's test-api runner (ci.yml)").toBe(true);
  });

  it("the picture goes up cut to the ad's frame, as frameStill cuts the still, and its URL goes in the model's own field", async () => {
    for (const [i, model] of MODELS.entries()) {
      expect(await step({ ...clipInput(model), attempt: i + 1 }), model).toMatchObject({ kind: "pending", why: "queued" });
      const sent = JSON.parse([...hf.requests.values()][i]!.params.split("\n").slice(1).join("\n")) as Record<string, unknown>;
      const upload = [...hf.uploads.values()][i]!;
      expect(upload.content_type, model).toBe("image/png");
      expect(upload.bytes!.equals(await frameStill(PHOTO, MOTION_FORMAT, "bottom_plate")), model).toBe(true);
      const meta = await sharp(upload.bytes!).metadata();
      expect({ width: meta.width, height: meta.height }, model).toEqual(FORMAT_SIZE[MOTION_FORMAT]);
      expect(sent[HIGGSFIELD_VIDEO_CANDIDATES[model]!.image_field], model).toMatch(/\/inputs\/[0-9a-f]+\.png$/);
      expect(sent, model).toMatchObject({ duration: 5, ...HIGGSFIELD_VIDEO_CANDIDATES[model]!.sound_off });
      // Never a shape: none of the three can be asked for 4:5, which is why the picture was cut.
      expect(Object.keys(sent).filter((k) => /^(aspect_ratio|aspect|ratio|resolution)$/.test(k)), model).toEqual([]);
    }
  });

  it("the layout decides which edge the cut keeps: a top band keeps the top of the picture", async () => {
    await step({ ...clipInput(), clip: { format: MOTION_FORMAT, layout: "top_band" } });
    const up = [...hf.uploads.values()][0]!.bytes!;
    expect(up.equals(await frameStill(PHOTO, MOTION_FORMAT, "top_band"))).toBe(true);
    expect(up.equals(await frameStill(PHOTO, MOTION_FORMAT, "bottom_plate"))).toBe(false);
  });

  onFile("a finished clip is stored by its bytes as an MP4, and the row says what the model really returned", async () => {
    await step(clipInput());
    await hf.finish(onlyRequest().request_id, "completed", { kind: "video" });
    const done = await step(clipInput());
    const sha = createHash("sha256").update(CLIP).digest("hex");
    // 720 × 900 at six seconds with a sound track: not what was asked, and recorded, not refused.
    const clip = { sha256: sha, format: "mp4", width: 720, height: 900, duration_ms: 6000, has_audio: true, byte_size: CLIP.length };
    expect(done).toEqual({ kind: "stored", generationId: ledger[0]!.id, assets: [], clip, replayed: false });
    const key = clipKey(ORG, { sha256: sha });
    expect(key).toBe(`${ORG}/${sha}.mp4`);
    expect(objects.get(key)!.bytes.equals(CLIP)).toBe(true);
    expect(objects.get(key)!.contentType).toBe("video/mp4");
    expect(ledger[0]).toMatchObject({ status: "succeeded", output: { clip }, asset_sha256: sha, asset_path: key, cost_units: PRICE, cost_unit: "credits", provider_request_id: onlyRequest().request_id });
    // No Higgsfield URL is written anywhere on the row.
    expect(JSON.stringify(ledger[0]!.output)).not.toContain(base);
    expectOrgScoped(db, ORG);
  });

  onFile("a replay answers from the row: the clip again, nothing asked of Higgsfield, nothing charged twice", async () => {
    await step(clipInput());
    await hf.finish(onlyRequest().request_id, "completed", { kind: "video" });
    const first = await step(clipInput());
    const balance = hf.balanceCents;
    const again = await step(clipInput());
    expect(again).toEqual({ ...first, replayed: true });
    expect(await renderStatus(db.client, PRICES, clipInput())).toEqual({ ...first, replayed: true });
    expect({ submits: hf.submits, uploads: hf.uploads.size, rows: ledger.length, balance: hf.balanceCents }).toEqual({ submits: 1, uploads: 1, rows: 1, balance });
  });

  it("every later run submits the ROW's params, so the picture goes up once however often the job runs", async () => {
    await step(clipInput());
    await step(clipInput());
    await step(clipInput());
    expect({ submits: hf.submits, uploads: hf.uploads.size, rows: ledger.length }).toEqual({ submits: 1, uploads: 1, rows: 1 });
    expect((ledger[0]!.request as { params: Record<string, unknown>; clip: unknown }).params).toEqual(submitted());
    expect((ledger[0]!.request as { clip: unknown }).clip).toEqual({ format: MOTION_FORMAT, layout: "bottom_plate" });
  });

  it("a file that is not an MP4, whatever its name says, fails the render at its price", async () => {
    await hf.stop();
    await start(undefined); // the fake's default `.mp4` is a few bytes of text
    await step(clipInput());
    await hf.finish(onlyRequest().request_id, "completed", { kind: "video" });
    expect(await step(clipInput())).toMatchObject({ kind: "failed", errorCode: "output_unsupported_format" });
    expect(ledger[0]).toMatchObject({ status: "failed", cost_units: PRICE, output: null, asset_path: null });
    expect([...objects.keys()]).toEqual([assetKey(ORG, PHOTO_REF)]);
  });

  it("a still where a clip was asked, and a clip where a still was asked, are both failures that were charged", async () => {
    await step(clipInput());
    await hf.finish(onlyRequest().request_id, "completed", { kind: "image" });
    expect(await step(clipInput())).toMatchObject({ kind: "failed", errorCode: "no_video" });
    const still: RenderInput = { orgId: ORG, campaignId: null, creativeId: "cr-2", attempt: 1, model: STILL_MODEL, params: { prompt: "a tractor" }, reference: null };
    await step(still);
    await hf.finish([...hf.requests.values()][1]!.request_id, "completed", { kind: "video" });
    expect(await step(still)).toMatchObject({ kind: "failed", errorCode: "no_image" });
    expect(ledger.map((r) => r.cost_units)).toEqual([PRICE, PRICE]);
  });

  it("a clip with no picture to start from, or on a model whose page was not read, is refused before any row", async () => {
    const noPicture = { ...clipInput(), reference: null };
    const unread = { ...clipInput(), model: STILL_MODEL };
    for (const input of [noPicture, unread]) {
      expect(await step(input)).toEqual({ kind: "refused", refusal: "reference_unsupported" });
      expect(await renderStatus(db.client, PRICES, input)).toEqual({ kind: "refused", refusal: "reference_unsupported" });
    }
    expect({ rows: ledger.length, submits: hf.submits, uploads: hf.uploads.size }).toEqual({ rows: 0, submits: 0, uploads: 0 });
  });

  it("a video model nobody priced is refused as an unpriced still model is: no upload, no row", async () => {
    const out = await renderStep({ admin: db.client, client: new HiggsfieldClient(KEY, { baseUrl: base }), now: clock.now, prices: {} }, clipInput());
    expect(out).toEqual({ kind: "refused", refusal: "price_unknown" });
    expect({ rows: ledger.length, uploads: hf.uploads.size }).toEqual({ rows: 0, uploads: 0 });
  });

  it("the job's payload carries the cut, and one naming a frame or layout we do not draw throws", () => {
    const input = clipInput();
    expect(renderInputFromPayload(ORG, { ...input })).toEqual(input);
    expect(renderInputFromPayload(ORG, { ...input, clip: undefined }).clip).toBeUndefined();
    expect(() => renderInputFromPayload(ORG, { ...input, clip: { format: "16:9", layout: "bottom_plate" } })).toThrow(/clip needs a format and a layout/);
    expect(() => renderInputFromPayload(ORG, { ...input, clip: { format: MOTION_FORMAT, layout: "sideways" } })).toThrow(/clip needs a format and a layout/);
  });
});

describe("prepareClip — the bytes decide", () => {
  const mp4Head = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(64, 7)]);

  onFile("a real MP4 answers its own frame, length and sound track", async () => {
    expect(await prepareClip(CLIP)).toMatchObject({ kind: "ready", ref: { format: "mp4", width: 720, height: 900, duration_ms: 6000, has_audio: true, byte_size: CLIP.length } });
  });

  onFile("a clip with no sound track says so", async () => {
    const silent = join(dir, "silent.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=540x676:rate=30:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", silent]);
    expect(await prepareClip(readFileSync(silent))).toMatchObject({ kind: "ready", ref: { width: 540, height: 676, duration_ms: 1000, has_audio: false } });
  });

  onFile("a file that starts like an MP4 and is not one is unreadable", async () => {
    expect(await prepareClip(mp4Head)).toMatchObject({ kind: "refused", code: "unreadable" });
    expect(await prepareClip(CLIP.subarray(0, 400))).toMatchObject({ kind: "refused", code: "unreadable" });
  });

  it("empty, another format, and larger than the bucket takes are refused without running anything", async () => {
    const none = { ffprobe: "/nonexistent/ffprobe" };
    expect(await prepareClip(Buffer.alloc(0), none)).toMatchObject({ kind: "refused", code: "unreadable" });
    expect(await prepareClip(PHOTO, none)).toMatchObject({ kind: "refused", code: "unsupported_format" });
    expect(await prepareClip(Buffer.concat([mp4Head, Buffer.alloc(AD_ASSET_MAX_BYTES)]), none)).toMatchObject({ kind: "refused", code: "too_large" });
  });

  it("a server without ffprobe answers `unavailable`, never a refusal of a clip that was paid for", async () => {
    expect(await prepareClip(mp4Head, { ffprobe: "/nonexistent/ffprobe" })).toEqual({ kind: "unavailable", detail: "/nonexistent/ffprobe is not installed on this server" });
  });
});
