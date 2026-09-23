import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * L6 (0360) — the partition maintenance job's state on `GET /api/version`, and its fold into `ok`.
 * The job runs inside Postgres where no gate can see it; if it stops after L7, inserts run off the
 * end of the last partition. These cases pin that a non-healthy state turns `ok` false even when the
 * schema is current, and that the first hour's `pending` does not.
 */
const mocks = vi.hoisted(() => ({
  schema: vi.fn(),
  maintenance: vi.fn(),
}));
vi.mock("./schemaVersion.js", () => ({ getSchemaStatus: mocks.schema }));
vi.mock("./maintenanceHealth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./maintenanceHealth.js")>()),
  getMaintenanceHealth: mocks.maintenance,
}));

const { toMaintenanceHealth, maintenanceHealthy } = await import("./maintenanceHealth.js");
const { createApp } = await import("../app.js");
const { loadEnv } = await import("../env.js");
const { closeTestServer } = await import("../testing/httpServer.js");

const CURRENT = { expected: "0360", applied: "0360", state: "current", drift: false };
const health = (state: string) => ({ state, lastSucceededAt: null, partitionedTables: 0 });

describe("toMaintenanceHealth", () => {
  it("maps the function's jsonb onto the published shape", () => {
    expect(
      toMaintenanceHealth({ state: "ok", last_succeeded_at: "2026-09-23T00:07:01Z", partitioned_tables: 0 }),
    ).toEqual({ state: "ok", lastSucceededAt: "2026-09-23T00:07:01Z", partitionedTables: 0 });
  });

  it("keeps a null partitioned_tables null rather than a vacuous 0", () => {
    expect(toMaintenanceHealth({ state: "missing", partitioned_tables: null }).partitionedTables).toBeNull();
  });

  it("reads a numeric string as a number", () => {
    expect(toMaintenanceHealth({ state: "ok", partitioned_tables: "2" }).partitionedTables).toBe(2);
  });

  it("reports an unreadable or unrecognised reading as unknown", () => {
    expect(toMaintenanceHealth(null).state).toBe("unknown");
    expect(toMaintenanceHealth({ state: "fine" }).state).toBe("unknown");
  });
});

describe("maintenanceHealthy", () => {
  it("accepts ok and the first hour's pending, and nothing else", () => {
    const verdicts = ["ok", "pending", "stale", "failing", "inactive", "missing", "unknown"].map((s) => [
      s,
      maintenanceHealthy(s as never),
    ]);
    expect(Object.fromEntries(verdicts)).toEqual({
      ok: true,
      pending: true,
      stale: false,
      failing: false,
      inactive: false,
      missing: false,
      unknown: false,
    });
  });
});

describe("GET /api/version folds maintenance into ok", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp(loadEnv({ NODE_ENV: "test", VITE_API_URL: "https://api.example.test" } as NodeJS.ProcessEnv));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });
  afterAll(async () => closeTestServer(server));
  beforeEach(() => mocks.schema.mockResolvedValue(CURRENT));

  const read = async () => (await (await fetch(`${baseUrl}/api/version`)).json()) as {
    ok: boolean;
    maintenance: { state: string };
  };

  it("is ok when the schema is current and maintenance is ok", async () => {
    mocks.maintenance.mockResolvedValue(health("ok"));
    const body = await read();
    expect(body.ok).toBe(true);
    expect(body.maintenance.state).toBe("ok");
  });

  it("is ok during the first hour's pending", async () => {
    mocks.maintenance.mockResolvedValue(health("pending"));
    expect((await read()).ok).toBe(true);
  });

  it("is NOT ok when maintenance has gone stale, even with a current schema", async () => {
    mocks.maintenance.mockResolvedValue(health("stale"));
    expect((await read()).ok).toBe(false);
  });

  it("is NOT ok when the maintenance job is missing", async () => {
    mocks.maintenance.mockResolvedValue(health("missing"));
    expect((await read()).ok).toBe(false);
  });
});
