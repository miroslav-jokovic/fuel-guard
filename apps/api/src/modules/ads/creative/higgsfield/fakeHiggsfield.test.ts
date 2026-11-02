import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../../../testing/fakeClock.js";
import { FakeHiggsfield } from "./fakeHiggsfield.js";

/**
 * FakeHiggsfield's own contract: what the renderer's client (C3) will be tested against. The webhook
 * signature is checked here by an INDEPENDENT implementation of the documented algorithm, written from
 * the docs and not from `FakeHiggsfield.sign` — two copies of one helper agreeing would prove nothing.
 */
const KEY = { keyId: "kid", keySecret: "ksecret" };
const SECRET = `whsec_${Buffer.from("thirty-two-bytes-of-webhook-key!").toString("base64")}`;
const MODEL = "higgsfield-ai/soul/v2/standard";
const AUTH = { authorization: `Key ${KEY.keyId}:${KEY.keySecret}` };

let hf: FakeHiggsfield;
let base: string;
let clock: FakeClock;
let hook: { server: Server; url: string; got: Array<{ headers: Record<string, string>; body: string }>; status: number };

beforeEach(async () => {
  clock = new FakeClock("2026-11-02T12:00:00.000Z");
  hf = new FakeHiggsfield({ ...KEY, webhookSecret: SECRET, balanceCents: 1_000, prices: { [MODEL]: 300 }, now: clock.now });
  base = await hf.start();
  const got: Array<{ headers: Record<string, string>; body: string }> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      got.push({ headers: req.headers as Record<string, string>, body: Buffer.concat(chunks).toString("utf8") });
      res.statusCode = hook.status;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  hook = { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hf`, got, status: 204 };
});
afterEach(async () => {
  await hf.stop();
  hook.server.closeAllConnections();
  await new Promise<void>((r) => hook.server.close(() => r()));
});

/**
 * Higgsfield's answer as these tests read it. The request fields are typed as present because every
 * test that reads one has just asserted a 200; an error answer is read only through `status` (HTTP)
 * and `detail`.
 */
interface HfBody {
  [field: string]: unknown;
  status: string;
  request_id: string;
  status_url: string;
  cancel_url: string;
  detail?: unknown;
  images?: Array<{ url: string; content_type?: string }>;
  video?: { url: string; content_type: string };
}

async function submit(opts: { key?: string; body?: unknown; webhook?: boolean; auth?: Record<string, string> } = {}) {
  const q = opts.webhook === false ? "" : `?hf_webhook=${encodeURIComponent(hook.url)}`;
  const res = await fetch(`${base}/${MODEL}${q}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(opts.auth ?? AUTH), ...(opts.key ? { "idempotency-key": opts.key } : {}) },
    body: JSON.stringify(opts.body ?? { prompt: "a white tractor at dawn, no text, no logos, no lettering" }),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as HfBody };
}
const get = async (url: string) => {
  const res = await fetch(url, { headers: AUTH });
  return { status: res.status, body: (await res.json()) as HfBody };
};

/** Standard Webhooks verification, written from https://docs.higgsfield.ai/docs/how-to/webhooks.md. */
function verify(headers: Record<string, string>, body: string, secret: string, nowSeconds: number): boolean {
  const ts = Number(headers["webhook-timestamp"]);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 300) return false;
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const want = createHmac("sha256", key).update(`${headers["webhook-id"]}.${headers["webhook-timestamp"]}.${body}`).digest();
  return (headers["webhook-signature"] ?? "").split(" ").some((part) => {
    const [v, sig] = part.split(",");
    const got = Buffer.from(sig ?? "", "base64");
    return v === "v1" && got.length === want.length && timingSafeEqual(got, want);
  });
}

describe("FakeHiggsfield — submit, status, finish", () => {
  it("a submit is queued with the documented links, and its status reads back", async () => {
    const r = await submit();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      status: "queued", request_id: expect.any(String), expires_after: 604800,
      status_url: `${base}/requests/${r.body.request_id}/status`, cancel_url: `${base}/requests/${r.body.request_id}/cancel`,
    });
    expect(r.headers.get("x-correlation-id")).toMatch(/\S/);
    expect((await get(r.body.status_url)).body).toEqual({ status: "queued", request_id: r.body.request_id });
  });

  it("completed carries expires_at seven days out and the image URL, which serves until then and 404s after", async () => {
    const { body } = await submit();
    await hf.finish(body.request_id, "completed");
    const s = (await get(body.status_url)).body;
    expect(s).toMatchObject({ status: "completed", expires_at: "2026-11-09T12:00:00.000Z", images: [{ url: expect.stringMatching(/\.png$/) }] });
    expect((await fetch(s.images![0]!.url)).status).toBe(200);
    clock.set("2026-11-09T12:00:00.000Z");
    expect((await fetch(s.images![0]!.url)).status).toBe(404);
  });

  it("video outputs are a single video object", async () => {
    const { body } = await submit();
    await hf.finish(body.request_id, "completed", { kind: "video" });
    expect((await get(body.status_url)).body.video).toEqual({ url: expect.stringMatching(/\.mp4$/), content_type: "video/mp4" });
  });

  it("failed carries error; nsfw carries neither error nor outputs", async () => {
    const a = (await submit()).body;
    const b = (await submit({ body: { prompt: "other" } })).body;
    await hf.finish(a.request_id, "failed");
    await hf.finish(b.request_id, "nsfw");
    expect((await get(a.status_url)).body).toEqual({ status: "failed", request_id: a.request_id, error: "Generation failed" });
    expect((await get(b.status_url)).body).toEqual({ status: "nsfw", request_id: b.request_id });
  });

  it("refuses wrong credentials (401) and an unknown model (404), in FastAPI's { detail } envelope", async () => {
    expect(await submit({ auth: { authorization: "Key kid:wrong" } })).toMatchObject({ status: 401, body: { detail: "Invalid credentials" } });
    const res = await fetch(`${base}/nobody/model`, { method: "POST", headers: AUTH, body: "{}" });
    expect(res.status).toBe(404);
  });
});

describe("FakeHiggsfield — money: idempotency, balance, refunds", () => {
  it("the same Idempotency-Key returns the original request and charges once; different parameters are 422", async () => {
    const first = await submit({ key: "gen-1" });
    const again = await submit({ key: "gen-1" });
    expect(again.body.request_id).toBe(first.body.request_id);
    expect(hf.submits).toBe(1);
    expect(hf.balanceCents).toBe(700);
    expect((await submit({ key: "gen-1", body: { prompt: "different" } })).status).toBe(422);
    expect(hf.requests.size).toBe(1);
  });

  it("accepted-then-error: the submit is charged though the answer was a 500, and a keyed replay finds it", async () => {
    hf.inject(/soul/, { kind: "accepted_then_error" });
    expect((await submit({ key: "gen-2" })).status).toBe(500);
    expect(hf.balanceCents).toBe(700);
    const replay = await submit({ key: "gen-2" });
    expect(replay.status).toBe(200);
    expect(hf.requests.size).toBe(1);
    expect(hf.balanceCents).toBe(700);
  });

  it("refuses with 403 when the balance cannot cover the price, charging nothing", async () => {
    for (const p of ["a", "b", "c"]) expect((await submit({ body: { prompt: p } })).status).toBe(200);
    expect(await submit({ body: { prompt: "d" } })).toMatchObject({ status: 403, body: { detail: "Insufficient balance" } });
    expect(hf.balanceCents).toBe(100);
  });

  it("failed and nsfw are not charged; completed is; a queued cancel is refunded, an in-progress one is 409", async () => {
    hf.balanceCents = 10_000;
    const ids = await Promise.all(["a", "b", "c", "d", "e"].map(async (p) => (await submit({ body: { prompt: p } })).body));
    await hf.finish(ids[0]!.request_id, "failed");
    await hf.finish(ids[1]!.request_id, "nsfw");
    await hf.finish(ids[2]!.request_id, "completed");
    expect((await fetch(ids[3]!.cancel_url, { method: "POST", headers: AUTH })).status).toBe(200);
    hf.startProcessing(ids[4]!.request_id);
    expect((await fetch(ids[4]!.cancel_url, { method: "POST", headers: AUTH })).status).toBe(409);
    expect(hf.balanceCents).toBe(10_000 - 300 - 300); // the completed one and the one still running
  });
});

describe("FakeHiggsfield — the signed webhook", () => {
  it("sends the documented body, signed so an independent Standard Webhooks check accepts it", async () => {
    const { body } = await submit();
    await hf.finish(body.request_id, "completed");
    expect(hook.got).toHaveLength(1);
    const d = hook.got[0]!;
    expect(verify(d.headers, d.body, SECRET, Math.floor(clock.now().getTime() / 1000))).toBe(true);
    expect(JSON.parse(d.body)).toEqual({
      request_id: body.request_id, status: "completed", error: null, expires_at: "2026-11-09T12:00:00.000Z",
      payload: { images: [{ url: expect.any(String), content_type: "image/png" }] },
    });
  });

  it("the check refuses a tampered body, the wrong secret, and a stale timestamp", async () => {
    const { body } = await submit();
    await hf.finish(body.request_id, "failed");
    const d = hook.got[0]!;
    const now = Math.floor(clock.now().getTime() / 1000);
    expect(JSON.parse(d.body)).toEqual({ request_id: body.request_id, status: "failed", error: "Generation failed", payload: null });
    expect(verify(d.headers, d.body.replace("failed", "completed"), SECRET, now)).toBe(false);
    expect(verify(d.headers, d.body, `whsec_${Buffer.from("another-key").toString("base64")}`, now)).toBe(false);
    expect(verify(d.headers, d.body, SECRET, now + 301)).toBe(false);
  });

  it("a retried event carries the SAME webhook-id; a lost one sends nothing and polling still answers", async () => {
    const a = (await submit()).body;
    await hf.finish(a.request_id, "completed", { deliver: "twice" });
    expect(hook.got.map((g) => g.headers["webhook-id"])).toEqual([hook.got[0]!.headers["webhook-id"], hook.got[0]!.headers["webhook-id"]]);
    const b = (await submit({ body: { prompt: "lost" } })).body;
    await hf.finish(b.request_id, "completed", { deliver: "lost" });
    expect(hook.got).toHaveLength(2);
    expect((await get(b.status_url)).body.status).toBe("completed");
  });

  it("no webhook without hf_webhook, and a receiver's 5xx is recorded, not swallowed", async () => {
    const quiet = (await submit({ webhook: false })).body;
    await hf.finish(quiet.request_id, "completed");
    expect(hf.deliveries).toHaveLength(0);
    hook.status = 503;
    const loud = (await submit({ body: { prompt: "x" } })).body;
    await hf.finish(loud.request_id, "completed");
    expect(hf.deliveries.map((d) => d.status)).toEqual([503]);
  });
});

describe("FakeHiggsfield — injected faults", () => {
  it("queue full is 429 with Retry-After seconds; 500 and 503 too; each consumed once and nothing charged", async () => {
    hf.inject(/soul/, { kind: "queue_full", retryAfterSeconds: 12 });
    const full = await submit();
    expect(full.status).toBe(429);
    expect(full.headers.get("retry-after")).toBe("12");
    hf.inject(/soul/, { kind: "server_error" });
    expect((await submit()).status).toBe(500);
    hf.inject(/soul/, { kind: "unavailable" });
    expect((await submit()).status).toBe(503);
    expect(hf.balanceCents).toBe(1_000);
    expect((await submit()).status).toBe(200);
  });

  it("hang: the caller's timeout decides", async () => {
    hf.inject(/soul/, { kind: "hang" });
    await expect(fetch(`${base}/${MODEL}`, { method: "POST", headers: AUTH, body: "{}", signal: AbortSignal.timeout(150) })).rejects.toThrow();
  });
});
