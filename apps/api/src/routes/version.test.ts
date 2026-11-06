import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "../env.js";
import { closeTestServer } from "../testing/httpServer.js";

/**
 * `/api/version`'s `ok` and `/ready`'s status move on step-up readiness ALONE (Q-AD41 (b), 2026-11-06). Every other
 * health input is held healthy here, because in `app.test.ts` the schema is unknown and `ok` is false whatever
 * `stepUp` says, so that file cannot show this.
 */
vi.mock("../lib/schemaVersion.js", () => ({ getSchemaStatus: async () => ({ expected: "0571", applied: "0571", state: "current", drift: false }) }));
vi.mock("../lib/maintenanceHealth.js", () => ({ getMaintenanceHealth: async () => ({ state: "ok" }), maintenanceHealthy: () => true }));
vi.mock("../lib/schedulerHealth.js", () => ({ getSchedulerHealth: async () => [{ lane: "general", state: "held" }], laneHealthy: () => true }));
vi.mock("../lib/releaseVersion.js", () => ({ getReleaseVersion: async () => null }));
vi.mock("../modules/org/index.js", () => ({ getStorageBackupHealth: async () => ({ state: "ok" }), storageBackupHealthy: () => true }));
vi.mock("../modules/messaging/index.js", () => ({ getRealtimeHealth: async () => ({ state: "ok" }), realtimeHealthy: () => true }));

const { versionRouter } = await import("./version.js");

const READY = { NODE_ENV: "test", SUPABASE_URL: "https://p.supabase.co", SUPABASE_ANON_KEY: "anon", SECRETS_ENCRYPTION_KEY: randomBytes(32).toString("base64") };

async function ask(source: Record<string, string>) {
  const app = express();
  app.locals.env = loadEnv(source as NodeJS.ProcessEnv);
  app.use("/api/version", versionRouter());
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/version`;
  try {
    const version = (await (await fetch(base)).json()) as { ok: boolean; stepUp: string };
    const ready = await fetch(`${base}/ready`);
    return { version, readyStatus: ready.status, readyBody: (await ready.json()) as { stepUp: string } };
  } finally {
    await closeTestServer(server);
  }
}

describe("GET /api/version — step-up readiness", () => {
  it("a deploy with every step-up setting is ok and ready", async () => {
    const r = await ask(READY);
    expect(r.version).toMatchObject({ ok: true, stepUp: "ready" });
    expect(r.readyStatus).toBe(200);
  });

  it("the same deploy without its anon key is not ok, names the setting, and /ready answers 503", async () => {
    const { SUPABASE_ANON_KEY: _dropped, ...rest } = READY;
    const r = await ask(rest);
    expect(r.version).toMatchObject({ ok: false, stepUp: "missing:SUPABASE_ANON_KEY" });
    expect(r.readyStatus).toBe(503);
    expect(r.readyBody.stepUp).toBe("missing:SUPABASE_ANON_KEY");
  });
});
