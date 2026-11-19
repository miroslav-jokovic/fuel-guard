import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, MOTION_FORMAT, type AdAssetRef, type AdClipRef, type AdsSettings } from "@silvicom/shared";
import { FakeClock } from "../../../../testing/fakeClock.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../../testing/supabaseRecorder.js";
import { assetKey } from "../brandAssets.js";
import { FakeHiggsfield, type FakeHiggsfieldFault } from "./fakeHiggsfield.js";
import { HiggsfieldClient } from "./higgsfieldClient.js";
import { renderStep, type RenderInput, type RenderOutcome } from "./render.js";
import { motionClipParams } from "./videoModels.js";

/**
 * The Renderer's L3 bar (ADS-AGENT-BUILD-WORKFLOW §4R): **0 double charges across replays (the fake counts
 * submits); every stored asset matches its sha256** — held over EVERY way a render can be cut short, not the
 * handful `render.test.ts` names one by one.
 *
 * Each case runs one render to its end the way the `ads_render` job does — a step, and again until it is not
 * `pending` — while the process is KILLED once, just AFTER one side effect has happened and before the step
 * hears of it: the photo uploaded, the price asked, the ledger row written, the submit accepted, a status read, the file
 * downloaded, the file stored, the row completed. The next step is the restarted job. Separately, every
 * transient fault FakeHiggsfield can inject is put on every call. Each case is run with and without a kit
 * photo (D-AD9), so the upload's own crash points are in the sweep.
 *
 * Every case must end with the image stored, ONE submit that reached a model, the price taken from the
 * account once, one ledger row, and every object in our bucket holding exactly the bytes its name's hash
 * says — the row's `asset_sha256`/`asset_path` and its output naming those same bytes.
 *
 * The one thing a crash may repeat is the photo upload, and only when the process died between the upload
 * and the ledger row: nothing was submitted or charged yet, so a fresh upload URL in the first submit is not
 * the "same key, different URLs" Higgsfield refuses (idempotency.md, read 2026-11-04). After the row exists,
 * the row's params are what every run submits, so the upload never repeats — the sweep checks both.
 *
 * A motion ad's CLIP (V4) runs the same sweep as a third kind of render: the same step, a video model, the picture
 * cut to the ad's frame and uploaded, and an MP4 back. Its bar is the same — one charge, and the stored file is the
 * bytes its name says. The clip is a real MP4 made by ffmpeg, because the step reads it with ffprobe before it
 * stores it. A machine without them fails this file by name and skips nothing: its tests are pinned by the readiness
 * registry (Renderer L3), and a pinned test may not be one that can be skipped. CI's `test-api` and the server's
 * image both have ffmpeg.
 */
// ffprobe runs once per clip case; on a loaded machine that is not five seconds' work.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const MODEL = "alibaba/qwen-image-3/edit"; // a documented image-input model, so the photo cases can run
const VIDEO_MODEL = "alibaba/wan-3.0/image-to-video"; // one of Q-APX12's candidates, asked as its page says
/** What is rendered: a still from the kit photo, a still from words alone, or a motion ad's clip. */
type Kind = "photo" | "text" | "clip";
const KINDS: Array<[string, Kind]> = [["with the kit photo", "photo"], ["text only", "text"], ["a motion ad's clip", "clip"]];
const uploads = (k: Kind) => k !== "text";
const KEY = { id: "kid", secret: "ksecret" };
const PRICE = 40;
const PRICES = { [MODEL]: PRICE, [VIDEO_MODEL]: PRICE };
const START_BALANCE = 1_000;
const PHOTO = readFileSync(new URL("../../workers/checker/fixtures/images/reference.jpg", import.meta.url));
const PHOTO_REF = { sha256: createHash("sha256").update(PHOTO).digest("hex"), format: "jpeg" as const };
const settings: AdsSettings = { ...ADS_SETTINGS_UNSET, budgets: { ...ADS_SETTINGS_UNSET.budgets, higgsfield_usd_cents_monthly: 1_000, agents_enabled: { renderer: true } } };
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const CLIENT_CALLS = ["upload", "estimate", "submit", "status", "download"] as const;
type Kill = { at: (typeof CLIENT_CALLS)[number] | "row_insert" | "row_complete" | "store"; nth: number };
/** Every side effect, at its first occurrence and (for the polled read) a later one. */
const KILLS: Kill[] = [
  { at: "upload", nth: 1 }, { at: "estimate", nth: 1 }, { at: "row_insert", nth: 1 }, { at: "submit", nth: 1 }, { at: "status", nth: 1 }, { at: "status", nth: 2 },
  { at: "download", nth: 1 }, { at: "store", nth: 1 }, { at: "row_complete", nth: 1 },
];
/** Either model's own path: the still's or the clip's — anchored, so the price ask (`/estimate/<model>`) is not it. */
const SUBMIT = /^\/alibaba\/(?:qwen-image-3|wan-3\.0)/;
/** [case, the path faulted, the fault, the call the job must have waited on because of it] */
const FAULTS: Array<[string, RegExp, FakeHiggsfieldFault]> = [
  ["upload URL: queue full", /^\/files\/generate-upload-url/, { kind: "queue_full", retryAfterSeconds: 2 }],
  ["upload URL: server error", /^\/files\/generate-upload-url/, { kind: "server_error" }],
  ["estimate: queue full", /^\/estimate\//, { kind: "queue_full", retryAfterSeconds: 2 }],
  ["estimate: server error", /^\/estimate\//, { kind: "server_error" }],
  ["submit: queue full", SUBMIT, { kind: "queue_full", retryAfterSeconds: 2 }],
  ["submit: server error", SUBMIT, { kind: "server_error" }],
  ["submit: unavailable", SUBMIT, { kind: "unavailable" }],
  ["submit: accepted, then the answer lost", SUBMIT, { kind: "accepted_then_error" }],
  ["status: server error", /^\/requests\//, { kind: "server_error" }],
  ["status: unavailable", /^\/requests\//, { kind: "unavailable" }],
];

/** A stand-in for a model's clip: a real MP4, two seconds, with a tone on it. */
let CLIP = Buffer.alloc(0);
beforeAll(() => {
  if (!HAS_FFMPEG) throw new Error("ffmpeg and ffprobe are needed to run this file (brew install ffmpeg); the server's image and CI's test-api have them");
  const dir = mkdtempSync(join(tmpdir(), "ads-sweep-clip-"));
  try {
    const file = join(dir, "model.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=360x450:rate=24:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]);
    CLIP = readFileSync(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

let clock: FakeClock;
let hf: FakeHiggsfield;
let base: string;
let ledger: Array<Record<string, unknown>>;
let objects: Map<string, Buffer>;
let db: SupabaseRecorder;
let seq = 0;
let kill: Kill | null = null;
let seen: Record<Kill["at"], number>;

/** After the side effect, before the caller hears of it: the process dies. Once per case. */
function maybeDie(at: Kill["at"]): void {
  seen[at] += 1;
  if (kill && kill.at === at && kill.nth === seen[at]) { kill = null; throw new Error(`killed after ${at}`); }
}

function generations(q: RecordedQuery) {
  if (q.write?.method === "insert") {
    const row: Record<string, unknown> = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, output: null, ...(q.write.payload as Record<string, unknown>) };
    if (ledger.some((r) => r.org_id === row.org_id && r.idempotency_key === row.idempotency_key)) return { data: null, error: { code: "23505", message: "duplicate" } };
    ledger.push(row);
    maybeDie("row_insert");
    return [row];
  }
  const f = Object.fromEntries(q.filters().map((x) => [x.col, x.val]));
  if (q.write?.method === "update") {
    const row = ledger.find((r) => r.id === f.id && r.org_id === f.org_id && r.status === f.status);
    if (row) Object.assign(row, q.write.payload as object);
    if (row) maybeDie("row_complete");
    return row ? [row] : [];
  }
  if ("idempotency_key" in f) {
    const cols = String(q.ops.find((o) => o.method === "select")?.args[0] ?? "*").split(",").map((c) => c.trim());
    return ledger.filter((r) => r.org_id === f.org_id && r.idempotency_key === f.idempotency_key).map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
  }
  return ledger.filter((r) => r.org_id === f.org_id && r.provider === f.provider)
    .map((r) => ({ ...r, price: (r.request as { price_ticks?: number | null }).price_ticks?.toString() ?? null }));
}

/** The real client, with the process dying just after one of its calls has done its work. */
function dyingClient(): HiggsfieldClient {
  const real = new HiggsfieldClient(KEY, { baseUrl: base });
  return new Proxy(real, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver) as unknown;
      if (typeof v !== "function" || !(CLIENT_CALLS as readonly string[]).includes(String(prop))) return v;
      return async (...args: unknown[]) => {
        const out = await (v as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        maybeDie(prop as Kill["at"]);
        return out;
      };
    },
  });
}

beforeEach(async () => {
  clock = new FakeClock("2026-11-04T12:00:00.000Z");
  hf = new FakeHiggsfield({ keyId: KEY.id, keySecret: KEY.secret, webhookSecret: `whsec_${Buffer.alloc(32, 1).toString("base64")}`, balanceCents: START_BALANCE, prices: PRICES, now: clock.now, ...(HAS_FFMPEG ? { clip: CLIP } : {}) });
  base = await hf.start();
  ledger = [];
  objects = new Map([[assetKey(ORG, PHOTO_REF), PHOTO]]);
  seq = 0;
  kill = null;
  seen = { upload: 0, estimate: 0, submit: 0, status: 0, download: 0, row_insert: 0, row_complete: 0, store: 0 };
  db = createSupabaseRecorder({
    tables: {
      ads_settings_versions: () => [{ id: "v1", org_id: ORG, version: 1, settings, kill_switch: false, kill_reason: null, created_at: "2026-11-01T00:00:00Z", created_by_name: "X" }],
      ad_generations: generations,
    },
    storage: {
      download: (k: string) => (objects.has(k) ? { data: new Blob([new Uint8Array(objects.get(k)!)]), error: null } : { data: null, error: { message: "Object not found" } }),
      upload: (k: string, b: Buffer) => {
        if (objects.has(k)) return { data: null, error: { statusCode: "409", message: "The resource already exists" } };
        objects.set(k, Buffer.from(b));
        maybeDie("store");
        return { data: { path: k }, error: null };
      },
    },
  });
});
afterEach(async () => hf.stop());

/** The job: a step, and again (restarted after a death, or retried while pending) until it ends. */
async function runToEnd(input: RenderInput): Promise<{ out: RenderOutcome; deaths: number; waits: string[] }> {
  const made = input.clip ? "video" as const : "image" as const;
  let deaths = 0;
  const waits: string[] = [];
  for (let i = 0; i < 25; i += 1) {
    let out: RenderOutcome;
    try {
      out = await renderStep({ admin: db.client, client: dyingClient(), now: clock.now }, input);
    } catch (e) {
      if (!/^killed after /.test((e as Error).message)) throw e;
      deaths += 1;
      continue;
    }
    if (out.kind !== "pending") return { out, deaths, waits };
    waits.push(out.why);
    // Higgsfield finishes the work it was given; the next poll finds it done.
    for (const r of hf.requests.values()) if (r.status === "queued") await hf.finish(r.request_id, "completed", { deliver: "lost", kind: made });
  }
  throw new Error("the render never ended");
}

const input = (kind: Kind): RenderInput => {
  if (kind !== "clip") {
    return { orgId: ORG, campaignId: null, creativeId: "cr-1", attempt: 1, model: MODEL, params: { prompt: "Our tractor at dawn, no text, no logos, no lettering" }, reference: kind === "photo" ? PHOTO_REF : null };
  }
  const asked = motionClipParams(VIDEO_MODEL, { prompt: "slow push in, the truck stays the truck" });
  if (!asked.ok) throw new Error(asked.refusal);
  return { orgId: ORG, campaignId: null, creativeId: "cr-1", attempt: 1, model: VIDEO_MODEL, params: asked.params, reference: PHOTO_REF, clip: { format: MOTION_FORMAT, layout: "bottom_plate" } };
};

/** The §4R bar, and the ledger and bucket agreeing with each other about the bytes. */
function expectOneChargeAndTrueHashes(out: RenderOutcome, kind: Kind): void {
  expect(out.kind).toBe("stored");
  expect(hf.submits).toBe(1);
  expect(hf.requests.size).toBe(1);
  expect(hf.balanceCents).toBe(START_BALANCE - PRICE);
  expect(ledger).toHaveLength(1);
  const row = ledger[0]!;
  expect(row).toMatchObject({ status: "succeeded", cost_units: "0.4000", cost_unit: "usd", idempotency_key: expect.stringMatching(/^render:cr-1:1:/) });
  // Every object we hold is the bytes its name's hash says — the photo we seeded and the render we stored.
  for (const [k, bytes] of objects) expect(k, "an object stored under another file's hash").toContain(sha(bytes));
  if (kind === "clip") {
    // A clip's row holds the clip and no image; the file stored is the MP4 the model returned, whole.
    const clip = (row.output as { clip: AdClipRef }).clip;
    expect(out.kind === "stored" && out.clip).toEqual(clip);
    expect(out.kind === "stored" && out.assets).toEqual([]);
    expect(clip).toMatchObject({ format: "mp4", sha256: sha(CLIP), byte_size: CLIP.length });
    expect(row.asset_sha256).toBe(clip.sha256);
    expect(objects.get(String(row.asset_path))!.equals(CLIP)).toBe(true);
  } else {
    const assets = (row.output as { assets: AdAssetRef[] }).assets;
    expect(assets).toHaveLength(1);
    expect(out.kind === "stored" && out.assets).toEqual(assets);
    expect(row.asset_sha256).toBe(assets[0]!.sha256);
    expect(sha(objects.get(String(row.asset_path))!)).toBe(assets[0]!.sha256);
  }
  expect(objects.size).toBe(2);
  // The submit named the uploaded picture when there was one, and only that picture.
  const submitted = [...hf.requests.values()][0]!.params;
  expect(submitted.includes("/inputs/")).toBe(uploads(kind));
  expectOrgScoped(db, ORG);
}

describe("Renderer L3 — a render cut short anywhere is charged once and stores true bytes", () => {
  it("a motion ad's clip is swept wherever this file runs: ffmpeg and ffprobe are present, or the file failed before this", () => {
    expect(HAS_FFMPEG).toBe(true);
    expect(KINDS.map(([, k]) => k)).toContain("clip");
  });

  describe.each(KINDS)("%s", (_label, kind) => {
    const photo = uploads(kind);
    it.each(KILLS.filter((k) => photo || k.at !== "upload").map((k) => [`${k.at}${k.nth > 1 ? ` #${k.nth}` : ""}`, k] as const))(
      "killed just after %s, then restarted: one charge, true hashes",
      async (_name, k) => {
        kill = k;
        const { out, deaths } = await runToEnd(input(kind));
        expect(deaths, "the kill point was never reached — the case proves nothing").toBe(1);
        expectOneChargeAndTrueHashes(out, kind);
        // The photo goes up once — twice only if the process died between the upload and the row (after the upload
        // itself, or after the price was asked with its URL: Q-APX16 asks before the row). Nothing was charged then.
        if (photo) expect(hf.uploads.size).toBe(k.at === "upload" || k.at === "estimate" ? 2 : 1);
      },
    );

    it.each(FAULTS.filter(([name]) => photo || !name.startsWith("upload")))("recovered from %s: one charge, true hashes", async (_name, path, fault) => {
      hf.inject(path, fault);
      const { out, waits } = await runToEnd(input(kind));
      // The fault fired: the job waited on exactly the call it was put on.
      const call = _name.split(":")[0] === "upload URL" ? "upload" : _name.split(":")[0]!;
      expect(waits.some((w) => w.startsWith(`${call}:`)), `no wait on ${call}: ${waits.join(" / ")}`).toBe(true);
      expectOneChargeAndTrueHashes(out, kind);
      // A price ask that failed for a moment leaves no row, so the next run uploads the photo again: the same case
      // as a death between the upload and the row, and as free (uploads are not charged). Every other fault: once.
      if (photo) expect(hf.uploads.size).toBe(call === "estimate" ? 2 : 1);
    });
  });

  it("a finished render replayed after every case asks Higgsfield nothing more", async () => {
    kill = { at: "row_complete", nth: 1 };
    await runToEnd(input("photo"));
    const before = { submits: hf.submits, uploads: hf.uploads.size, requests: hf.requests.size };
    for (let i = 0; i < 3; i += 1) expect((await runToEnd(input("photo"))).out).toMatchObject({ kind: "stored", replayed: true });
    expect({ submits: hf.submits, uploads: hf.uploads.size, requests: hf.requests.size }).toEqual(before);
  });
});
