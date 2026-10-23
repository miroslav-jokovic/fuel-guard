import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { AuthContext } from "@silvicom/shared";
import { createSupabaseRecorder, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { closeTestServer } from "../testing/httpServer.js";

/**
 * The entitlement gate's cache (Q-CHAT14). What it can get wrong: ask `org_module_enabled` on every
 * request again, share one org's answer with another, or keep a failed read and refuse (or admit) for
 * 15 s on the strength of a database blip.
 */
let rec: SupabaseRecorder;
let answer: unknown = true;
vi.mock("../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
const { requireModule } = await import("./requireModule.js");

beforeEach(() => {
  answer = true;
  rec = createSupabaseRecorder({ rpc: (fn) => (fn === "org_module_enabled" ? answer : null) });
});

async function statuses(orgs: string[]): Promise<number[]> {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "u-1", orgId: String(req.headers["x-org"]), role: "dispatcher" } as AuthContext;
    next();
  });
  app.get("/x", requireModule("messages"), (_req, res) => res.json({ ok: true }));
  app.use((_e: unknown, _req: Request, res: Response, _next: NextFunction) => res.status(500).end());
  const server = app.listen(0);
  try {
    const port = (server.address() as AddressInfo).port;
    const out: number[] = [];
    for (const org of orgs) out.push((await fetch(`http://127.0.0.1:${port}/x`, { headers: { "x-org": org } })).status);
    return out;
  } finally {
    await closeTestServer(server);
  }
}

const asked = () => rec.rpcs().filter((r) => r.fn === "org_module_enabled").map((r) => (r.args as { p_org: string }).p_org);

describe("requireModule", () => {
  it("asks once per org and module within the cache's life, and separately per org", async () => {
    expect(await statuses(["org-a", "org-a", "org-a", "org-b"])).toEqual([200, 200, 200, 200]);
    expect(asked()).toEqual(["org-a", "org-b"]);
  });

  it("refuses an org without the module, from the cache as well", async () => {
    answer = false;
    expect(await statuses(["org-a", "org-a"])).toEqual([403, 403]);
    expect(asked()).toEqual(["org-a"]);
  });

  it("never caches a failed read: it fails that request and asks again on the next", async () => {
    answer = { error: { message: "blip" } };
    expect(await statuses(["org-a"])).toEqual([500]);
    answer = true;
    expect(await statuses(["org-a"])).toEqual([200]);
    expect(asked()).toEqual(["org-a", "org-a"]);
  });
});
