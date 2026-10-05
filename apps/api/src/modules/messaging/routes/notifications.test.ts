import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
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
 * The bell's read state (0430). Three defects this pins, each measured in production on 2026-10-05:
 * mark-all picked 500 unordered ids and skipped the newest; the inbox read took EVERY read row the
 * user had (PostgREST stops at 1,000); and nothing could clear the list.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "u-fuel-manager";
const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as NodeJS.ProcessEnv);
const ME: AuthContext = { userId: USER, email: "fuel@example.test", orgId: ORG, role: "admin" };

const EVENT = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  category: "card_status_changed",
  title: `Fuel card ••••${n} is now Hold`,
  body: null,
  severity: "warning",
  entity_type: "efs_card",
  entity_id: null,
  deep_link: null,
  created_at: "2026-10-05T16:00:00Z",
});
const EVENTS = [EVENT(1), EVENT(2), EVENT(3)];

let server: Server;
let baseUrl = "";
let reads: Array<{ event_id: string; read_at: string; dismissed_at: string | null }> = [];
let rpc: Record<string, unknown> = {};

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (): Promise<AuthContext> => ME;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

beforeEach(() => {
  reads = [];
  rpc = { org_module_enabled: true, mark_notifications_read: 3, dismiss_notifications: 3 };
  holder.rec = createSupabaseRecorder({
    tables: {
      notification_events: EVENTS,
      // Answer only for the ids the query asked about — a read that forgets `.in("event_id", …)`
      // gets nothing back, so the test sees the difference.
      notification_reads: (q: RecordedQuery) => {
        const asked = q.filters().find((f) => f.col === "event_id")?.val as string[] | undefined;
        return asked ? reads.filter((r) => asked.includes(r.event_id)) : [];
      },
      notification_preferences: [],
    },
    rpc: (fn) => rpc[fn],
  });
});

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/me/notifications${path}`, {
    ...init,
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
  });

describe("GET /api/me/notifications", () => {
  it("reads read state for the listed events only, never the user's whole history", async () => {
    reads = [{ event_id: EVENT(2).id, read_at: "2026-10-05T16:05:00Z", dismissed_at: null }];
    const res = await call("");
    const body = (await res.json()) as { notifications: Array<{ id: string; read_at: string | null }>; unread: number };

    expect(res.status).toBe(200);
    const readQuery = holder.rec!.forTable("notification_reads")[0]!;
    expect(readQuery.filters()).toEqual(
      expect.arrayContaining([
        { col: "user_id", val: USER },
        { col: "event_id", val: EVENTS.map((e) => e.id) },
      ]),
    );
    expect(body.notifications.map((n) => n.read_at)).toEqual([null, "2026-10-05T16:05:00Z", null]);
    expect(body.unread).toBe(2);
    // notification_reads/preferences have no org_id: they are keyed by the caller's own user id.
    expectOrgScoped(holder.rec!, ORG, { exempt: ["notification_reads", "notification_preferences"] });
  });

  it("leaves a cleared notification out of the list and the count", async () => {
    reads = [
      { event_id: EVENT(1).id, read_at: "2026-10-05T16:05:00Z", dismissed_at: "2026-10-05T16:05:00Z" },
      { event_id: EVENT(3).id, read_at: "2026-10-05T16:05:00Z", dismissed_at: "2026-10-05T16:05:00Z" },
    ];
    const body = (await (await call("")).json()) as { notifications: Array<{ id: string }>; unread: number };

    expect(body.notifications.map((n) => n.id)).toEqual([EVENT(2).id]);
    expect(body.unread).toBe(1);
  });
});

describe("POST /api/me/notifications/read", () => {
  it("mark all is one database call scoped to the caller's org and login, with no row cap", async () => {
    const res = await call("/read", { method: "POST", body: "{}" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, marked: 3 });
    expect(holder.rec!.rpcs()).toContainEqual({ fn: "mark_notifications_read", args: { p_org: ORG, p_user: USER } });
    expect(holder.rec!.forTable("notification_events")).toHaveLength(0);
    expect(holder.rec!.writes()).toHaveLength(0);
  });

  it("a failed mark-all says so instead of answering ok", async () => {
    rpc.mark_notifications_read = { error: { message: "boom" } };
    const res = await call("/read", { method: "POST", body: "{}" });
    expect(res.status).toBe(500);
  });

  it("marking one notification still writes that one read row", async () => {
    const res = await call("/read", { method: "POST", body: JSON.stringify({ ids: [EVENT(1).id] }) });

    expect(res.status).toBe(200);
    expect(holder.rec!.writtenRows("notification_reads")).toEqual([{ event_id: EVENT(1).id, user_id: USER }]);
    expect(holder.rec!.rpcs().map((r) => r.fn)).not.toContain("mark_notifications_read");
  });
});

describe("POST /api/me/notifications/dismiss", () => {
  it("clears the caller's bell by stamping, and deletes nothing", async () => {
    const res = await call("/dismiss", { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, dismissed: 3 });
    expect(holder.rec!.rpcs()).toContainEqual({ fn: "dismiss_notifications", args: { p_org: ORG, p_user: USER } });
    expect(holder.rec!.writes()).toHaveLength(0);
  });

  it("a failed clear says so", async () => {
    rpc.dismiss_notifications = { error: { message: "boom" } };
    expect((await call("/dismiss", { method: "POST" })).status).toBe(500);
  });

  it("is refused when the notifications module is off for the org", async () => {
    rpc.org_module_enabled = false;
    expect((await call("/dismiss", { method: "POST" })).status).toBe(403);
    expect(holder.rec!.rpcs().map((r) => r.fn)).not.toContain("dismiss_notifications");
  });
});
