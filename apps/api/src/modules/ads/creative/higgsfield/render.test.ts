import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, type AdsSettings } from "@silvicom/shared";
import { FakeClock } from "../../../../testing/fakeClock.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../../testing/testEnv.js";
import { assetKey } from "../brandAssets.js";
import { FakeHiggsfield } from "./fakeHiggsfield.js";
import { HiggsfieldClient } from "./higgsfieldClient.js";
import { SIMULATED_STILL_MODEL } from "./prices.js";
import { renderInputFromPayload, renderKey, renderStatus, renderStep, type RenderInput } from "./render.js";
import { renderClientFor, stopSimulatedRenderForTests } from "./simulatedRender.js";

/**
 * The Higgsfield client's render step (C3) over real HTTP against FakeHiggsfield, with `ad_generations` an
 * in-memory ledger that enforces what 0537 does and the step depends on: `unique (org_id, idempotency_key)`
 * as 23505 and AX011's one move from `started`. The fake counts every submit that reached a model and
 * reserves the price at submit — the reading under which a double charge is visible (its header).
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const MODEL = "higgsfield-ai/soul/v2/standard";
const KEY = { id: "kid", secret: "ksecret" };
const PRICE = 40;
/** Two documented image-input models (`HIGGSFIELD_IMAGE_INPUT`): a list field and a single-URL field. */
const EDIT = "alibaba/qwen-image-3/edit";
const REMIX = "ideogram/v4.0";
const PHOTO = readFileSync(new URL("../../workers/checker/fixtures/images/reference.jpg", import.meta.url));
const PHOTO_REF = { sha256: createHash("sha256").update(PHOTO).digest("hex"), format: "jpeg" as const };
const settings = (budget: number | null, on = true): AdsSettings => ({
  ...ADS_SETTINGS_UNSET,
  budgets: { ...ADS_SETTINGS_UNSET.budgets, higgsfield_credits_monthly: budget, agents_enabled: { renderer: on } },
});

let clock: FakeClock;
let hf: FakeHiggsfield;
let base: string;
let ledger: Array<Record<string, unknown>>;
let objects: Map<string, Buffer>;
let saved: AdsSettings;
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
  // The replay read answers only the columns it selected, as PostgREST does: a row the step did not ask
  // for (`request`, which carries the final params) must not reach it by the fixture's generosity.
  if ("idempotency_key" in f) {
    const cols = String(q.ops.find((o) => o.method === "select")?.args[0] ?? "*").split(",").map((c) => c.trim());
    return ledger.filter((r) => r.org_id === f.org_id && r.idempotency_key === f.idempotency_key)
      .map((r) => (cols.includes("*") ? r : Object.fromEntries(cols.map((c) => [c, r[c]]))));
  }
  // The month fold: provider rows of this org, with the price read out of `request`, as PostgREST's `->>` would.
  return ledger.filter((r) => r.org_id === f.org_id && r.provider === f.provider)
    .map((r) => ({ ...r, price: (r.request as { price_credits?: number }).price_credits?.toString() ?? null }));
}

beforeEach(async () => {
  clock = new FakeClock("2026-11-04T12:00:00.000Z");
  hf = new FakeHiggsfield({ keyId: KEY.id, keySecret: KEY.secret, webhookSecret: `whsec_${Buffer.alloc(32, 1).toString("base64")}`, balanceCents: 1_000, prices: { [MODEL]: PRICE, [EDIT]: PRICE, [REMIX]: PRICE }, now: clock.now });
  base = await hf.start();
  ledger = [];
  objects = new Map([[assetKey(ORG, PHOTO_REF), PHOTO]]);
  saved = settings(1_000);
  seq = 0;
  db = createSupabaseRecorder({
    tables: {
      ads_settings_versions: () => [{ id: "v1", org_id: ORG, version: 1, settings: saved, kill_switch: false, kill_reason: null, created_at: "2026-11-01T00:00:00Z", created_by_name: "X" }],
      ad_generations: generations,
    },
    storage: {
      download: (k: string) => (objects.has(k) ? { data: new Blob([new Uint8Array(objects.get(k)!)]), error: null } : { data: null, error: { message: "Object not found" } }),
      upload: (k: string, b: Buffer) => (objects.has(k) ? { data: null, error: { statusCode: "409", message: "The resource already exists" } } : (objects.set(k, Buffer.from(b)), { data: { path: k }, error: null })),
    },
  });
});
afterEach(async () => hf.stop());

const input: RenderInput = { orgId: ORG, campaignId: null, creativeId: "cr-1", attempt: 1, model: MODEL, params: { prompt: "Our tractor at dawn, no text, no logos, no lettering" }, reference: null };
const PRICES = { [MODEL]: PRICE, [EDIT]: PRICE, [REMIX]: PRICE };
const step = (over: Partial<RenderInput> = {}, prices: Record<string, number> = PRICES, client = new HiggsfieldClient(KEY, { baseUrl: base })) =>
  renderStep({ admin: db.client, client, now: clock.now, prices }, { ...input, ...over });
const submitted = () => JSON.parse(onlyRequest().params.split("\n").slice(1).join("\n")) as Record<string, unknown>;
const onlyRequest = () => [...hf.requests.values()][0]!;
const row = () => ledger[0]!;

describe("renderStep — the simulator is the same step", () => {
  const simulated = async () => {
    const r = await renderClientFor(db.client, testEnv(), ORG, SIMULATED_STILL_MODEL, { DEPLOY_ENVIRONMENT: "staging" });
    if (!r.ok) throw new Error(r.reason);
    return r;
  };
  afterEach(async () => stopSimulatedRenderForTests());

  it("a simulated render stores its image in one step, its row names the simulator, and a replay asks nothing", async () => {
    const { client, prices } = await simulated();
    const done = await step({ model: SIMULATED_STILL_MODEL }, { ...prices }, client);
    expect(done).toMatchObject({ kind: "stored", replayed: false });
    expect(row()).toMatchObject({ model: SIMULATED_STILL_MODEL, status: "succeeded" });
    expect(await step({ model: SIMULATED_STILL_MODEL }, { ...prices }, client)).toMatchObject({ kind: "stored", replayed: true });
    expect(ledger).toHaveLength(1);
    expectOrgScoped(db, ORG);
  });

  it("a simulated render from a kit photo stores that photo's picture", async () => {
    const { client, prices } = await simulated();
    const done = await step({ model: SIMULATED_STILL_MODEL, reference: PHOTO_REF }, { ...prices }, client);
    const photo = await sharp(PHOTO).metadata();
    expect(done).toMatchObject({ kind: "stored", assets: [{ width: photo.width, height: photo.height }] });
  });

  it("a simulated render meets the month's budget like a real one", async () => {
    saved = settings(0);
    const { client, prices } = await simulated();
    expect(await step({ model: SIMULATED_STILL_MODEL }, { ...prices }, client)).toMatchObject({ kind: "budget_exhausted" });
  });
});

describe("renderStep — a replayed generation spends nothing", () => {
  it("submits once under the row's id, polls until done, and a replay after that asks Higgsfield nothing", async () => {
    expect(await step()).toMatchObject({ kind: "pending", why: "queued" });
    expect(onlyRequest().idempotency_key).toBe(row().id);
    expect(await step()).toMatchObject({ kind: "pending" });
    await hf.finish(onlyRequest().request_id, "completed");
    const done = await step();
    expect(done).toMatchObject({ kind: "stored", replayed: false });
    const before = hf.submits;
    expect(await step()).toMatchObject({ kind: "stored", replayed: true });
    expect(hf.submits).toBe(before);
    expect(hf.submits).toBe(1);
    expect(hf.balanceCents).toBe(1_000 - PRICE);
    expectOrgScoped(db, ORG);
  });

  it("an answer lost after Higgsfield charged is found again under the same key, not made twice", async () => {
    hf.inject(/higgsfield-ai/, { kind: "accepted_then_error" });
    expect(await step()).toMatchObject({ kind: "pending", why: expect.stringMatching(/^submit:/) });
    expect(await step()).toMatchObject({ kind: "pending", why: "queued" });
    expect(hf.requests.size).toBe(1);
    expect(hf.submits).toBe(1);
    expect(hf.balanceCents).toBe(1_000 - PRICE);
  });

  it("a second job for the same render finds the first one's row rather than writing its own", async () => {
    await step();
    await step();
    expect(ledger).toHaveLength(1);
    expect(row().idempotency_key).toBe(renderKey("cr-1", 1, MODEL));
  });
});

describe("renderStep — the output is ours, and an expired URL never reaches anyone", () => {
  it("copies the image into ad-assets by its hash and records our path and the price — no Higgsfield URL anywhere", async () => {
    await step();
    await hf.finish(onlyRequest().request_id, "completed");
    const out = await step();
    if (out.kind !== "stored") throw new Error(out.kind);
    const [asset] = out.assets;
    expect(asset).toMatchObject({ format: "png", source_format: "png", width: 2, height: 2 });
    expect(objects.has(`${ORG}/${asset!.sha256}.png`)).toBe(true);
    expect(row()).toMatchObject({ status: "succeeded", asset_sha256: asset!.sha256, asset_path: `${ORG}/${asset!.sha256}.png`, cost_units: PRICE, cost_unit: "credits", provider_request_id: onlyRequest().request_id });
    expect(JSON.stringify(row())).not.toMatch(/https?:\/\//);
    expect(JSON.stringify(out)).not.toMatch(/https?:\/\//);
    // Content-addressed: a stored object is never replaced by other bytes under its hash.
    expect(db.storageCalls().filter((c) => c.fn === "upload").map((c) => (c.args[2] as { upsert?: boolean }).upsert)).toEqual([false]);
  });

  it("a completed render whose file is already gone fails as output_expired, charged, and stores nothing", async () => {
    await step();
    await hf.finish(onlyRequest().request_id, "completed");
    clock.advance({ days: 8 });
    expect(await step()).toMatchObject({ kind: "failed", errorCode: "output_expired" });
    expect(row()).toMatchObject({ status: "failed", error_code: "output_expired", cost_units: PRICE, asset_path: null });
    expect([...objects.keys()]).toEqual([assetKey(ORG, PHOTO_REF)]);
  });

  it("a failed or nsfw render is not charged and completes failed", async () => {
    await step();
    await hf.finish(onlyRequest().request_id, "nsfw");
    expect(await step()).toMatchObject({ kind: "failed", errorCode: "nsfw" });
    expect(row()).toMatchObject({ cost_units: 0, cost_unit: "credits" });
  });
});

describe("renderStep — the credit budget is checked before the submit", () => {
  it("refuses a model nobody has priced, with no row and no submit", async () => {
    expect(await step({}, {})).toEqual({ kind: "refused", refusal: "price_unknown" });
    expect(ledger).toEqual([]);
    expect(hf.submits).toBe(0);
  });

  it("refuses when the renderer is switched off, with no row and no submit", async () => {
    saved = settings(1_000, false);
    expect(await step()).toEqual({ kind: "refused", refusal: "agent_off" });
    expect(ledger).toEqual([]);
  });

  it("writes budget_exhausted instead of submitting when the month cannot pay the price, counting renders still in flight", async () => {
    saved = settings(PRICE + 10);
    await step({ creativeId: "cr-a" });
    expect(row().status).toBe("started");
    const out = await step({ creativeId: "cr-b" });
    expect(out).toMatchObject({ kind: "budget_exhausted", refusal: "budget_spent" });
    expect(ledger[1]).toMatchObject({ status: "budget_exhausted", error_code: "budget_spent" });
    expect(hf.submits).toBe(1);
  });

  it("an unset budget refuses as budget_unset", async () => {
    saved = settings(null);
    expect(await step()).toMatchObject({ kind: "budget_exhausted", refusal: "budget_unset" });
    expect(hf.submits).toBe(0);
  });

  it("a Higgsfield account that cannot pay completes failed, uncharged", async () => {
    hf.balanceCents = 1;
    expect(await step()).toMatchObject({ kind: "failed", errorCode: "provider_balance" });
    expect(row()).toMatchObject({ status: "failed", cost_units: 0 });
  });
});

describe("renderStep — image-to-image from the kit photo (D-AD9)", () => {
  const fromPhoto = { model: EDIT, reference: PHOTO_REF };

  it("uploads the photo once, names its public URL in the model's image field, and every replay submits the row's params", async () => {
    expect(await step(fromPhoto)).toMatchObject({ kind: "pending", why: "queued" });
    const [upload] = [...hf.uploads.values()];
    expect(hf.uploads.size).toBe(1);
    expect(upload!.content_type).toBe("image/jpeg");
    expect(upload!.bytes!.equals(PHOTO)).toBe(true);
    const urls = submitted().image_urls as string[];
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\/inputs\/[0-9a-f]+\.jpeg$/);
    expect(row().request).toMatchObject({ params: { image_urls: urls }, reference: PHOTO_REF.sha256 });
    // A replay that uploaded again would name a different URL under the same key: Higgsfield's 422.
    expect(await step(fromPhoto)).toMatchObject({ kind: "pending", why: "queued" });
    expect(hf.uploads.size).toBe(1);
    await hf.finish(onlyRequest().request_id, "completed");
    expect(await step(fromPhoto)).toMatchObject({ kind: "stored", replayed: false });
    expect(hf.submits).toBe(1);
    expectOrgScoped(db, ORG);
  });

  it("a model whose field takes one URL gets the URL itself, not a list", async () => {
    await step({ ...fromPhoto, model: REMIX });
    expect(typeof submitted().image_url).toBe("string");
    expect(submitted().image_urls).toBeUndefined();
  });

  it("a model with no documented image field is refused before any row or upload, and renderStatus says so too", async () => {
    expect(await step({ ...fromPhoto, model: MODEL })).toEqual({ kind: "refused", refusal: "reference_unsupported" });
    expect(await renderStatus(db.client, PRICES, { ...input, ...fromPhoto, model: MODEL })).toEqual({ kind: "refused", refusal: "reference_unsupported" });
    expect(ledger).toEqual([]);
    expect(hf.uploads.size).toBe(0);
    // A text-only scene on the same model renders as before.
    expect(await renderStatus(db.client, PRICES, { ...input, model: MODEL })).toEqual({ kind: "absent" });
  });

  it("the budget goes first: a spent month records budget_exhausted and uploads nothing", async () => {
    saved = settings(PRICE - 1);
    expect(await step(fromPhoto)).toMatchObject({ kind: "budget_exhausted" });
    expect(hf.uploads.size).toBe(0);
  });

  it("an upload that fails for a moment writes no row, and the next run uploads and submits", async () => {
    hf.inject(/generate-upload-url/, { kind: "server_error" });
    expect(await step(fromPhoto)).toMatchObject({ kind: "pending", why: expect.stringMatching(/^upload:/) });
    expect(ledger).toEqual([]);
    expect(await step(fromPhoto)).toMatchObject({ kind: "pending", why: "queued" });
    expect(hf.submits).toBe(1);
  });

  it("a refused upload fails the render uncharged, and a run after a crash before that completion still submits nothing", async () => {
    const client = new HiggsfieldClient(KEY, { baseUrl: base });
    client.upload = async () => ({ ok: false, kind: "refused", status: 422, detail: "unsupported" });
    expect(await step(fromPhoto, PRICES, client)).toMatchObject({ kind: "failed", errorCode: "upload_422" });
    expect(row()).toMatchObject({ status: "failed", error_code: "upload_422", cost_units: 0 });
    Object.assign(row(), { status: "started", error_code: null, finished_at: null });
    expect(await step(fromPhoto)).toMatchObject({ kind: "failed", errorCode: "upload_422" });
    expect(hf.submits).toBe(0);
    expect(hf.uploads.size).toBe(0);
  });
});

describe("renderStep — Higgsfield's key never leaves in an error (sec-fixes, G-sec #2070)", () => {
  // Every road a vendor `detail` can take: a temporary answer becomes the pending `why`, which the ads_render job
  // throws (`jobs.last_error`, the log); a refusal ends the row. Each road meets a Higgsfield that QUOTES the
  // credentials it was sent, and the key must reach no outcome, ledger row or console line.
  it("the client blanks the key, and its id:secret form, from every kind of failure it answers", async () => {
    const client = new HiggsfieldClient(KEY, { baseUrl: base });
    for (const status of [500, 403, 422]) {
      hf.inject(/higgsfield-ai/, { kind: "echo_key", status });
      const r = await client.submit(MODEL, { prompt: "x" }, `00000000-0000-4000-8000-00000000099${status % 10}`);
      if (r.ok) throw new Error("expected a failure");
      expect([r.kind, r.detail.includes("[key]"), r.detail.includes(KEY.secret)]).toEqual([{ 500: "temporary", 403: "balance", 422: "refused" }[status], true, false]);
    }
    // A vendor may quote the secret without its id: blanked as well.
    hf.inject(/higgsfield-ai/, { kind: "echo_key", quote: "secret" });
    const alone = await client.submit(MODEL, { prompt: "x" }, "00000000-0000-4000-8000-000000000999");
    expect(alone.ok ? null : [alone.detail.includes("[key]"), alone.detail.includes(KEY.secret)]).toEqual([true, false]);
  });

  const leaks = (texts: string[]) => texts.filter((t) => t.includes(KEY.secret) || t.includes(`${KEY.id}:${KEY.secret}`));
  it.each([
    ["the submit, temporary", /higgsfield-ai/, 500, {}],
    ["the submit, refused", /higgsfield-ai/, 401, {}],
    ["the status read", /\/status$/, 503, {}],
    ["the kit photo's upload", /generate-upload-url/, 500, { model: EDIT, reference: PHOTO_REF }],
  ] as const)("a key Higgsfield echoes in %s reaches no job result, ledger row or log line", async (_road, path, status, over) => {
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((l) => vi.spyOn(console, l).mockImplementation((...a: unknown[]) => { lines.push(a.map((x) => inspect(x, { depth: 6 })).join(" ")); }));
    try {
      if (path.source.includes("status")) expect(await step()).toMatchObject({ kind: "pending", why: "queued" });
      hf.inject(path, { kind: "echo_key", status });
      const out = await step(over as Partial<RenderInput>);
      // The job's own words for it: the handler throws `still rendering (why)` or completes with the JSON.
      const job = out.kind === "pending" ? `ads_render: still rendering (${out.why})` : JSON.stringify(out);
      // On the pending roads the echo came back and was blanked, not merely absent; a refusal keeps only its code.
      if (out.kind === "pending") expect(job).toContain("[key]");
      else expect(out).toMatchObject({ kind: "failed", errorCode: `provider_${status}` });
      expect(leaks([job, JSON.stringify(ledger), ...db.writes().map((q) => JSON.stringify(q.write?.payload ?? null)), ...lines])).toEqual([]);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

describe("renderInputFromPayload — the ads_render job reads back what queuedRender queued", () => {
  it("round-trips the input with its kit photo, and with none; the org is the job's, not the payload's", () => {
    const withPhoto: RenderInput = { ...input, campaignId: "c-1", model: EDIT, reference: PHOTO_REF };
    expect(renderInputFromPayload(ORG, JSON.parse(JSON.stringify({ ...withPhoto, orgId: "someone-else" })))).toEqual(withPhoto);
    expect(renderInputFromPayload(ORG, JSON.parse(JSON.stringify(input)))).toEqual(input);
  });

  it("refuses a payload whose reference is not a stored photo's sha256 and format", () => {
    expect(() => renderInputFromPayload(ORG, { ...input, reference: { sha256: PHOTO_REF.sha256, format: "svg" } })).toThrow(/reference needs/);
    expect(() => renderInputFromPayload(ORG, { ...input, model: undefined })).toThrow(/needs model/);
  });
});
