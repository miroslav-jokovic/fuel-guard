import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext, SamsaraFeedPulse } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import {
  createSupabaseRecorder,
  expectOrgScoped,
  type RecordedQuery,
  type SupabaseRecorder,
} from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `GET /api/integrations/samsara/feed-pulse` — the narrow read the page strips use (SAM-S5 bullet 3).
 *
 * Q-SAM7 is answered (a), and the answer lives half in the gate and half in the payload, so both
 * halves are only testable here. Its neighbour `/samsara/feed-freshness` refuses everyone below
 * `settings: view`; this one must answer the audience of the pages it annotates — `/`, `/coverage`,
 * `/idling`, `/odometer`, `/ifta` and `/driver-performance` are all `requiresAuth` with no section
 * gate — while withholding the one field that made widening the neighbour unacceptable.
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

const minsAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

let server: Server;
let baseUrl = "";

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

interface JobFixture {
  kind: string;
  status: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  stats?: Record<string, unknown> | null;
}

/** Every tier delivered five minutes ago, so a test only has to state the one feed it is about. */
const HEALTHY: JobFixture[] = [
  "sync_stats", "sync_vehicles", "sync_driver_scores", "sync_ifta", "sync_odometer", "sync_hos", "sync_idle",
].map((kind) => ({ kind, status: "done", error: null, created_at: minsAgo(5), finished_at: minsAgo(5), stats: null }));

let rec: SupabaseRecorder;

/**
 * ⚠ A FUNCTION fixture, and it has to be one. `readJobStamps` asks the SAME table twice per feed —
 * once for the latest run of any status, once for the latest delivering run — and `supabaseRecorder`
 * records filters without applying them. A flat array answers both questions with every job row in
 * the fixture, which makes a refused feed indistinguishable from a healthy one and every assertion
 * below vacuous. It honours `kind`, `status` and the skipped-run exclusion for exactly that reason.
 */
async function ask(role: string, jobs: JobFixture[] = HEALTHY, opts: { jobsError?: unknown } = {}) {
  rec = createSupabaseRecorder({
    tables: {
      jobs: (q: RecordedQuery) => {
        if (opts.jobsError) return { data: null, error: opts.jobsError };
        const eq = (col: string) =>
          q.ops.find((o) => o.method === "eq" && o.args[0] === col)?.args[1] as string | undefined;
        const kind = eq("kind");
        const status = eq("status");
        // `.filter("stats->>skipped", "is", "null")` — a `done` run that skipped for want of a token
        // delivered nothing, and the service excludes it from the success stamp.
        const excludesSkipped = q.ops.some((o) => o.method === "filter" && o.args[0] === "stats->>skipped");
        return jobs
          .filter((j) => (kind === undefined || j.kind === kind) && (status === undefined || j.status === status))
          .filter((j) => !excludesSkipped || j.stats?.skipped == null)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      },
      // The per-fill tier is measured by its own stamp on the fills, not by a job row.
      fuel_transactions: [{ samsara_recon_checked_at: minsAgo(5) }],
    },
  });
  holder.client = rec.client;
  const res = await fetch(`${baseUrl}/api/integrations/samsara/feed-pulse`, {
    headers: { Authorization: `Bearer ${role}` },
  });
  return { status: res.status, body: (await res.json()) as { feeds: SamsaraFeedPulse[] } };
}

const feed = (body: { feeds: SamsaraFeedPulse[] }, id: string) => body.feeds.find((f) => f.id === id)!;

/** IFTA refused, with a vendor sentence of the shape that decided Q-SAM7 — it names an account. */
const IFTA_REFUSED: JobFixture[] = [
  ...HEALTHY.filter((j) => j.kind !== "sync_ifta"),
  {
    kind: "sync_ifta",
    status: "failed",
    error: "403 Forbidden for org 8f21c4de-group=91827: token lacks ifta:read",
    created_at: minsAgo(10),
    finished_at: minsAgo(10),
    stats: null,
  },
];

describe("GET /api/integrations/samsara/feed-pulse", () => {
  it("answers a driver — the pages this annotates are open to every member, and so is this", async () => {
    // The whole point of the second route. `/samsara/feed-freshness` next door 403s this caller, and
    // a strip that 403s on the Dashboard would put the freshness of the fleet's data behind a
    // permission the Dashboard itself does not ask for.
    const { status, body } = await ask("driver");
    expect(status).toBe(200);
    expect(body.feeds).toHaveLength(8);
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await fetch(`${baseUrl}/api/integrations/samsara/feed-pulse`);
    expect(res.status).toBe(401);
  });

  it("scopes every read to the caller's org — the service role bypasses RLS", async () => {
    await ask("admin");
    expectOrgScoped(rec, ORG);
  });

  it("never leaks the vendor's own sentence, to any role", async () => {
    const { body } = await ask("driver", IFTA_REFUSED);
    const json = JSON.stringify(body);
    for (const secret of ["8f21c4de", "group=91827", "token lacks", "403"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("still tells that reader the feed is refused — it loses the cause, not the fact", async () => {
    const { body } = await ask("driver", IFTA_REFUSED);
    const ifta = feed(body, "ifta");
    expect(ifta.state).toBe("failing");
    expect(ifta.needsAttention).toBe(true);
    expect(ifta.lead).toContain("refused by Samsara");
  });

  it("carries exactly the eight fields the projection declares", async () => {
    // The shape is the assertion, not the absence of one name: a handler that spread the gated
    // record and deleted `lastError` would pass a deny-list and leak whatever is added next.
    const { body } = await ask("admin", IFTA_REFUSED);
    for (const f of body.feeds) {
      expect(Object.keys(f).sort()).toEqual([
        "ageMinutes", "id", "label", "lead", "needsAttention", "state", "targetMinutes", "targetSource",
      ]);
    }
  });

  it("puts the worst feed first, so a strip can read the top of the list", async () => {
    const { body } = await ask("admin", IFTA_REFUSED);
    expect(body.feeds[0]!.id).toBe("ifta");
  });

  // ⚠ The two assertions below are what make the fixture's `status` and skipped-run handling
  // load-bearing. Without them the fixture could ignore both and every other test still passed —
  // measured by mutating the fixture itself, which is the failure mode this repo keeps meeting.
  it("dates a refused feed by the last delivery, not by the failure that came after it", async () => {
    const { body } = await ask("driver", [
      ...HEALTHY.filter((j) => j.kind !== "sync_ifta"),
      // Delivered three days ago; the run ten minutes ago failed. A stamp that moved on failure —
      // the `*_last_polled_at` trap the EFS freshness line was written against — would report this
      // feed as ten minutes old while nothing had arrived for three days.
      { kind: "sync_ifta", status: "done", error: null, created_at: minsAgo(3 * 24 * 60), finished_at: minsAgo(3 * 24 * 60), stats: null },
      { kind: "sync_ifta", status: "failed", error: "429 Too Many Requests", created_at: minsAgo(10), finished_at: minsAgo(10), stats: null },
    ]);
    const ifta = feed(body, "ifta");
    expect(ifta.state).toBe("failing");
    expect(ifta.ageMinutes).toBeGreaterThan(4_000); // ~3 days, not ~10 minutes
    expect(ifta.lead).toContain("3 days ago");
  });

  it("does not report an org with no Samsara token as freshly delivered", async () => {
    // `runOrgTier` records a token-less run as `done` with `stats.skipped` — deliberately, an
    // unconfigured org is not a failure. Counting it as a delivery would show every feed green
    // forever for exactly the carrier that is collecting nothing.
    const { body } = await ask("admin", [
      { kind: "sync_odometer", status: "done", error: null, created_at: minsAgo(5), finished_at: minsAgo(5), stats: { skipped: "no token" } },
    ]);
    const odo = feed(body, "odometer");
    expect(odo.state).not.toBe("fresh");
    expect(odo.ageMinutes).toBeNull();
    expect(odo.lead).toContain("nothing has arrived");
  });

  it("says nothing rather than erroring when the ledger cannot be read", async () => {
    // A strip only annotates the figures below it. Turning a caveat into a 500 on six pages because
    // a diagnostic read failed is the trade this route refuses; the settings card still reports it.
    const { status, body } = await ask("admin", HEALTHY, { jobsError: { message: "connection reset" } });
    expect(status).toBe(200);
    expect(body.feeds).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("connection reset");
  });
});
