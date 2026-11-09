import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../app.js";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../testing/httpServer.js";

/**
 * `/api/me` serves the caller's named permissions (§15.1) so a screen hides what
 * `requireNamedPermission` refuses — read from the org's switches per request, from the same resolver
 * the gate asks, and CLOSED when the switches cannot be read (the admin keeps everything).
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CLOSE = "recruitment.close_application";
const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = {
  admin: ctx("admin"),
  safety: ctx("safety_manager"),
  recruiter: ctx("recruiter"),
};

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const me = async (token: string) => {
  const res = await fetch(`${baseUrl}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { permissions: Record<string, boolean> }).permissions;
};

const seed = (permissions: unknown) => {
  rec = createSupabaseRecorder({ tables: { org_role_permissions: permissions as never } });
  holder.client = rec.client;
};

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = CTX[t];
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => closeTestServer(server));

describe("/api/me's named permissions", () => {
  it("serves the shipped answer when the carrier has switched nothing", async () => {
    seed([]);
    expect((await me("safety"))[CLOSE]).toBe(true);
    expect((await me("recruiter"))[CLOSE]).toBe(false);
  });

  it("serves the carrier's switch, read from its own org", async () => {
    seed([{ role: "recruiter", permission: CLOSE, allowed: true }]);
    expect((await me("recruiter"))[CLOSE]).toBe(true);
    // Only this test's table: `user_profiles` (the display name, 0301) is keyed by the user, not the org.
    expectOrgScoped(rec, ORG, { exempt: ["user_profiles"] });
  });

  it("answers closed when the switches cannot be read — the admin keeps everything", async () => {
    seed({ data: null, error: { message: "boom" } });
    expect((await me("safety"))[CLOSE]).toBe(false);
    expect((await me("admin"))[CLOSE]).toBe(true);
  });
});
