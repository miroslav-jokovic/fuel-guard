import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { STEP_UP_TOKEN_HEADER, mintStepUpToken } from "../../../lib/stepUpToken.js";
import type { ProbeOutcome } from "../probe.js";

/**
 * The FleetPal connection door (FLEETPAL-INTEGRATION-PLAN.md §8, 2026-10-04).
 *
 * What is proved here is the order of two acts and one refusal: the vendor is asked about a key
 * BEFORE it is sealed, a key it refuses is never written, and nothing this surface returns or audits
 * carries key material. The sealing itself is `secretBox`'s and is tested there.
 */

const holder = vi.hoisted(() => ({
  client: null as unknown,
  probe: { ok: true, ms: 120 } as ProbeOutcome,
  probedWith: [] as string[],
}));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));
vi.mock("../probe.js", () => ({
  probeApiKey: async (apiKey: string) => {
    holder.probedWith.push(apiKey);
    return holder.probe;
  },
}));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ADMIN: AuthContext = { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" };
const KEY = "test-fleetpal-key-not-real";
const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  FLEETPAL_SYNC_ENABLED: "true",
} as NodeJS.ProcessEnv);

let server: Server;
let baseUrl = "";
let db: SupabaseRecorder;

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async () => ADMIN;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await closeTestServer(server);
});

beforeEach(() => {
  holder.probe = { ok: true, ms: 120 };
  holder.probedWith = [];
  db = createSupabaseRecorder({
    tables: {
      fleetpal_credentials: () => ({ data: [], error: null }),
      fleetpal_sync_state: () => ({ data: [], error: null }),
      audit_logs: () => ({ data: [], error: null }),
    },
  });
  holder.client = db.client;
});

function post(path: string, body?: unknown, stepUp = true) {
  return fetch(`${baseUrl}/api/integrations/fleetpal/${path}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
      ...(stepUp ? { [STEP_UP_TOKEN_HEADER]: mintStepUpToken(env, ADMIN.userId, ORG)!.token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("storing a FleetPal key", () => {
  it("asks FleetPal first and seals only a key it accepted — never the plaintext, anywhere", async () => {
    const res = await post("key", { apiKey: KEY });
    expect(res.status).toBe(200);
    expect(holder.probedWith).toEqual([KEY]);

    // Two writes on a first key — `setApiKey` is UPDATE-then-INSERT and the fixture has no row yet.
    const stored = db.writtenRows("fleetpal_credentials");
    expect(stored.length).toBeGreaterThan(0);
    for (const row of stored) expect(typeof row.api_key_sealed).toBe("string");
    // The whole write set, not one column: a key that leaked into any row or the audit meta fails.
    expect(JSON.stringify(db.writes())).not.toContain(KEY);
    expect(db.writtenRows("audit_logs")[0]).toMatchObject({ action: "integration.fleetpal.key_set" });
  });

  it("stores nothing when FleetPal refuses the key, and says the key is the problem", async () => {
    holder.probe = { ok: false, kind: "auth", message: "401" };
    const res = await post("key", { apiKey: KEY });
    const body = (await res.json()) as { error: { code: string } };
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("fleetpal_key_refused");
    expect(db.writes()).toEqual([]);
  });

  it("stores nothing when FleetPal does not answer, and does not blame the key", async () => {
    holder.probe = { ok: false, kind: "server", message: "503" };
    const res = await post("key", { apiKey: KEY });
    const body = (await res.json()) as { error: { code: string } };
    expect(res.status).toBe(502);
    expect(body.error.code).toBe("fleetpal_unreachable");
    expect(db.writes()).toEqual([]);
  });

  it("takes a fresh sign-in, and does not call the vendor without one", async () => {
    const res = await post("key", { apiKey: KEY }, false);
    expect(res.status).toBe(403);
    expect(holder.probedWith).toEqual([]);
    expect(db.writes()).toEqual([]);
  });
});

describe("the sweep's switch", () => {
  it("switches off without a fresh sign-in — a kill switch must not ask for a password first", async () => {
    const res = await post("disable", undefined, false);
    expect(res.status).toBe(200);
    expect(db.writtenRows("fleetpal_credentials")[0]).toMatchObject({ enabled: false });
  });

  it("switches on only with a fresh sign-in", async () => {
    expect((await post("enable", undefined, false)).status).toBe(403);
    const res = await post("enable");
    expect(res.status).toBe(200);
    expect(db.writtenRows("fleetpal_credentials")[0]).toMatchObject({ enabled: true });
  });
});

describe("the status read", () => {
  it("names the deploy's switch beside the org's and returns no key material", async () => {
    db = createSupabaseRecorder({
      tables: {
        fleetpal_credentials: () => ({
          data: { org_id: ORG, base_url: "https://openapi.fleetpal.io", enabled: true,
            api_key_sealed: "v1:sealed-envelope", last_synced_at: null, last_error: null },
          error: null,
        }),
        fleetpal_sync_state: () => ({ data: [], error: null }),
      },
    });
    holder.client = db.client;
    const res = await fetch(`${baseUrl}/api/integrations/fleetpal/config`, {
      headers: { Authorization: "Bearer token" },
    });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ hasKey: true, enabled: true, schedulerOn: true, resources: [] });
    expect(text).not.toContain("sealed-envelope");
  });
});

describe("FLEETPAL_SYNC_ENABLED", () => {
  it('reads "false" as off — coercion read it as on', () => {
    expect(loadEnv({ NODE_ENV: "test", FLEETPAL_SYNC_ENABLED: "false" } as NodeJS.ProcessEnv).FLEETPAL_SYNC_ENABLED).toBe(false);
    expect(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv).FLEETPAL_SYNC_ENABLED).toBe(false);
  });
});
