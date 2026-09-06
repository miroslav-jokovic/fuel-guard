import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AuthContext, UserRole } from "@silvicom/shared";
import { USER_ROLES, rolesThatCanView, rolesThatManage } from "@silvicom/shared";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { closeTestServer } from "./testing/httpServer.js";

/**
 * Every fuel endpoint answers the same question the matrix does — per role, against the real app.
 *
 * ── WHY A BEHAVIOURAL TEST AS WELL AS THE SOURCE ONE ─────────────────────────────────────────────
 * `routeGates.test.ts` proves the FORM: the roles are read from `SECTION_ACCESS` and never written
 * down beside it. That is what stops the lists drifting back. It does not prove the CONSEQUENCE, and
 * the consequence is the whole reason FUEL-T2 exists — measured 2026-09-01, an `accountant` was
 * offered Exceptions by the nav, allowed onto the page by the router, and answered **403** by the
 * API, because `accountant` holds `fuel: "view"` in the matrix and the route's hand-written list did
 * not mention it. Three opinions about one question, and the test that would have caught it is this
 * one.
 *
 * ── WHY IT ASSERTS "NOT 403" RATHER THAN 200 ─────────────────────────────────────────────────────
 * The subject is the gate, not the handler. With no Supabase configured, an allowed request reaches
 * `getSupabaseAdmin` and throws immediately — a 500, no network, no DNS (this package stubs the
 * resolver; see `testing/setupOutboundDns.ts`). So the assertion is the one this file can honestly
 * make: a permitted role gets PAST the gate, a refused one does not. Asserting 200 would mean
 * standing up a database to prove a permission.
 */

const ORG = "11111111-1111-1111-1111-111111111111";

/** Every fuel endpoint A2 named, plus one write per module so "nobody gains a write" is proved. */
const ENDPOINTS: Array<{ method: string; path: string; access: "view" | "manage"; why: string }> = [
  { method: "GET", path: "/api/fueling/exceptions", access: "view", why: "the recovery ledger a controller reads" },
  { method: "GET", path: "/api/fueling/exceptions/totals", access: "view", why: "identified / claimed / recovered" },
  { method: "GET", path: "/api/fueling/spend-report.pdf?from=2026-08-01&to=2026-08-31", access: "view", why: "the document an accountant is the audience for" },
  { method: "GET", path: "/api/fueling/recon-runs", access: "view", why: "the reconciliations we hold" },
  { method: "PATCH", path: "/api/fueling/exceptions/00000000-0000-0000-0000-000000000000", access: "manage", why: "moving a finding is money, not reading" },
  { method: "POST", path: "/api/fueling/statements", access: "manage", why: "recording a statement" },
  { method: "POST", path: "/api/transactions/rebuild", access: "manage", why: "re-scoring the fleet" },
];

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  // The token IS the role — the pattern middleware/auth.test.ts uses.
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    if (!(USER_ROLES as readonly string[]).includes(t)) throw new Error("bad token");
    return { userId: `u-${t}`, email: `${t}@silvicominc.com`, orgId: ORG, role: t as UserRole };
  };
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

async function call(method: string, path: string, role: UserRole): Promise<number> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${role}`, "content-type": "application/json" },
    body: method === "GET" ? undefined : "{}",
  });
  return res.status;
}

describe("fuel-section endpoints agree with SECTION_ACCESS, per role", () => {
  for (const ep of ENDPOINTS) {
    const allowed = new Set<UserRole>(ep.access === "view" ? rolesThatCanView("fuel") : rolesThatManage("fuel"));
    for (const role of USER_ROLES) {
      const should = allowed.has(role) ? "reach" : "be refused by";
      it(`${role} ${should} ${ep.method} ${ep.path.split("?")[0]} — ${ep.why}`, async () => {
        const status = await call(ep.method, ep.path, role);
        if (allowed.has(role)) expect(status).not.toBe(403);
        else expect(status).toBe(403);
      });
    }
  }

  // The regression this whole step is named for, stated once as itself rather than only as a loop.
  it("an accountant and an auditor can read the ledger they were shown and then refused", async () => {
    expect(await call("GET", "/api/fueling/exceptions", "accountant")).not.toBe(403);
    expect(await call("GET", "/api/fueling/exceptions", "auditor")).not.toBe(403);
  });

  it("...and neither of them gains a write", async () => {
    expect(await call("PATCH", "/api/fueling/exceptions/00000000-0000-0000-0000-000000000000", "accountant")).toBe(403);
    expect(await call("PATCH", "/api/fueling/exceptions/00000000-0000-0000-0000-000000000000", "auditor")).toBe(403);
  });
});
