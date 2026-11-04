import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADS_SETTINGS_UNSET, type AdsSettings } from "@silvicom/shared";
import { FakeClock } from "../../../../testing/fakeClock.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../../testing/supabaseRecorder.js";
import { FakeHiggsfield } from "./fakeHiggsfield.js";
import { HiggsfieldClient } from "./higgsfieldClient.js";
import { renderKey, renderStep, type RenderInput } from "./render.js";

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
  if ("idempotency_key" in f) return ledger.filter((r) => r.org_id === f.org_id && r.idempotency_key === f.idempotency_key);
  // The month fold: provider rows of this org, with the price read out of `request`, as PostgREST's `->>` would.
  return ledger.filter((r) => r.org_id === f.org_id && r.provider === f.provider)
    .map((r) => ({ ...r, price: (r.request as { price_credits?: number }).price_credits?.toString() ?? null }));
}

beforeEach(async () => {
  clock = new FakeClock("2026-11-04T12:00:00.000Z");
  hf = new FakeHiggsfield({ keyId: KEY.id, keySecret: KEY.secret, webhookSecret: `whsec_${Buffer.alloc(32, 1).toString("base64")}`, balanceCents: 1_000, prices: { [MODEL]: PRICE }, now: clock.now });
  base = await hf.start();
  ledger = [];
  objects = new Map();
  saved = settings(1_000);
  seq = 0;
  db = createSupabaseRecorder({
    tables: {
      ads_settings_versions: () => [{ id: "v1", org_id: ORG, version: 1, settings: saved, kill_switch: false, kill_reason: null, created_at: "2026-11-01T00:00:00Z", created_by_name: "X" }],
      ad_generations: generations,
    },
    storage: {
      upload: (k: string, b: Buffer) => (objects.has(k) ? { data: null, error: { statusCode: "409", message: "The resource already exists" } } : (objects.set(k, Buffer.from(b)), { data: { path: k }, error: null })),
    },
  });
});
afterEach(async () => hf.stop());

const input: RenderInput = { orgId: ORG, campaignId: null, creativeId: "cr-1", attempt: 1, model: MODEL, params: { prompt: "Our tractor at dawn, no text, no logos, no lettering" } };
const step = (over: Partial<RenderInput> = {}, prices: Record<string, number> = { [MODEL]: PRICE }) =>
  renderStep({ admin: db.client, client: new HiggsfieldClient(KEY, { baseUrl: base }), now: clock.now, prices }, { ...input, ...over });
const onlyRequest = () => [...hf.requests.values()][0]!;
const row = () => ledger[0]!;

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
    expect(objects.size).toBe(0);
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
