import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * CCF2 (2026-10-28, plan B5): `GET /api/fuel-cards/settings` says whether the write check can run, from
 * the same two switches `/write-check` reads. Before it the page offered a check the server refused
 * in ~11 ms with 403 `probe_disabled`, because nothing told the page the switches were off.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ADMIN: AuthContext = { userId: "11111111-1111-4111-8111-111111111111", email: "a@x.test", orgId: ORG, role: "admin" };

const servers: Server[] = [];
afterAll(async () => {
  vi.restoreAllMocks();
  for (const s of servers) await closeTestServer(s);
});
beforeAll(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/** One server per switch setting: settings are read once at start, as on a real deploy. */
async function settingsWith(switches: Record<string, string>) {
  const { base } = await serverWith(switches);
  const rec = createSupabaseRecorder({
    tables: {
      efs_card_control_settings: { data: null, error: null },
      efs_card_control_approvers: { data: [], error: null },
      memberships: { data: [], error: null },
    },
  });
  holder.client = rec.client;
  const res = await fetch(`${base}/api/fuel-cards/settings`, { headers: { Authorization: "Bearer admin" } });
  expectOrgScoped(rec, ORG);
  return { status: res.status, body: (await res.json()) as { check?: unknown } };
}

async function serverWith(switches: Record<string, string>) {
  const env = loadEnv({
    NODE_ENV: "test", EFS_CARD_CONTROL_ENABLED: "true", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), ...switches,
  } as NodeJS.ProcessEnv);
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    if (token !== "admin") throw new Error("bad token");
    return ADMIN;
  };
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  servers.push(server);
  return { env, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/**
 * B6 (CCF2, 2026-10-28): the refusal said "Set EFS_CARD_CONTROL_PROBE_ENABLED=true on the staging API"
 * while the check is run on production, from settings that live in Parameter Store and load on a deploy.
 */
describe("the write check's refusal while it is switched off", () => {
  it("names both switches, Parameter Store and the deploy, and not the staging API", async () => {
    const { env, base } = await serverWith({});
    const { mintStepUpToken } = await import("../../../lib/stepUpToken.js");
    const res = await fetch(`${base}/api/fuel-cards/write-check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer admin",
        "x-step-up-token": mintStepUpToken(env, ADMIN.userId, ORG)!.token,
      },
      body: JSON.stringify({ cardNumber: "70830000000000000", confirm: "", readOnly: true }),
    });
    const text = JSON.stringify(await res.json());
    expect(res.status).toBe(403);
    expect(text).toContain("probe_disabled");
    expect(text).toContain("EFS_ALLOW_PRODUCTION_PROBE");
    expect(text).toContain("Parameter Store");
    expect(text).toContain("next deploy");
    expect(text).not.toContain("staging API");
  });
});

describe("the settings page is told whether the write check can run", () => {
  it("says it cannot, with the refusal's own code, while the switches are off — their normal state", async () => {
    const { status, body } = await settingsWith({});
    expect(status).toBe(200);
    expect(body.check).toEqual({ available: false, reason: "probe_disabled" });
  });

  it("says it cannot when only the probe switch is on, because production also needs the second", async () => {
    const { body } = await settingsWith({ EFS_CARD_CONTROL_PROBE_ENABLED: "true" });
    expect(body.check).toEqual({ available: false, reason: "probe_disabled" });
  });

  it("says it can once both switches are on for the run", async () => {
    const { body } = await settingsWith({ EFS_CARD_CONTROL_PROBE_ENABLED: "true", EFS_ALLOW_PRODUCTION_PROBE: "true" });
    expect(body.check).toEqual({ available: true, reason: null });
  });
});
