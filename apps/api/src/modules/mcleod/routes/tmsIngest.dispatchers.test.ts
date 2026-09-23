import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { hashIngestToken } from "../../../lib/ingestToken.js";

/**
 * `POST /api/tms/dispatchers` over the wire (L4): the agent's bearer token resolves the org, the body
 * is validated by the shared contract, and nothing the agent sends can reach `user_id` — the contract
 * strips unknown keys before the ingest sees the row.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TOKEN = "fgtms_" + "d".repeat(37);

let server: Server;
let baseUrl: string;

const post = (body: unknown, token = TOKEN) =>
  fetch(`${baseUrl}/api/tms/dispatchers`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

const seed = (): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      // A function fixture, because the recorder does not apply filters: a flat row would answer
      // every token, and the 401 test below would pass for a reason that has nothing to do with it.
      org_integrations: (q) =>
        q.filters().some((f) => f.col === "ingest_token_hash" && f.val === hashIngestToken(TOKEN))
          ? [{ org_id: ORG, provider: "mcleod", enabled: true, ingest_token_hash: hashIngestToken(TOKEN), config: {} }]
          : [],
    },
  });

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => closeTestServer(server));

describe("POST /api/tms/dispatchers", () => {
  it("stores the roster for the token's org, and a user_id in the body goes nowhere", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post({
      dispatchers: [
        { external_id: "loadmaster", display_name: "McLeod Administrator", is_system: true },
        // A misbehaving or future agent sending the link: the contract drops the key.
        { external_id: "kane", display_name: "kane", user_id: "00000000-0000-4000-8000-000000000000" },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, received: 2, upserted: 2 });
    const rows = rec.writtenRows("tms_dispatchers");
    expect(rows.map((r) => [r.external_id, r.org_id, r.is_system])).toEqual([
      ["loadmaster", ORG, true],
      ["kane", ORG, false],
    ]);
    for (const r of rows) expect(Object.keys(r)).not.toContain("user_id");
    // The token lookup is by hash across orgs by design (it is how the org is FOUND).
    expectOrgScoped(rec, ORG, { exempt: ["org_integrations"] });
  });

  it("refuses a malformed roster without writing", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post({ dispatchers: [{ display_name: "no id" }] });
    expect(res.status).toBe(400);
    expect(rec.writtenRows("tms_dispatchers")).toHaveLength(0);
  });

  it("refuses an unknown token", async () => {
    holder.client = seed().client;
    const res = await post({ dispatchers: [] }, "fgtms_" + "x".repeat(37));
    expect(res.status).toBe(401);
  });
});
