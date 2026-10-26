import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DQ_EXPORT_BUCKET, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { STEP_UP_TOKEN_HEADER, mintStepUpToken } from "../../../lib/stepUpToken.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/chat/compliance/holds` and `/exports` (OFFICE-CHAT-PLAN CHA3b). The rules — what a hold may
 * become, what an export returns, the hash fold — live in 0517 and are executed by
 * `supabase/tests/office-chat-holds-exports.test.mjs`. What this file holds the ROUTER to: the
 * console's door (section, grant, step-up on every act), the caller's org and user from the token,
 * the database's refusals as answers rather than 500s, the export's three files in the bucket under
 * the org with a manifest that names the ledger position and each line's hash, a failed upload
 * recorded on the export, and an `audit_logs` row beside each act.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";
const USER = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";
const THREAD = "33333333-3333-4333-8333-333333333333";
const HOLD = "44444444-4444-4444-8444-444444444444";
const EXPORT = "55555555-5555-4555-8555-555555555555";

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as NodeJS.ProcessEnv);

let me: AuthContext = { userId: USER, email: "ana@example.test", orgId: ORG, role: "admin" };
let rpc: Record<string, unknown | ((args: Record<string, unknown>) => unknown)> = {};
let storage: Record<string, (...args: unknown[]) => unknown> = {};

const REASON = { category: "legal", text: "Litigation hold for matter 2026-CV-118" };
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const member = (id: string, name: string) =>
  ({ user_id: id, name, role: "dispatcher", member_role: "member", joined_at: "2026-10-23T14:00:00Z", left_at: null });
const line = (seq: number, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, thread_id: THREAD, seq, sender_user_id: PEER,
  sender_name: "Ben Petrović", body: `line ${seq}`, body_sha256: sha(`line ${seq}`), created_at: `2026-10-23T15:0${seq}:00Z`,
  edited_at: null, deleted_at: null, versions: [], ...over,
});
const exportRows = (exportId: string) => [{
  export: {
    id: exportId, scope: "conversation", filters: { thread: THREAD }, reason: REASON, requested_by: USER,
    requested_by_name: "Ana", created_at: "2026-10-24T10:00:00Z", message_count: 2, ledger_seq: 41,
    ledger_hash: "a".repeat(64), content_sha256: "b".repeat(64),
  },
  conversations: [{ thread_id: THREAD, kind: "group", subject: "Night dispatch", load_id: null, created_at: "2026-10-23T14:00:00Z", archived_at: null, members: [member(USER, "Ana"), member(PEER, "Ben Petrović")] }],
  lines: [
    line(1, { versions: [{ version: 1, body: "old words", body_sha256: sha("old words"), replaced_at: "2026-10-23T15:30:00Z", replaced_by: PEER }] }),
    line(2, { deleted_at: "2026-10-23T16:00:00Z" }),
  ],
}];
const hold = (over: Record<string, unknown> = {}) => ({
  id: HOLD, scope: "person", user_id: PEER, user_name: "Ben", thread_id: null, thread_kind: null, thread_subject: null,
  matter: "Matter 2026-CV-118", reason: REASON, set_by: USER, set_by_name: "Ana", set_at: "2026-10-24T09:00:00Z",
  released_at: null, released_by: null, released_by_name: null, release_reason: null, ...over,
});

let server: Server;
let baseUrl = "";
beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (): Promise<AuthContext> => me;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

beforeEach(() => {
  me = { userId: USER, email: "ana@example.test", orgId: ORG, role: "admin" };
  storage = {};
  rpc = {
    org_module_enabled: true,
    chat_holds_list: [hold()],
    chat_hold_set: HOLD,
    chat_hold_release: null,
    chat_compliance_export_rows: (args: Record<string, unknown>) => exportRows(String(args.p_export_id)),
    chat_export_stored: null,
    chat_export_failed: null,
    chat_exports_list: [],
    chat_export_get: [{ id: EXPORT, status: "ready", storage_paths: ["a", "b", "c"], expires_at: "2026-10-31T10:00:00Z", purged_at: null }],
  };
  holder.rec = createSupabaseRecorder({
    rpc: (fn, args) => {
      const r = rpc[fn];
      return typeof r === "function" ? (r as (a: Record<string, unknown>) => unknown)(args as Record<string, unknown>) : r;
    },
    storage: new Proxy({}, { get: (_t, prop: string) => storage[prop] }),
    tables: { audit_logs: () => ({ data: [] }) },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const stepUp = () => ({ [STEP_UP_TOKEN_HEADER]: mintStepUpToken(env, me.userId, me.orgId!)!.token });
const call = (path: string, init: RequestInit = {}, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}/api/chat/compliance${path}`, {
    ...init,
    headers: { Authorization: "Bearer token", "Content-Type": "application/json", ...headers },
  });
const post = (path: string, body: unknown, headers: Record<string, string> = stepUp()) =>
  call(path, { method: "POST", body: JSON.stringify(body) }, headers);
const recordCalls = () => holder.rec!.rpcs().filter((c) => /^chat_(hold|export|compliance_export)/.test(c.fn));
const rpcArgs = (fn: string) => holder.rec!.rpcs().filter((c) => c.fn === fn).map((c) => c.args as Record<string, unknown>);
const auditRows = () => holder.rec!.writtenRows("audit_logs") as Array<Record<string, unknown>>;
const uploads = () => holder.rec!.storageCalls().filter((c) => c.fn === "upload");

describe("the door", () => {
  it("refuses a role without the settings section before any function runs", async () => {
    for (const role of ["dispatcher", "driver", "technician"] as const) {
      me = { ...me, role };
      expect((await call("/holds")).status, role).toBe(403);
      expect((await call("/exports")).status, role).toBe(403);
    }
    expect(recordCalls()).toEqual([]);
  });

  it("lists holds and exports for the admin without a step-up, and active holds unless asked", async () => {
    const res = await call("/holds");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { holds: unknown[] }).holds).toHaveLength(1);
    await call("/holds?released=1");
    expect(rpcArgs("chat_holds_list").map((a) => a.p_include_released)).toEqual([false, true]);
    expect((await call("/exports")).status).toBe(200);
  });

  it("does nothing without a step-up token — no hold, no release, no export, no link", async () => {
    const acts: Array<[string, unknown]> = [
      ["/holds", { reason: REASON, scope: "person", target: PEER, matter: "Matter 118" }],
      [`/holds/${HOLD}/release`, { reason: REASON }],
      ["/exports", { reason: REASON, scope: "conversation", thread: THREAD }],
      [`/exports/${EXPORT}/links`, {}],
    ];
    for (const [path, body] of acts) {
      const res = await post(path, body, {});
      expect(res.status, path).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("step_up_required");
    }
    expect(recordCalls()).toEqual([]);
    expect(uploads()).toEqual([]);
  });
});

describe("holds", () => {
  it("sets a hold as the caller, in the caller's org, whatever the body claims, and records it", async () => {
    const res = await post("/holds", { reason: REASON, scope: "person", target: PEER, matter: "  Matter 2026-CV-118 ", org_id: OTHER_ORG, actor: PEER });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: HOLD });
    expect(rpcArgs("chat_hold_set")).toEqual([{ p_org: ORG, p_actor: USER, p_reason: REASON, p_scope: "person", p_target: PEER, p_matter: "Matter 2026-CV-118" }]);
    const audit = auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ org_id: ORG, actor_id: USER, action: "chat_compliance.hold_set", entity: "chat_holds", entity_id: HOLD });
    expect(audit[0]!.meta).toMatchObject({ category: "legal", reason: REASON.text, scope: "person", target: PEER, matter: "Matter 2026-CV-118" });
  });

  it("refuses a hold without a matter or a reason before the database is asked", async () => {
    expect((await post("/holds", { reason: REASON, scope: "person", target: PEER, matter: "x" })).status).toBe(400);
    expect((await post("/holds", { scope: "person", target: PEER, matter: "Matter 118" })).status).toBe(400);
    expect(recordCalls()).toEqual([]);
  });

  it("answers the database's refusals: another org's target is 404, a second release is 409 — and neither is audited", async () => {
    rpc.chat_hold_set = { error: { code: "CH001", message: "that person is not in this organisation" } };
    expect((await post("/holds", { reason: REASON, scope: "person", target: PEER, matter: "Matter 118" })).status).toBe(404);
    rpc.chat_hold_release = { error: { code: "CH010", message: "that hold is already released" } };
    const res = await post(`/holds/${HOLD}/release`, { reason: REASON });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("already_released");
    expect(auditRows()).toEqual([]);
  });

  it("releases a hold as the caller and records it", async () => {
    expect((await post(`/holds/${HOLD}/release`, { reason: REASON })).status).toBe(200);
    expect(rpcArgs("chat_hold_release")).toEqual([{ p_org: ORG, p_actor: USER, p_reason: REASON, p_hold: HOLD }]);
    expect(auditRows()[0]).toMatchObject({ action: "chat_compliance.hold_released", entity_id: HOLD });
  });
});

describe("exports", () => {
  it("writes the three files under the org, a manifest that names the ledger position and every hash, and marks the export stored", async () => {
    const res = await post("/exports", { reason: REASON, scope: "conversation", thread: THREAD });
    expect(res.status).toBe(201);
    const { id, message_count } = (await res.json()) as { id: string; message_count: number };
    expect(message_count).toBe(2);
    const args = rpcArgs("chat_compliance_export_rows")[0]!;
    expect(args).toMatchObject({ p_org: ORG, p_actor: USER, p_reason: REASON, p_export_id: id, p_scope: "conversation", p_thread: THREAD, p_q: null });

    const files = uploads();
    expect(files.map((u) => u.bucket)).toEqual([DQ_EXPORT_BUCKET, DQ_EXPORT_BUCKET, DQ_EXPORT_BUCKET]);
    expect(files.map((u) => u.args[0])).toEqual([`${ORG}/chat/${id}/export.jsonl`, `${ORG}/chat/${id}/export.pdf`, `${ORG}/chat/${id}/manifest.json`]);
    const [jsonl, pdf, manifestBytes] = files.map((u) => u.args[1] as Buffer);
    expect(jsonl!.toString("utf8").trim().split("\n").map((l) => JSON.parse(l).id)).toEqual([line(1).id, line(2).id]);
    expect(pdf!.subarray(0, 5).toString()).toBe("%PDF-");
    const manifest = JSON.parse(manifestBytes!.toString("utf8"));
    expect(manifest.ledger).toMatchObject({ seq: 41, hash: "a".repeat(64) });
    expect(manifest.content_sha256).toBe("b".repeat(64));
    expect(manifest.files["export.jsonl"].sha256).toBe(sha(jsonl!));
    expect(manifest.files["export.pdf"].sha256).toBe(sha(pdf!));
    expect(manifest.lines).toEqual([
      { id: line(1).id, thread_id: THREAD, seq: 1, body_sha256: sha("line 1"), retracted: false, versions: [{ version: 1, body_sha256: sha("old words") }] },
      { id: line(2).id, thread_id: THREAD, seq: 2, body_sha256: sha("line 2"), retracted: true, versions: [] },
    ]);

    expect(rpcArgs("chat_export_stored")).toEqual([{
      p_org: ORG, p_export: id, p_paths: files.map((u) => u.args[0]),
      p_bytes: jsonl!.length + pdf!.length + manifestBytes!.length, p_manifest_sha256: sha(manifestBytes!),
    }]);
    expect(auditRows()[0]).toMatchObject({ action: "chat_compliance.export", entity: "chat_exports", entity_id: id });
    expect(auditRows()[0]!.meta).toMatchObject({ scope: "conversation", thread: THREAD, message_count: 2 });
  });

  it("refuses a conversation export carrying a search filter before the database is asked", async () => {
    expect((await post("/exports", { reason: REASON, scope: "conversation", thread: THREAD, q: "night" })).status).toBe(400);
    expect((await post("/exports", { reason: REASON, scope: "conversation" })).status).toBe(400);
    expect(recordCalls()).toEqual([]);
  });

  it("answers an export too large to write as 422 and writes no file", async () => {
    rpc.chat_compliance_export_rows = { error: { code: "CH010", message: "an export holds at most 10,000 lines; this one has 12000, narrow it by date" } };
    const res = await post("/exports", { reason: REASON, scope: "search", q: "night" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain("narrow it by date");
    expect(uploads()).toEqual([]);
    expect(auditRows()).toEqual([]);
  });

  it("records a failed upload on the export instead of leaving it building", async () => {
    storage.upload = (path: unknown) => (String(path).endsWith(".pdf") ? { data: null, error: { message: "bucket full" } } : { data: { path }, error: null });
    const res = await post("/exports", { reason: REASON, scope: "conversation", thread: THREAD });
    expect(res.status).toBe(500);
    const failed = rpcArgs("chat_export_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ p_org: ORG, p_error: expect.stringContaining("bucket full") });
    expect(rpcArgs("chat_export_stored")).toEqual([]);
  });
});

describe("download links", () => {
  it("signs the three files for five minutes", async () => {
    storage.createSignedUrls = (paths: unknown) => ({ data: (paths as string[]).map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null });
    const res = await post(`/exports/${EXPORT}/links`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { links: Record<string, string> };
    expect(body.links.pdf).toBe(`https://signed/${ORG}/chat/${EXPORT}/export.pdf`);
    const signed = holder.rec!.storageCalls().find((c) => c.fn === "createSignedUrls")!;
    expect(signed.args[1]).toBe(300);
    expect(rpcArgs("chat_export_get")).toEqual([{ p_org: ORG, p_export: EXPORT }]);
  });

  it("says when the files have been swept, and when an export is still being written", async () => {
    rpc.chat_export_get = [{ id: EXPORT, status: "ready", storage_paths: null, expires_at: "2026-10-20T10:00:00Z", purged_at: "2026-10-21T10:00:00Z" }];
    let res = await post(`/exports/${EXPORT}/links`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("expired");
    rpc.chat_export_get = [{ id: EXPORT, status: "building", storage_paths: null, expires_at: null, purged_at: null }];
    res = await post(`/exports/${EXPORT}/links`, {});
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_ready");
  });

  it("answers an export of another org as not found", async () => {
    rpc.chat_export_get = [];
    expect((await post(`/exports/${EXPORT}/links`, {})).status).toBe(404);
  });
});
