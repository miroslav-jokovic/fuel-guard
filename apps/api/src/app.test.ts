import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
  const app = createApp(env);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

type HealthBody = { status: string; service: string; env: string; schema: string; commit: string | null };

describe("GET /healthz", () => {
  // Always 200, even when the schema cannot be read: failing the healthcheck would make Railway roll
  // back a deploy that is merely waiting on a migration. `status` carries the nuance instead.
  it("stays 200 and names the service", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthBody;
    expect(body.service).toContain("FuelGuard");
    expect(body.env).toBe("test");
    expect(["ok", "degraded"]).toContain(body.status);
  });

  // No Supabase in the test env, so the migration ledger is unreadable. "I could not check" must
  // report as unknown/degraded — never as healthy (ship-pipeline D0.4).
  it("reports degraded when the schema version cannot be read", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    const body = (await res.json()) as HealthBody;
    expect(body.schema).toBe("unknown");
    expect(body.status).toBe("degraded");
  });
});

describe("GET /api/version", () => {
  it("is public and reports the expected schema version from this checkout", async () => {
    const res = await fetch(`${baseUrl}/api/version`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      commit: string | null;
      schema: { expected: string | null; applied: string | null; state: string; drift: boolean };
    };
    // Read from supabase/migrations on disk — a four-digit version, not a guess.
    expect(body.schema.expected).toMatch(/^\d{4}$/);
    expect(body.schema.state).toBe("unknown");
    expect(body.ok).toBe(false);
  });

  it("never leaks anything tenant-scoped", async () => {
    const res = await fetch(`${baseUrl}/api/version`);
    const keys = Object.keys((await res.json()) as Record<string, unknown>).sort();
    expect(keys).toEqual([
      "branch",
      "commit",
      "commitShort",
      "deploymentId",
      "env",
      "ok",
      "schema",
      "service",
      "startedAt",
    ]);
  });
});

describe("env validation", () => {
  it("rejects an invalid PORT", () => {
    expect(() => loadEnv({ PORT: "-1" } as unknown as NodeJS.ProcessEnv)).toThrow();
  });
});
