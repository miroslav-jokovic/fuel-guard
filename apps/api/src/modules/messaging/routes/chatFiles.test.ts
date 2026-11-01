import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { bytesAreKind } from "../chatFiles.js";

/**
 * CH7's API (0539's rules run in `supabase/tests/office-chat-files.test.mjs`). What this holds the
 * routes to: an upload URL is signed only after the database says the person may write there, for a key
 * the SERVER chose; a send that names files reads each stored file back and refuses it unless its size,
 * hash and first bytes are what was declared — before the database is asked to write anything; a link is
 * five minutes long and a document comes as a download; and everything is the caller's, from the token.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "11111111-1111-4111-8111-111111111111";
const THREAD = "33333333-3333-4333-8333-333333333333";
const MSG = "44444444-4444-4444-8444-444444444444";
const FILE = "55555555-5555-4555-8555-555555555555";
const POST = "66666666-6666-4666-8666-666666666666";

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
let me: AuthContext = { userId: USER, email: "ana@example.test", orgId: ORG, role: "dispatcher" };
let rpc: Record<string, unknown> = {};

const PDF = new Uint8Array([...Buffer.from("%PDF-1.7\n"), 1, 2, 3]);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
let stored: Uint8Array | null = PDF;
const declared = (over: Record<string, unknown> = {}) => ({ id: FILE, file_name: "rate-con.pdf", mime: "application/pdf", byte_size: PDF.length, sha256: sha(PDF), ...over });

let server: Server;
let baseUrl = "";
beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (): Promise<AuthContext> => me;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; resolve(); });
  });
});
afterAll(async () => closeTestServer(server));

beforeEach(() => {
  me = { userId: USER, email: "ana@example.test", orgId: ORG, role: "dispatcher" };
  stored = PDF;
  rpc = {
    org_module_enabled: true,
    bump_driver_write_counter: [{ allowed: true }],
    chat_file_can_upload: true,
    chat_send_files: [{ message_id: MSG, seq: 4, rev: 5, created_at: "2026-11-01T15:00:00Z", duplicate: false }],
    chat_send: [{ message_id: MSG, seq: 4, rev: 5, created_at: "2026-11-01T15:00:00Z", duplicate: false }],
    chat_notify_targets: [],
    chat_file_for: [{ storage_path: `${ORG}/${THREAD}/${FILE}`, file_name: "rate-con.pdf", mime: "application/pdf", byte_size: "12" }],
    chat_files: [],
  };
  holder.rec = createSupabaseRecorder({
    rpc: (fn) => rpc[fn],
    storage: {
      createSignedUploadUrl: (path: string) => ({ data: { signedUrl: `https://storage.test/upload/${path}` }, error: null }),
      download: () => (stored ? { data: new Blob([stored.slice().buffer as ArrayBuffer]), error: null } : { data: null, error: { message: "Object not found" } }),
      createSignedUrl: (path: string, secs: number, opts?: { download?: string }) =>
        ({ data: { signedUrl: `https://storage.test/read/${path}?s=${secs}&dl=${opts?.download ?? ""}` }, error: null }),
    },
  });
});

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/chat${path}`, { ...init, headers: { Authorization: "Bearer token", "Content-Type": "application/json" } });
const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });
const fns = () => holder.rec!.rpcs().map((c) => c.fn).filter((f) => f.startsWith("chat_"));

describe("starting an upload", () => {
  it("asks the database first, then signs a URL for a key the server chose under the caller's org and conversation", async () => {
    const res = await post(`/${THREAD}/files`, { file_name: "rate-con.pdf", mime: "application/pdf", byte_size: 12, sha256: sha(PDF) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { file_id: string; upload_url: string };
    expect(holder.rec!.rpcs().find((c) => c.fn === "chat_file_can_upload")!.args).toEqual({ p_org: ORG, p_user: USER, p_thread: THREAD });
    const signed = holder.rec!.storageCalls().find((c) => c.fn === "createSignedUploadUrl")!;
    expect(signed.bucket).toBe("chat-files");
    expect(signed.args[0]).toBe(`${ORG}/${THREAD}/${body.file_id}`);
    expect(body.upload_url).toContain(body.file_id);
    expectOrgScoped(holder.rec!, ORG);
  });

  it("signs nothing when the database refuses, and refuses a kind we do not take before asking", async () => {
    rpc.chat_file_can_upload = { error: { code: "CH001", message: "" } };
    expect((await post(`/${THREAD}/files`, { file_name: "a.pdf", mime: "application/pdf", byte_size: 12, sha256: sha(PDF) })).status).toBe(404);
    expect(holder.rec!.storageCalls()).toEqual([]);
    expect((await post(`/${THREAD}/files`, { file_name: "setup.exe", mime: "application/octet-stream", byte_size: 12, sha256: sha(PDF) })).status).toBe(400);
    expect((await post(`/${THREAD}/files`, { file_name: "a.pdf", mime: "application/pdf", byte_size: 26 * 1024 * 1024, sha256: sha(PDF) })).status).toBe(400);
  });
});

describe("sending a line with files", () => {
  it("reads the stored file back, and writes the line and its files in one call when it is what was declared", async () => {
    const res = await post(`/${THREAD}/messages`, { message_id: MSG, body: "Signed", files: [declared()] });
    expect(res.status).toBe(201);
    expect(holder.rec!.storageCalls().find((c) => c.fn === "download")!.args[0]).toBe(`${ORG}/${THREAD}/${FILE}`);
    const call = holder.rec!.rpcs().find((c) => c.fn === "chat_send_files")!.args as Record<string, unknown>;
    expect(call).toMatchObject({ p_org: ORG, p_actor: USER, p_thread: THREAD, p_message_id: MSG, p_parent: null, p_body: "Signed" });
    expect(call.p_files).toEqual([{ id: FILE, file_name: "rate-con.pdf", mime: "application/pdf", byte_size: PDF.length, sha256: sha(PDF) }]);
    expect(fns()).not.toContain("chat_send");
  });

  it.each([
    ["not uploaded", () => { stored = null; }, "file_not_uploaded"],
    ["a different size", () => { stored = new Uint8Array([...PDF, 9]); }, "file_changed"],
    ["the same size, other bytes", () => { stored = new Uint8Array([...PDF.slice(0, -1), 9]); }, "file_changed"],
  ])("refuses a file that is %s, and writes nothing", async (_what, arrange, code) => {
    arrange();
    const res = await post(`/${THREAD}/messages`, { message_id: MSG, body: "x", files: [declared()] });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
    expect(fns()).not.toContain("chat_send_files");
  });

  it("refuses a .pdf whose bytes are not a PDF", async () => {
    stored = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // an executable's MZ header
    const res = await post(`/${THREAD}/messages`, { message_id: MSG, body: "x", files: [declared({ byte_size: 4, sha256: sha(stored) })] });
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("file_not_its_kind");
    expect(fns()).not.toContain("chat_send_files");
  });

  it("takes a line that is only files, and refuses one with neither", async () => {
    expect((await post(`/${THREAD}/messages`, { message_id: MSG, files: [declared()] })).status).toBe(201);
    expect((await post(`/${THREAD}/messages`, { message_id: MSG, body: "  " })).status).toBe(400);
  });

  it("sends words alone the old way, with no storage read", async () => {
    await post(`/${THREAD}/messages`, { message_id: MSG, body: "On it." });
    expect(fns()).toContain("chat_send");
    expect(holder.rec!.storageCalls()).toEqual([]);
  });

  it("sends a reply's files with its post as the parent", async () => {
    await post(`/channels/${THREAD}/posts/${POST}/replies`, { message_id: MSG, files: [declared()] });
    expect(holder.rec!.rpcs().find((c) => c.fn === "chat_send_files")!.args).toMatchObject({ p_parent: POST, p_body: "" });
  });

  it("maps the database's CH014 and CH015", async () => {
    rpc.chat_send_files = { error: { code: "CH015", message: "a file was not uploaded" } };
    const res = await post(`/${THREAD}/messages`, { message_id: MSG, files: [declared()] });
    expect([res.status, ((await res.json()) as { error: { code: string } }).error.code]).toEqual([422, "file_not_uploaded"]);
  });
});

describe("reading a file", () => {
  it("answers a five-minute link for somebody in its conversation, a document as a download under its name", async () => {
    const body = (await (await call(`/files/${FILE}`)).json()) as { url: string; file_name: string; byte_size: number };
    expect(holder.rec!.rpcs().find((c) => c.fn === "chat_file_for")!.args).toEqual({ p_org: ORG, p_user: USER, p_file: FILE });
    expect(body.url).toBe(`https://storage.test/read/${ORG}/${THREAD}/${FILE}?s=300&dl=rate-con.pdf`);
    expect(body.byte_size).toBe(12);
  });

  it("opens an image in the browser rather than downloading it", async () => {
    rpc.chat_file_for = [{ storage_path: `${ORG}/${THREAD}/${FILE}`, file_name: "trailer.jpg", mime: "image/jpeg", byte_size: 10 }];
    const body = (await (await call(`/files/${FILE}`)).json()) as { url: string };
    expect(body.url.endsWith("dl=")).toBe(true);
  });

  it("is a 404 for somebody not in the conversation, and a 409 once its line was removed", async () => {
    rpc.chat_file_for = { error: { code: "CH001", message: "" } };
    expect((await call(`/files/${FILE}`)).status).toBe(404);
    rpc.chat_file_for = { error: { code: "CH004", message: "" } };
    expect((await call(`/files/${FILE}`)).status).toBe(409);
    expect(holder.rec!.storageCalls()).toEqual([]);
  });

  it("refuses a driver login before any chat function runs", async () => {
    me = { ...me, role: "driver" };
    expect((await call(`/files/${FILE}`)).status).toBe(403);
    expect(fns()).toEqual([]);
  });
});

describe("bytesAreKind", () => {
  it("knows each kind's first bytes, and that text has no NUL", () => {
    expect(bytesAreKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")).toBe(true);
    expect(bytesAreKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png")).toBe(true);
    expect(bytesAreKind(new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]), "image/webp")).toBe(true);
    expect(bytesAreKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(true);
    expect(bytesAreKind(new Uint8Array(Buffer.from("a,b\n1,2\n")), "text/csv")).toBe(true);
    expect(bytesAreKind(new Uint8Array([0x61, 0x00, 0x62]), "text/plain")).toBe(false);
    expect(bytesAreKind(new Uint8Array([0xff, 0xd8, 0xff]), "image/png")).toBe(false);
  });
});
