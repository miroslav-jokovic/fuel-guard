import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { memberDevicesResponseSchema, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Signed-in devices, remembered (INSTALLED-APP-PLAN IA-S6). What a device is, when it holds a place and what is
 * kept of it is 0620's, executed by `supabase/tests/member-devices.test.mjs`. These routes are held to what
 * reaches it and what leaves: the person and the company from the token (or a member of the token's company,
 * for an admin), the device named as a browser would name itself, the device in use marked, the owner's
 * numbers stated beside the list, and nothing for a caller who is not an admin asking about somebody else.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ME = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const STRANGER = "99999999-9999-4999-8999-999999999999";
const THIS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PC = "d0d0d0d0-0000-4000-8000-000000000001";
const OLD_PHONE = "d0d0d0d0-0000-4000-8000-000000000002";

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
let me: AuthContext;
let members: Record<string, string>;
let base = "";
let server: Server;

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (): Promise<AuthContext> => me;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

const ROWS = [
  {
    id: PC, user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36",
    first_seen_at: "2026-11-16T14:00:00+00:00", last_seen_at: "2026-11-16T15:00:00+00:00", session_id: THIS, signed_in: true,
    addresses: [{ ip: "203.0.113.7", first_seen_at: "2026-11-16T14:00:00+00:00", last_seen_at: "2026-11-16T15:00:00+00:00" }],
  },
  {
    id: OLD_PHONE, user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1",
    first_seen_at: "2026-11-02T09:00:00+00:00", last_seen_at: "2026-11-09T18:00:00+00:00", session_id: null, signed_in: false,
    addresses: [
      { ip: "198.51.100.24", first_seen_at: "2026-11-05T09:00:00+00:00", last_seen_at: "2026-11-09T18:00:00+00:00" },
      { ip: "192.0.2.10", first_seen_at: "2026-11-02T09:00:00+00:00", last_seen_at: "2026-11-04T09:00:00+00:00" },
    ],
  },
];

beforeEach(() => {
  me = { userId: ME, email: "ana@example.test", orgId: ORG, role: "dispatcher", sessionId: THIS };
  members = { [ME]: "dispatcher", [BEN]: "dispatcher" };
  holder.rec = createSupabaseRecorder({
    rpc: (fn) => (fn === "member_devices_list" ? ROWS : undefined),
    tables: {
      memberships: (q: { filters: () => Array<{ col: string; val: unknown }> }) => {
        const id = q.filters().find((f) => f.col === "user_id")?.val as string | undefined;
        return id && members[id] ? [{ role: members[id], suspended_at: null }] : [];
      },
    } as never,
  });
});

const call = (path: string) => fetch(`${base}${path}`, { headers: { Authorization: "Bearer token" } });
const asked = () => holder.rec!.rpcs().filter((c) => c.fn === "member_devices_list").map((c) => c.args as Record<string, unknown>);

describe("GET /api/me/devices — a person's own devices, remembered", () => {
  it("asks for the caller's own, in the caller's company, with the owner's idle window", async () => {
    const res = await call("/api/me/devices");
    expect(res.status).toBe(200);
    expect(asked()).toEqual([{ p_org: ORG, p_user: ME, p_idle_hours: 12 }]);
  });

  it("names each device as a browser would, marks the one in use, and keeps every address", async () => {
    const body = memberDevicesResponseSchema.parse(await (await call("/api/me/devices")).json());
    expect(body.devices.map((d) => [d.device, d.current, d.signed_in])).toEqual([
      ["Chrome on Windows", true, true],
      ["Safari on iPhone", false, false],
    ]);
    expect(body.devices[1]!.addresses.map((a) => a.ip)).toEqual(["198.51.100.24", "192.0.2.10"]);
    expect(body.devices[1]!.session_id).toBeNull();
  });

  it("states the owner's numbers beside the list: three places, twelve months", async () => {
    const body = memberDevicesResponseSchema.parse(await (await call("/api/me/devices")).json());
    expect([body.limit, body.history_days]).toEqual([3, 365]);
  });

  it("returns nothing of the raw user agent", async () => {
    expect(await (await call("/api/me/devices")).text()).not.toContain("AppleWebKit");
  });

  it("a token with no company is refused", async () => {
    me = { ...me, orgId: null };
    expect((await call("/api/me/devices")).status).toBe(403);
    expect(asked()).toEqual([]);
  });
});

describe("GET /api/members/:userId/devices — an admin, for a member of their company", () => {
  it("is refused to a member who is not an admin, and asks nothing", async () => {
    expect((await call(`/api/members/${BEN}/devices`)).status).toBe(403);
    expect(asked()).toEqual([]);
  });

  it("answers an admin for a member of the admin's company", async () => {
    me = { ...me, role: "admin" };
    const res = await call(`/api/members/${BEN}/devices`);
    expect(res.status).toBe(200);
    expect(asked()).toEqual([{ p_org: ORG, p_user: BEN, p_idle_hours: 12 }]);
  });

  it("is 404 for somebody who is not a member of the admin's company — never asked about", async () => {
    me = { ...me, role: "admin" };
    expect((await call(`/api/members/${STRANGER}/devices`)).status).toBe(404);
    expect((await call(`/api/members/not-an-id/devices`)).status).toBe(404);
    expect(asked()).toEqual([]);
  });

  it("marks none of a colleague's devices as the admin's own", async () => {
    me = { ...me, role: "admin", sessionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" };
    const body = memberDevicesResponseSchema.parse(await (await call(`/api/members/${BEN}/devices`)).json());
    expect(body.devices.every((d) => !d.current)).toBe(true);
  });
});
