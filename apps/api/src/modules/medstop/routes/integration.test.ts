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
 * The Med-Stop connection door (MEDSTOP-PLAN.md §6, MS1).
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
const KEY = "test-medstop-key-not-real-0000";
const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  MEDSTOP_SYNC_ENABLED: "true",
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
      medstop_credentials: () => ({ data: [], error: null }),
      audit_logs: () => ({ data: [], error: null }),
    },
  });
  holder.client = db.client;
});

function post(path: string, body?: unknown, stepUp = true) {
  return fetch(`${baseUrl}/api/integrations/medstop/${path}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
      ...(stepUp ? { [STEP_UP_TOKEN_HEADER]: mintStepUpToken(env, ADMIN.userId, ORG)!.token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("storing a Med-Stop key", () => {
  it("asks Med-Stop first, seals only a key it accepted, keeps the expiry — and never the plaintext", async () => {
    const res = await post("key", { apiKey: KEY, expiresOn: "2026-12-30" });
    expect(res.status).toBe(200);
    expect(holder.probedWith).toEqual([KEY]);
    const stored = db.writtenRows("medstop_credentials");
    expect(stored.length).toBeGreaterThan(0);
    for (const row of stored) {
      expect(typeof row.api_key_sealed).toBe("string");
      expect(row.key_expires_on).toBe("2026-12-30");
    }
    expect(JSON.stringify(db.writes())).not.toContain(KEY);
    expect(db.writtenRows("audit_logs")[0]).toMatchObject({ action: "integration.medstop.key_set" });
  });

  it("stores nothing when Med-Stop refuses the key, and names the IP filter as a cause", async () => {
    holder.probe = { ok: false, kind: "auth", message: "401" };
    const res = await post("key", { apiKey: KEY });
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("medstop_key_refused");
    expect(body.error.message).toMatch(/IP filter/);
    expect(db.writes()).toEqual([]);
  });

  it("stores nothing when Med-Stop does not answer, and does not blame the key", async () => {
    holder.probe = { ok: false, kind: "server", message: "503" };
    const res = await post("key", { apiKey: KEY });
    expect(res.status).toBe(502);
    expect(db.writes()).toEqual([]);
  });

  it("takes a fresh sign-in, and does not call Med-Stop without one", async () => {
    const res = await post("key", { apiKey: KEY }, false);
    expect(res.status).not.toBe(200);
    expect(holder.probedWith).toEqual([]);
  });

  it("switches the sweep off without a fresh sign-in — a kill switch must be quick to pull", async () => {
    const res = await post("disable", undefined, false);
    expect(res.status).toBe(200);
    expect(db.writtenRows("medstop_credentials")[0]).toMatchObject({ enabled: false });
  });
});
