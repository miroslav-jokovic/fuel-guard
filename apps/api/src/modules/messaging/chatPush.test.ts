import { createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatPushMessage } from "@silvicom/shared";
import { loadEnv } from "../../env.js";
import { drainJobs } from "../../lib/shutdown.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { deliverChatPush, PUSH_HOLD_MS, scheduleChatPush } from "./chatPush.js";
import { generateVapidKeys } from "./webPush.js";

/**
 * CH10's delivery (CHAT-WEB-PUSH-PLAN D-WP2–D-WP4). WHO is 0599's `chat_push_targets`, executed by
 * `supabase/tests/chat-web-push.test.mjs`; this file holds the delivery to everything around that answer:
 * each recipient's devices get the line worded as THEIR inbox names it, opening on the device's own origin;
 * a device the push service calls gone is revoked and one it merely refused is not; nothing is read or sent
 * when nobody is owed a push; every table read carries the org; and the hold is 15 seconds.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ANA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const CARA = "55555555-5555-4555-8555-555555555555";
const THREAD = "33333333-3333-4333-8333-333333333333";
const MSG = "44444444-4444-4444-8444-444444444444";
const ORIGIN = "https://360.silvicominc.com";

const pair = generateVapidKeys();
const keys = { ...pair, subject: ORIGIN };

/** A browser: its key pair and auth secret, and the decryption it would do (RFC 8291). */
function browser() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: auth.toString("base64url"),
    read(body: Buffer): ChatPushMessage {
      const salt = body.subarray(0, 16);
      const asPublic = body.subarray(21, 86);
      const secret = ecdh.computeSecret(asPublic);
      const ikm = Buffer.from(hkdfSync("sha256", secret, auth, Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic]), 32));
      const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
      const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
      const ct = body.subarray(86);
      const d = createDecipheriv("aes-128-gcm", cek, nonce);
      d.setAuthTag(ct.subarray(ct.length - 16));
      const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
      return JSON.parse(plain.subarray(0, plain.length - 1).toString("utf8")) as ChatPushMessage;
    },
  };
}

const benPhone = browser();
const caraPc = browser();
const device = (id: string, user_id: string, b: ReturnType<typeof browser>, endpoint: string, origin = ORIGIN) =>
  ({ id, user_id, endpoint, p256dh: b.p256dh, auth: b.auth, origin });
const BEN_PHONE = device("d0000000-0000-4000-8000-000000000001", BEN, benPhone, "https://fcm.googleapis.com/fcm/send/ben");
const CARA_PC = device("d0000000-0000-4000-8000-000000000002", CARA, caraPc, "https://wns2-bn3p.notify.windows.com/w/?token=cara", "https://fleetguardweb-production.up.railway.app");

const member = (user_id: string, name: string, joined: string) => ({
  user_id, name, member_role: "member", read_seq: 1, last_read_at: null, joined_at: joined,
});
const conversation = (over: Record<string, unknown> = {}) => ({
  thread_id: THREAD, kind: "group", subject: null, load_id: null, created_at: "2026-11-13T14:00:00Z",
  last_message_at: "2026-11-13T15:00:00Z", last_seq: 3, rev: 3, read_seq: 3, unread: 0, muted: "none",
  member_role: "member", member_count: 3, title_members: [], last_message: null, ...over,
});

let rpc: Record<string, unknown>;
let tables: Record<string, unknown>;
let rec: SupabaseRecorder;
let posted: Array<{ url: string; headers: Record<string, string>; body: Buffer }>;
let status: (url: string) => number;
const fetcher = (async (url: string, init: RequestInit) => {
  posted.push({ url, headers: init.headers as Record<string, string>, body: Buffer.from(init.body as Uint8Array) });
  return new Response("", { status: status(url) });
}) as unknown as typeof fetch;

beforeEach(() => {
  rpc = {
    chat_push_targets: [{ user_id: BEN, reason: "line" }, { user_id: CARA, reason: "mention" }],
    chat_inbox: [conversation()],
    chat_members: [
      member(ANA, "Ana Petrović", "2026-11-13T14:00:00Z"),
      member(BEN, "Ben Admin", "2026-11-13T14:00:01Z"),
      member(CARA, "Cara Safety", "2026-11-13T14:00:02Z"),
    ],
  };
  tables = {
    web_push_subscriptions: [BEN_PHONE, CARA_PC],
    messages: [{ thread_id: THREAD, parent_id: null, body: `<@${CARA}> can you   sign 4417?`, created_at: "2026-11-13T15:00:00Z" }],
    chat_attachments: [],
  };
  rec = createSupabaseRecorder({ rpc: (fn) => rpc[fn], tables: tables as never });
  posted = [];
  status = () => 201;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const sentTo = (endpoint: string, b: ReturnType<typeof browser>) => b.read(posted.find((p) => p.url === endpoint)!.body);
const writes = () => rec.writes().map((q) => ({ filters: q.filters(), payload: q.write?.payload as Record<string, unknown> }));

describe("deliverChatPush", () => {
  it("words the line as each recipient's own inbox names it, and opens it on the origin the device came from", async () => {
    const r = await deliverChatPush(rec.client, keys, ORG, ANA, MSG, null, fetcher);
    expect(r).toEqual({ targets: 2, devices: 2, sent: 2, gone: 0, failed: 0 });
    const toBen = sentTo(BEN_PHONE.endpoint, benPhone);
    const toCara = sentTo(CARA_PC.endpoint, caraPc);
    // An unnamed group is named by its OTHER members, per viewer — as chatTitle does in each inbox.
    expect(toBen.notification.title).toBe("Ana Petrović in Ana Petrović, Cara Safety");
    expect(toCara.notification.title).toBe("Ana Petrović in Ana Petrović, Ben Admin");
    expect(toBen.notification.body).toBe("@Cara Safety can you sign 4417?");
    expect(toBen.web_push).toBe(8030);
    expect(toBen.notification.navigate).toBe(`${ORIGIN}/chat?c=${THREAD}`);
    expect(toCara.notification.navigate).toBe(`https://fleetguardweb-production.up.railway.app/chat?c=${THREAD}`);
    expect(toBen.notification).toMatchObject({ tag: `chat:${THREAD}`, renotify: true, data: { thread_id: THREAD, message_id: MSG } });
    expect(posted[0]!.headers).toMatchObject({ TTL: "3600", Urgency: "high", Topic: THREAD.replace(/-/g, "") });
  });

  it("asks the database who, with the edit's newly named people when it is an edit", async () => {
    await deliverChatPush(rec.client, keys, ORG, ANA, MSG, [CARA], fetcher);
    expect(rec.rpcs().find((c) => c.fn === "chat_push_targets")!.args).toEqual({ p_org: ORG, p_message: MSG, p_mentioned: [CARA] });
  });

  it("reads only this organisation's devices of the people owed a push, and records each answer on its row", async () => {
    await deliverChatPush(rec.client, keys, ORG, ANA, MSG, null, fetcher);
    expectOrgScoped(rec, ORG);
    const read = rec.forTable("web_push_subscriptions").find((q) => !q.write)!;
    expect(read.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "user_id", val: [BEN, CARA] }]));
    expect(read.ops.some((o) => o.method === "is" && o.args[0] === "revoked_at" && o.args[1] === null)).toBe(true);
    const done = writes();
    expect(done).toHaveLength(2);
    for (const w of done) {
      expect(w.payload.last_success_at).toEqual(expect.any(String));
      expect(w.payload).not.toHaveProperty("revoked_at");
    }
  });

  it("revokes a device its push service calls gone, and only logs one it refused", async () => {
    status = (url) => (url === BEN_PHONE.endpoint ? 410 : 403);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await deliverChatPush(rec.client, keys, ORG, ANA, MSG, null, fetcher);
    expect(r).toMatchObject({ sent: 0, gone: 1, failed: 1 });
    const byId = new Map(writes().map((w) => [w.filters.find((f) => f.col === "id")!.val, w.payload]));
    expect(byId.get(BEN_PHONE.id)).toMatchObject({ revoked_reason: "gone", revoked_at: expect.any(String) });
    expect(byId.get(CARA_PC.id)).toMatchObject({ last_failure: expect.stringContaining("403") });
    expect(byId.get(CARA_PC.id)).not.toHaveProperty("revoked_at");
  });

  it("reads and sends nothing when the database owes nobody a push", async () => {
    rpc.chat_push_targets = [];
    expect(await deliverChatPush(rec.client, keys, ORG, ANA, MSG, null, fetcher)).toEqual({ targets: 0, devices: 0, sent: 0, gone: 0, failed: 0 });
    expect(rec.forTable("web_push_subscriptions")).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });

  it("sends nothing to people who have no device", async () => {
    tables.web_push_subscriptions = [];
    rec = createSupabaseRecorder({ rpc: (fn) => rpc[fn], tables: tables as never });
    expect(await deliverChatPush(rec.client, keys, ORG, ANA, MSG, null, fetcher)).toMatchObject({ targets: 2, devices: 0, sent: 0 });
    expect(posted).toHaveLength(0);
  });

  it("says what the bell says for a line that is only a file, and names a channel with its #", async () => {
    rpc.chat_inbox = [conversation({ kind: "channel", subject: "Loads" })];
    tables.messages = [{ thread_id: THREAD, parent_id: MSG, body: "", created_at: "2026-11-13T15:00:00Z" }];
    tables.chat_attachments = [{ file_name: "BOL-4417.pdf" }];
    rec = createSupabaseRecorder({ rpc: (fn) => rpc[fn], tables: tables as never });
    await deliverChatPush(rec.client, keys, ORG, ANA, MSG, null, fetcher);
    const toBen = sentTo(BEN_PHONE.endpoint, benPhone);
    expect(toBen.notification.title).toBe("Ana Petrović in # Loads");
    expect(toBen.notification.body).toBe("Sent BOL-4417.pdf");
    expect(toBen.notification.navigate).toBe(`${ORIGIN}/chat?ch=${THREAD}&post=${MSG}`);
    expectOrgScoped(rec, ORG);
  });
});

describe("scheduleChatPush", () => {
  const env = loadEnv({
    NODE_ENV: "test",
    SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    WEB_PUSH_VAPID_PUBLIC_KEY: pair.publicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: pair.privateKey,
  } as NodeJS.ProcessEnv);

  it("holds the push 15 seconds, then asks the database who is still owed it", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetcher);
    scheduleChatPush(rec.client, env, ORG, ANA, MSG);
    await vi.advanceTimersByTimeAsync(PUSH_HOLD_MS - 1);
    expect(rec.rpcs()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(PUSH_HOLD_MS).toBe(15_000);
  });

  it("does nothing at all on a server with no key pair", async () => {
    vi.useFakeTimers();
    const off = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
    scheduleChatPush(rec.client, off, ORG, ANA, MSG);
    await vi.advanceTimersByTimeAsync(PUSH_HOLD_MS * 2);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("an edit that names nobody new schedules nothing", async () => {
    vi.useFakeTimers();
    scheduleChatPush(rec.client, env, ORG, ANA, MSG, []);
    await vi.advanceTimersByTimeAsync(PUSH_HOLD_MS * 2);
    expect(rec.rpcs()).toHaveLength(0);
  });

  // LAST in the file: a drain marks the process as shutting down for good.
  it("a deploy that cannot wait out the hold sends it at once rather than dropping it", async () => {
    vi.stubGlobal("fetch", fetcher);
    scheduleChatPush(rec.client, env, ORG, ANA, MSG);
    const { released } = await drainJobs(0);
    expect(released.some((r) => r.startsWith("chat_push"))).toBe(true);
    expect(posted).toHaveLength(2);
  });
});
