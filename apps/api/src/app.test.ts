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

describe("GET /healthz", () => {
  it("returns ok with the service name", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string; env: string };
    expect(body.status).toBe("ok");
    expect(body.service).toContain("FleetGuard");
    expect(body.env).toBe("test");
  });
});

describe("env validation", () => {
  it("rejects an invalid PORT", () => {
    expect(() => loadEnv({ PORT: "-1" } as unknown as NodeJS.ProcessEnv)).toThrow();
  });
});
