import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `GET /api/fueling/feed-freshness`, called (FUEL-T5 / A7).
 *
 * Transactions and Rejections render EFS's own rows verbatim, so the only way either page can be
 * wrong is by being INCOMPLETE — and a poller that stopped looks exactly like a quiet week. What is
 * only testable HERE, rather than in the pure function next door, is the three things a route decides:
 * who may ask, whose data it answers with, and what it refuses to say.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  EFS_SOAP_POSTED_POLL_MINUTES: "15",
  EFS_SOAP_REJECTED_POLL_MINUTES: "5",
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
  // The bearer token IS the role, so one server serves every gate case below.
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

let rec: SupabaseRecorder;
/**
 * ⚠ A FUNCTION fixture for the fills. `supabaseRecorder` records filters and does not apply them, so a
 * flat array answers a 90-day question with every row it holds — and the gap rule's whole correctness
 * is which days the window contained.
 */
async function ask(
  role: string,
  row: Record<string, string | null> | null,
  fills: { business_date: string }[] = [],
  query = "",
) {
  rec = createSupabaseRecorder({
    tables: {
      efs_soap_credentials: row ? [row] : [],
      fuel_transactions: (q) => {
        const at = (m: "gte" | "lte") =>
          q.ops.find((o) => o.method === m && o.args[0] === "business_date")?.args[1] as string | undefined;
        const lo = at("gte");
        const hi = at("lte");
        return fills.filter(
          (f) => (lo === undefined || f.business_date >= lo) && (hi === undefined || f.business_date <= hi),
        );
      },
    },
  });
  holder.client = rec.client;
  const res = await fetch(`${baseUrl}/api/fueling/feed-freshness${query}`, {
    headers: { Authorization: `Bearer ${role}` },
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, { lead: string; late: boolean; failing: boolean; neverCollected: boolean; lastSuccessAt: string | null }> &
      { gaps: { lead: string | null; gaps: { from: string; to: string; days: number }[] } },
  };
}

/** `n` fills on `day`, as the route counts them. */
const on = (day: string, n: number) => Array.from({ length: n }, () => ({ business_date: day }));

const HEALTHY = {
  posted_last_success_at: minsAgo(4), posted_last_polled_at: minsAgo(4), posted_last_error: null,
  rejected_last_success_at: minsAgo(2), rejected_last_polled_at: minsAgo(2), rejected_last_error: null,
};

describe("GET /api/fueling/feed-freshness", () => {
  it("answers a fuel reader — the person looking at a short list is who needs to know why it is short", async () => {
    const { status, body } = await ask("accountant", HEALTHY);
    expect(status).toBe(200);
    expect(body.posted!.lead).toContain("Completed fuel purchases");
    expect(body.rejected!.lead).toContain("Declined card attempts");
  });

  it("refuses a driver, who is the subject of this data rather than its reader", async () => {
    expect((await ask("driver", HEALTHY)).status).toBe(403);
  });

  it("scopes the read to the caller's org — the service role bypasses RLS", async () => {
    await ask("admin", HEALTHY);
    expectOrgScoped(rec, ORG);
  });

  // ⚠ The plan named `*_last_polled_at`. `recordFeedFailure` stamps that column on failure too, so a
  // feed refused for two days carries a poll stamp from a minute ago — and a line built on it would
  // say "arrived 1 minute ago" while nothing had arrived at all.
  it("reports a refused feed as refused, not as freshly polled", async () => {
    const { body } = await ask("admin", {
      ...HEALTHY,
      posted_last_success_at: minsAgo(60 * 48),
      posted_last_polled_at: minsAgo(1),
      posted_last_error: "SOAP fault: invalid credentials for user acme_svc",
    });
    expect(body.posted!.failing).toBe(true);
    expect(body.posted!.lead).toContain("refusing this feed");
    expect(body.posted!.lead).not.toContain("1 minute ago");
  });

  // The error text can name a username or a certificate subject. A fuel reader can act on "it is
  // refused"; they can do nothing with the credential that failed, and it must not cross the boundary.
  // Two halves, because the string check alone cannot fail: `FeedFreshness` has no error field, so
  // widening what the handler PASSES IN changes nothing observable. The shape assertion is what makes
  // a future field carrying vendor text fail here rather than in production.
  it("never leaks the vendor error text, the endpoint, or a cursor", async () => {
    const { body } = await ask("accountant", {
      ...HEALTHY,
      posted_last_error: "SOAP fault: invalid credentials for user acme_svc",
    });
    const json = JSON.stringify(body);
    for (const secret of ["acme_svc", "SOAP fault", "endpoint", "cursor"]) {
      expect(json).not.toContain(secret);
    }
    // The response carries exactly these keys per feed, and none of them is free text from EFS.
    expect(Object.keys(body.posted!).sort()).toEqual([
      "ageMinutes", "cadenceMinutes", "failing", "feed", "lastSuccessAt",
      "late", "lead", "needsAttention", "neverCollected",
    ]);
  });

  // Asserted as an ALLOW-LIST, not a deny-list. A deny-list passes for `select("*")` — the string "*"
  // contains none of the forbidden names while fetching every one of them — which is exactly how this
  // assertion first proved nothing.
  it("selects only the six freshness columns, never the credentials beside them", async () => {
    await ask("admin", HEALTHY);
    const q = rec.queries.find((x) => x.table === "efs_soap_credentials")!;
    const cols = String(q.ops.find((o) => o.method === "select")!.args[0])
      .split(",").map((c) => c.trim()).filter(Boolean).sort();
    expect(cols).toEqual([
      "posted_last_error", "posted_last_polled_at", "posted_last_success_at",
      "rejected_last_error", "rejected_last_polled_at", "rejected_last_success_at",
    ]);
  });

  it("says a feed has never been collected rather than pretending it is merely late", async () => {
    const { body } = await ask("admin", null); // no credentials row at all
    expect(body.posted!.neverCollected).toBe(true);
    expect(body.posted!.late).toBe(false);
    expect(body.posted!.lead).toContain("never been collected");
  });

  it("uses each feed's own configured cadence, not one number for both", async () => {
    // 40 minutes: inside 3 x 15 for posted, past 3 x 5 for rejected.
    const { body } = await ask("admin", {
      posted_last_success_at: minsAgo(40), posted_last_polled_at: minsAgo(1), posted_last_error: null,
      rejected_last_success_at: minsAgo(40), rejected_last_polled_at: minsAgo(1), rejected_last_error: null,
    });
    expect(body.posted!.late).toBe(false);
    expect(body.rejected!.late).toBe(true);
  });
});


/**
 * The hole in the middle (2026-09-05).
 *
 * Freshness catches a poller that has stopped. It cannot catch one that stopped and started again, and
 * production carried **17 consecutive days with no fill at all** — 2026-04-18 to 2026-05-04, roughly
 * 119,000 gallons — while every one of the assertions above stayed green for four months. What is only
 * testable HERE is that the route asks for the right window, on the right column, for the right org.
 */
describe("GET /api/fueling/feed-freshness — the hole in the middle", () => {
  const WITH_HOLE = [
    ...on("2026-04-01", 3), ...on("2026-04-02", 3),
    // 04-03 and 04-04 delivered nothing at all
    ...on("2026-04-05", 3), ...on("2026-04-06", 3),
  ];

  it("reports a gap with data on both sides of it", async () => {
    const { body } = await ask("accountant", HEALTHY, WITH_HOLE, "?from=2026-04-01&to=2026-04-06");
    expect(body.gaps.gaps).toHaveLength(1);
    expect(body.gaps.gaps[0]).toMatchObject({ from: "2026-04-03", to: "2026-04-04", days: 2 });
    expect(body.gaps.lead).toMatch(/No fuel arrived at all for 2 days/);
  });

  it("says nothing when the record has no holes — silence is the pass", async () => {
    const { body } = await ask("accountant", HEALTHY, [...on("2026-04-01", 3), ...on("2026-04-02", 3)], "?from=2026-04-01&to=2026-04-02");
    expect(body.gaps.gaps).toEqual([]);
    expect(body.gaps.lead).toBeNull();
  });

  it("counts the STATION's day, not the instant", async () => {
    // T1's column (0287). A window of instants asks a different question than the pages this line
    // appears on, and the two would disagree about the same evening fill.
    await ask("admin", HEALTHY, WITH_HOLE, "?from=2026-04-01&to=2026-04-06");
    const q = rec.forTable("fuel_transactions")[0]!;
    expect(q.ops.some((o) => o.method === "gte" && o.args[0] === "business_date")).toBe(true);
    expect(q.ops.some((o) => o.args[0] === "fueled_at")).toBe(false);
  });

  it("scopes the fill count to the caller's org, like everything else the service role reads", async () => {
    await ask("admin", HEALTHY, WITH_HOLE, "?from=2026-04-01&to=2026-04-06");
    expectOrgScoped(rec, ORG);
  });

  it("clamps an absurd window instead of refusing, because a sentence rides on four pages", async () => {
    // A 400 here would take the freshness line off every fuel page because somebody pasted five years
    // into the address bar.
    const { status } = await ask("admin", HEALTHY, WITH_HOLE, "?from=2019-01-01&to=2026-04-06");
    expect(status).toBe(200);
    const lo = rec.forTable("fuel_transactions")[0]!.ops.find((o) => o.method === "gte")!.args[1] as string;
    expect(lo >= "2025-01-01").toBe(true); // 400 days back from `to`, not 2019
  });
});
