import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { setAppLocals } from "../lib/appLocals.js";
import type { PlatformToken } from "../lib/auth.js";
import type { PlatformAdmin } from "../lib/platformAdmins.js";
import { STEP_UP_WINDOW_MS } from "../middleware/platformAuth.js";
import { maskAddress, normaliseEmail, normalisePhone } from "../lib/alertRecipients.js";

/**
 * 0427 — who hears a platform alarm, kept in the console's Settings. These cases pin what a person
 * types becoming what a sender accepts, the phone being masked for every reader, the write gate
 * (owner/admin + a fresh second factor), and that every add and remove reaches the audit trail.
 */
describe("normalisePhone", () => {
  it.each([
    ["8728008639", "+18728008639"],
    ["(872) 800-8639", "+18728008639"],
    ["872.800.8639", "+18728008639"],
    ["1 872 800 8639", "+18728008639"],
    ["+1 872-800-8639", "+18728008639"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("reads %s as %s", (typed, e164) => expect(normalisePhone(typed)).toBe(e164));

  it.each(["800863", "0728008639", "1172800863", "872-800-863x", "+0 872 800 8639", ""])("refuses %s", (typed) =>
    expect(normalisePhone(typed)).toBeNull(),
  );
});

describe("normaliseEmail", () => {
  it("lower-cases and trims", () => expect(normaliseEmail("  Ops@Example.COM ")).toBe("ops@example.com"));
  it("refuses a non-address", () => expect(normaliseEmail("ops@example")).toBeNull());
});

describe("maskAddress", () => {
  it("shows a phone's last four digits only", () => expect(maskAddress("sms", "+18728008639")).toBe("•••• 8639"));
  it("shows an email whole", () => expect(maskAddress("email", "ops@example.com")).toBe("ops@example.com"));
});

// ── Routes, against a fake service-role client that records what it was asked to write ──────────

interface Store {
  rows: { id: string; channel: string; address: string; label: string | null; created_at: string; removed_at: string | null }[];
  audit: { action: string; after: unknown; before: unknown }[];
}

function fakeClient(store: Store): SupabaseClient {
  const recipients = () => {
    let pending: Partial<Store["rows"][number]> | null = null;
    let insert: Store["rows"][number] | null = null;
    let id: string | null = null;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.is = () => b;
    b.order = () => b;
    b.eq = (_c: string, v: string) => ((id = v), b);
    b.update = (patch: Partial<Store["rows"][number]>) => ((pending = patch), b);
    b.insert = (row: { channel: string; address: string; label: string | null }) => {
      insert = { id: `00000000-0000-4000-8000-00000000000${store.rows.length + 1}`, created_at: "2026-10-05T00:00:00Z", removed_at: null, ...row };
      return b;
    };
    b.single = async () => {
      const dup = store.rows.some((r) => !r.removed_at && r.channel === insert!.channel && r.address === insert!.address);
      if (dup) return { data: null, error: { code: "23505" } };
      store.rows.push(insert!);
      return { data: insert, error: null };
    };
    b.maybeSingle = async () => {
      const row = store.rows.find((r) => r.id === id && !r.removed_at);
      if (row && pending) Object.assign(row, pending);
      return { data: row ?? null, error: null };
    };
    b.then = (resolve: (v: unknown) => void) => resolve({ data: store.rows.filter((r) => !r.removed_at), error: null });
    return b;
  };
  return {
    from: (table: string) =>
      table === "platform_alert_recipients"
        ? recipients()
        : { insert: async (row: Store["audit"][number]) => (store.audit.push(row), { error: null }) },
  } as unknown as SupabaseClient;
}

const secondsAgo = (n: number) => Math.floor((Date.now() - n * 1000) / 1000);
const freshMfa = (): PlatformToken => ({
  userId: "u1", email: "owner@example.com", aal: "aal2",
  amr: [{ method: "totp", timestamp: secondsAgo(30) }], sessionId: "s1",
});
const staleMfa = (): PlatformToken => ({ ...freshMfa(), amr: [{ method: "totp", timestamp: secondsAgo(STEP_UP_WINDOW_MS / 1000 + 60) }] });
const owner: PlatformAdmin = { id: "a1", email: "owner@example.com", userId: "u1", role: "platform_owner", status: "active", mfaEnrolledAt: "x", lastReauthAt: null };
const readonly: PlatformAdmin = { ...owner, id: "a2", role: "platform_readonly" };
const H = { authorization: "Bearer x", "content-type": "application/json" };

let server: Server | null = null;
afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
});

async function start(who: PlatformAdmin, token = freshMfa, store: Store = { rows: [], audit: [] }) {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  setAppLocals(app, { verifyToken: async () => token(), lookupPlatformAdmin: async () => who, supabaseAdmin: fakeClient(store) });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin/alert-recipients`, store };
}
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: H, body: JSON.stringify(body) });

describe("/admin/alert-recipients", () => {
  it("adds a typed US phone as E.164, answers with it masked, and audits it masked", async () => {
    const { base, store } = await start(owner);
    const res = await post(base, { channel: "sms", address: "(872) 800-8639", label: "Owner — mobile" });
    expect(res.status).toBe(201);
    expect(store.rows[0]!.address).toBe("+18728008639");
    expect(((await res.json()) as { recipient: { address: string } }).recipient.address).toBe("•••• 8639");
    expect(store.audit).toEqual([expect.objectContaining({ action: "alert_recipient.add", after: expect.objectContaining({ address: "•••• 8639" }) })]);
  });

  it("lists live recipients with phones masked", async () => {
    const { base } = await start(owner, freshMfa, {
      rows: [{ id: "r1", channel: "sms", address: "+18728008639", label: null, created_at: "x", removed_at: null }],
      audit: [],
    });
    const body = (await (await fetch(base, { headers: H })).json()) as { recipients: { address: string }[] };
    expect(body.recipients.map((r) => r.address)).toEqual(["•••• 8639"]);
  });

  it("refuses an address no sender accepts", async () => {
    const { base, store } = await start(owner);
    const res = await post(base, { channel: "sms", address: "800-863" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_address");
    expect(store.rows).toHaveLength(0);
  });

  it("refuses the same address twice on one channel", async () => {
    const { base } = await start(owner);
    expect((await post(base, { channel: "email", address: "ops@example.com" })).status).toBe(201);
    expect((await post(base, { channel: "email", address: "OPS@example.com" })).status).toBe(409);
  });

  it("removes by stamping, audits it, and a second remove finds nothing", async () => {
    const { base, store } = await start(owner);
    await post(base, { channel: "sms", address: "8728008639" });
    const id = store.rows[0]!.id;
    expect((await post(`${base}/${id}/remove`, {})).status).toBe(200);
    expect(store.rows[0]!.removed_at).not.toBeNull();
    expect(store.audit.map((a) => a.action)).toEqual(["alert_recipient.add", "alert_recipient.remove"]);
    expect((await post(`${base}/${id}/remove`, {})).status).toBe(404);
  });

  it("a read-only platform role may look, but not add", async () => {
    const { base, store } = await start(readonly);
    expect((await fetch(base, { headers: H })).status).toBe(200);
    expect((await post(base, { channel: "sms", address: "8728008639" })).status).toBe(403);
    expect(store.rows).toHaveLength(0);
  });

  it("adding and removing need a second factor proved just now", async () => {
    const { base, store } = await start(owner, staleMfa, {
      rows: [{ id: "00000000-0000-4000-8000-000000000009", channel: "sms", address: "+18728008639", label: null, created_at: "x", removed_at: null }],
      audit: [],
    });
    const add = await post(base, { channel: "sms", address: "3125550100" });
    expect(add.status).toBe(403);
    expect(((await add.json()) as { error: { code: string } }).error.code).toBe("step_up_required");
    expect((await post(`${base}/00000000-0000-4000-8000-000000000009/remove`, {})).status).toBe(403);
    expect(store.rows[0]!.removed_at).toBeNull();
  });
});
