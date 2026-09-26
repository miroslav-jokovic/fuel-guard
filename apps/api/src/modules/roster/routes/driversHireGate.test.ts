import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The roster edit may not hire (APPLICATION-FLOW-V2-PLAN.md A-9). `drivers.test.ts` pins the role
 * gates with no database behind them, by its own rule; this is the one case that needs the row's
 * CURRENT status, so it runs against the recorder like the recruiting routes do.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const ADMIN: AuthContext = { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" } as AuthContext;

let server: Server;
let baseUrl: string;

const seed = (status: string) =>
  createSupabaseRecorder({
    tables: {
      drivers: [{ id: DRIVER, status, identity_source: "manual", termination_date: null, first_name: "A", middle_name: null, last_name: "B" }],
      audit_logs: [],
    },
  });

const patch = (body: unknown) =>
  fetch(`${baseUrl}/api/roster/drivers/${DRIVER}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", Authorization: "Bearer admin" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    if (t !== "admin") throw new Error("bad token");
    return ADMIN;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

describe("PATCH /api/roster/drivers/:id — an applicant is hired through Hire, never by an edit (A-9)", () => {
  it("answers 409 use_hire to applicant → active, even for an admin, and writes nothing", async () => {
    const rec = seed("applicant");
    holder.client = rec.client;
    const res = await patch({ status: "active" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("use_hire");
    expect(rec.writtenRows("drivers")).toHaveLength(0);
  });

  it("still lets an active driver's other edits through", async () => {
    const rec = seed("active");
    holder.client = rec.client;
    const res = await patch({ status: "active" });
    expect(res.status).not.toBe(409);
  });
});
