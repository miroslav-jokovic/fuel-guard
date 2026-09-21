import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext, DashboardSummary } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { __resetIdleCostBasisCache } from "../../idle/index.js";

/**
 * `GET /api/dashboard` — the door half of queue item 5 step 3.
 *
 * The assembly is proved in `dashboardSummary.test.ts`. What is only testable here is who is
 * answered and what an unusable window gets: the Dashboard is `gate: ALWAYS`, so EVERY signed-in
 * role must be answered — a section gate here would refuse the page its own tiles (the ruling
 * recorded for this mount in `routeLedger.ts`) — and a window that is not two calendar days must be
 * refused rather than coerced, because coercing it is how the viewer's timezone got into the
 * figures in the first place (D-PREC5).
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as NodeJS.ProcessEnv);

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const who = (role: string): AuthContext =>
  ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role: role as AuthContext["role"] });

let server: Server;
let baseUrl = "";
let rec: SupabaseRecorder;

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => who(token);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeTestServer(server);
});

beforeEach(() => {
  __resetIdleCostBasisCache();
});

async function ask(role: string, query = "from=2026-09-01&to=2026-09-03") {
  rec = createSupabaseRecorder({
    tables: {
      declined_transactions: { count: 2 },
      idle_settings: [{ idle_gal_per_hour: "0.80", fuel_price_per_gal: "4.000" }],
      fuel_prices: [],
    },
    rpc: {
      dashboard_summary: [
        {
          total_spend: "400.00",
          total_gallons: "100",
          reefer_spend: "0",
          covered_txns: 2,
          total_txns: 2,
          spend_by_day: [{ date: "2026-09-01", value: 400 }],
          severity_counts: { high: 1 },
          top_vehicles: [],
          top_drivers: [],
          open_anomalies: 1,
          idle_sec: "0",
        },
      ],
      telematics_coverage_buckets: [],
    },
  });
  holder.client = rec.client;
  const res = await fetch(`${baseUrl}/api/dashboard?${query}`, { headers: { Authorization: `Bearer ${role}` } });
  return { status: res.status, body: (await res.json()) as { ok: boolean; data: DashboardSummary; error?: { code: string } } };
}

describe("GET /api/dashboard", () => {
  it("answers the summary the page binds to", async () => {
    const { status, body } = await ask("admin");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.totalSpend).toBe(400);
    expect(body.data.openAnomalies).toBe(1);
    expect(body.data.anomaliesBySeverity).toEqual({ low: 0, medium: 0, high: 1, critical: 0 });
    expect(body.data.declinedCount).toBe(2);
  });

  // `gate: ALWAYS` in surfaceCatalogue: the Dashboard is where every role lands after signing in,
  // including a driver on the web. Refusing any of them here would break the page for them without
  // closing anything — the rows are readable under 0004's RLS today (see routeLedger.ts).
  it("answers every signed-in role, because the surface refuses none of them", async () => {
    for (const role of ["admin", "fleet_manager", "dispatcher", "safety_manager", "accountant", "auditor", "driver"]) {
      expect((await ask(role)).status, role).toBe(200);
    }
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await fetch(`${baseUrl}/api/dashboard?from=2026-09-01&to=2026-09-03`);
    expect(res.status).toBe(401);
  });

  it("refuses a window that is not two calendar days, rather than coercing one", async () => {
    for (const q of ["", "from=2026-09-01", "from=2026-09-01T00:00:00Z&to=2026-09-03", "from=yesterday&to=today"]) {
      const { status, body } = await ask("admin", q);
      expect(status, q).toBe(400);
      expect(body.error?.code, q).toBe("bad_request");
    }
  });

  it("refuses a backwards window", async () => {
    const { status } = await ask("admin", "from=2026-09-03&to=2026-09-01");
    expect(status).toBe(400);
  });

  it("writes no audit row for a read", async () => {
    await ask("admin");
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });
});
