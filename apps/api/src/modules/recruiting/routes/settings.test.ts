import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Settings → Recruiting's link lifetime and reminder, through the mount (Q-AW41, S2). The read and the
 * write are pinned in `recruitingSettings.test.ts`; what only this can see is the section gate, the
 * contract's refusals as 400s, and the audit's from/to.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = {
  admin: ctx("admin"), recruiter: ctx("recruiter"), auditor: ctx("auditor"), dispatcher: ctx("dispatcher"),
};

let server: Server;
let baseUrl: string;

const send = (method: string, token: string, body?: unknown) =>
  fetch(`${baseUrl}/api/recruitment/settings`, {
    method,
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const seed = (row: Record<string, unknown> | null = null): SupabaseRecorder => {
  let held = row;
  return createSupabaseRecorder({
    tables: {
      recruiting_settings: (q: RecordedQuery) => {
        if (!q.write) return held ? [held] : [];
        held = { ...(held ?? {}), ...(q.write.payload as Record<string, unknown>), updated_at: "2026-09-28T12:00:00Z" };
        return [held];
      },
      audit_logs: [],
    },
  });
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

const body = { invite_ttl_days: 7, reminders_enabled: true, reminder_after_hours: 72 };

describe("reading", () => {
  it("answers the defaults to anybody who can view recruiting, and nobody else", async () => {
    holder.client = seed().client;
    const res = await send("GET", "auditor");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      settings: { invite_ttl_days: 14, reminders_enabled: true, reminder_after_hours: 48 },
      isDefault: true,
      updatedAt: null,
    });
    expect((await send("GET", "dispatcher")).status).toBe(403);
  });
});

describe("saving", () => {
  it("saves the whole set for a caller who manages recruiting, and audits from and to", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await send("PUT", "admin", body);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ settings: body, isDefault: false });
    const [audit] = rec.writtenRows("audit_logs");
    expect(audit).toMatchObject({
      action: "recruitment.settings_updated",
      entity: "recruiting_settings",
      meta: { from: { invite_ttl_days: 14, reminders_enabled: true, reminder_after_hours: 48 }, to: body },
    });
    expectOrgScoped(rec, ORG);
  });

  it("refuses a caller who can only view recruiting", async () => {
    const rec = seed();
    holder.client = rec.client;
    expect((await send("PUT", "auditor", body)).status).toBe(403);
    expect(rec.writtenRows("recruiting_settings")).toHaveLength(0);
  });

  it("refuses, with nothing written, a reminder that would come after the link dies", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await send("PUT", "admin", { invite_ttl_days: 2, reminders_enabled: true, reminder_after_hours: 48 });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("before the link expires");
    expect(rec.writtenRows("recruiting_settings")).toHaveLength(0);
  });

  it("refuses a partial set — the three answers travel together", async () => {
    const rec = seed();
    holder.client = rec.client;
    expect((await send("PUT", "admin", { invite_ttl_days: 7 })).status).toBe(400);
    expect(rec.writtenRows("recruiting_settings")).toHaveLength(0);
  });

  it("refuses a link longer than the invite route's own ceiling", async () => {
    holder.client = seed().client;
    expect((await send("PUT", "admin", { ...body, invite_ttl_days: 61 })).status).toBe(400);
  });
});
