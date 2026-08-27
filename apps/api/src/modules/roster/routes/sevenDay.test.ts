import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The §395.8(j)(2) seven-day statement (migration 0236) — the DOOR gate and the window check.
 *
 * No test in this suite mocks Supabase (a house rule): a 200 here would mean asserting against a fake
 * DB, which proves nothing about the real one. What is pinned here is the boundary decided in
 * middleware, before any query runs.
 *
 * ⚠ The door is `rolesThatCanView("fleet")`; WRITING is `canWriteDriverLifecycle`, refused inside the
 * handler before the admin client is constructed. So a dispatcher reaches the handler and is turned
 * away there — asserted below, so the second gate never looks like dead code somebody deletes.
 *
 * The window check is testable here without a database because it runs on the BODY, before any query.
 * It is the one validation of this record that matters: the hours are summed against a window, so a
 * statement whose dates drifted produces a lawful-looking total that is not.
 */

let server: Server;
let baseUrl: string;
let errorLog: ReturnType<typeof vi.spyOn>;

const CTX: Record<string, AuthContext> = {
  admin: { userId: "u-admin", email: "a@silvicominc.com", orgId: "org-1", role: "admin" },
  fleet: { userId: "u-fm", email: "f@silvicominc.com", orgId: "org-1", role: "fleet_manager" },
  safety: { userId: "u-sm", email: "s@silvicominc.com", orgId: "org-1", role: "safety_manager" },
  dispatcher: { userId: "u-disp", email: "p@silvicominc.com", orgId: "org-1", role: "dispatcher" },
  auditor: { userId: "u-aud", email: "x@silvicominc.com", orgId: "org-1", role: "auditor" },
  recruiter: { userId: "u-rec", email: "r@silvicominc.com", orgId: "org-1", role: "recruiter" },
  driver: { userId: "u-drv", email: "d@silvicominc.com", orgId: "org-1", role: "driver" },
  pending: { userId: "u-new", email: "n@silvicominc.com", orgId: null, role: null },
};

beforeAll(async () => {
  // The "passes the gate" cases deliberately reach the handler, which then calls getSupabaseAdmin()
  // and throws "Supabase admin not configured" — there is no DB in the test env, and per the house
  // rule we do not mock one. That is the EXPECTED outcome (it proves the request got past the guards),
  // but the app's error middleware prints a stack for each, burying the real signal in `pnpm test`.
  // Silence just this suite's expected stderr; every assertion below is on the HTTP status, not the log.
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const ctx = CTX[t];
    if (!ctx) throw new Error("bad token");
    return ctx;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  errorLog.mockRestore();
  await closeTestServer(server);
});

const call = (path: string, init: RequestInit & { token?: string } = {}) => {
  const { token, ...rest } = init;
  return fetch(`${baseUrl}/api/roster/drivers${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
};

const DRIVER = "11111111-1111-4111-8111-111111111111";
const path = `/${DRIVER}/seven-day-statements`;

/** Seven consecutive days ending the day before the statement — what the regulation asks for. */
const days = (dates: string[]): Array<{ date: string; hours: number }> =>
  dates.map((date, i) => ({ date, hours: i < 5 ? 8 : 0 }));
const GOOD_DATES = [
  "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07",
];
const body = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    driver_id: DRIVER,
    statement_date: "2026-08-08",
    days: days(GOOD_DATES),
    last_relieved_at: "2026-08-07T18:30:00Z",
    signed_name: "Susan Godfrey",
    signed_on: "2026-08-08",
    ...over,
  });

describe("GET seven-day statements — read gate", () => {
  it("401 unauthenticated", async () => {
    expect((await call(path)).status).toBe(401);
  });

  it("403 for a driver", async () => {
    expect((await call(path, { token: "driver" })).status).toBe(403);
  });

  it.each(["admin", "fleet", "safety", "dispatcher", "auditor"])("passes the gate for %s", async (token) => {
    expect([401, 403]).not.toContain((await call(path, { token })).status);
  });
});

describe("POST a seven-day statement — write gate", () => {
  it("401 unauthenticated", async () => {
    expect((await call(path, { method: "POST", body: body() })).status).toBe(401);
  });

  /**
   * ⚠ Recording one is a fleet LIFECYCLE act — the same set 0213 allows to move a driver through
   * their employment status, because this record exists precisely because somebody is being put to
   * work. A dispatcher and an auditor may READ the roster and may not do this.
   */
  it.each(["dispatcher", "auditor"])("403 for %s, from inside the handler", async (token) => {
    expect((await call(path, { method: "POST", body: body(), token })).status).toBe(403);
  });

  it("403 for a recruiter — hiring paperwork is not recruitment's", async () => {
    expect((await call(path, { method: "POST", body: body(), token: "recruiter" })).status).toBe(403);
  });

  it.each(["admin", "fleet", "safety"])("passes both gates for %s", async (token) => {
    expect([401, 403]).not.toContain((await call(path, { method: "POST", body: body(), token })).status);
  });
});

/**
 * ⚠ The assertions that do not need a database, and are the ones worth having.
 *
 * Both run before any query, so they are decided entirely by the request — which is exactly the kind
 * of rule that regresses silently and exactly the kind this suite can prove.
 */
describe("what the handler refuses before touching the database", () => {
  it("refuses a statement whose seven days are not the seven before it", async () => {
    const drifted = ["2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08"];
    const res = await call(path, { method: "POST", body: body({ days: days(drifted) }), token: "admin" });
    expect(res.status).toBe(422);
    const payload = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(payload.error?.code).toBe("window_mismatch");
    // Says WHICH week it wanted, so the person fixing it does not have to count backwards.
    expect(payload.error?.message).toContain("2026-08-01");
  });

  it("refuses a payload naming a different driver from the path", async () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const res = await call(path, { method: "POST", body: body({ driver_id: other }), token: "admin" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe("driver_mismatch");
  });

  /**
   * ⚠ 400, not 422, and the difference is worth pinning rather than smoothing over: a six-day
   * statement is refused by `validateBody` against the shared contract — the request is malformed —
   * while the window mismatch above is a well-formed request that is wrong about the world. Two
   * different failures deserve two different codes, and a caller can tell "you sent the wrong shape"
   * from "you sent the wrong week".
   */
  it("refuses six days at the contract, before the window check is even reached", async () => {
    const res = await call(path, { method: "POST", body: body({ days: days(GOOD_DATES.slice(0, 6)) }), token: "admin" });
    expect(res.status).toBe(400);
  });
});
