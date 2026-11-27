import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { normalizeRoutePath } from "../../../middleware/requestMetrics.js";
import { hashTenstreetKey } from "../tenstreet/receive.js";

/**
 * TS3 through the real app: the route is mounted public, takes Tenstreet's `text/xml` past the app's JSON parser,
 * answers in XML, and keeps the URL's secret out of the metrics line. The receiver's rules are `receive.test.ts`.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const KEY = "Zk3_".repeat(11);
const SAMPLE = readFileSync(new URL("../../../../../../docs/tenstreet/samples/receiving_application_data_sample_1_xml.txt", import.meta.url), "utf8");
let server: Server;
let base = "";
const posts: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  holder.client = createSupabaseRecorder({
    tables: {
      tenstreet_connections: (q: RecordedQuery) => (q.write ? { data: null } : postgrestFixture([{ id: "c1", org_id: ORG, company_id: "14", mode: "test", enabled: true, key_hash: hashTenstreetKey(KEY) }])(q)),
      tenstreet_posts: (q: RecordedQuery) => {
        if (q.write?.method === "insert") { const r = { id: `p${posts.length + 1}`, ...(q.write.payload as object) }; posts.push(r); return [r]; }
        return postgrestFixture(posts)(q);
      },
      jobs: [{ id: "j1" }],
    },
    rpc: (fn) => (fn === "enqueue_job" ? "j1" : null),
  }).client;
  const app = createApp(loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") } as NodeJS.ProcessEnv));
  await new Promise<void>((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; r(); }); });
});
afterAll(async () => closeTestServer(server));

const post = (body: string, type: string, key = KEY) => fetch(`${base}/api/webhooks/tenstreet/${key}`, { method: "POST", headers: { "content-type": type }, body });

describe("/api/webhooks/tenstreet/:key", () => {
  it("takes Tenstreet's text/xml with no user sign-in and answers its TenstreetResponse in XML", async () => {
    const res = await post(SAMPLE, "text/xml; charset=utf-8");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/xml/);
    expect(await res.text()).toContain("<Status>Accepted</Status>");
    expect(posts.at(-1)).toMatchObject({ reply_status: "ACCEPTED", org_id: ORG });
  });

  it("a body of another type reaches the receiver as nothing and is refused as not XML", async () => {
    const res = await post(JSON.stringify({ xml: SAMPLE }), "application/json");
    expect(await res.text()).toContain("<Status>Rejected</Status>");
    expect(posts.at(-1)).toMatchObject({ reply_status: "REJECTED", reply_reason: "not_xml" });
  });

  it("an unknown key is a bare 401", async () => {
    const res = await post(SAMPLE, "text/xml", "x".repeat(43));
    expect([res.status, await res.text()]).toEqual([401, ""]);
  });

  it("the secret never reaches the metrics line", () => {
    expect(normalizeRoutePath(`/api/webhooks/tenstreet/${KEY}`)).toBe("/api/webhooks/tenstreet/:id");
  });
});
