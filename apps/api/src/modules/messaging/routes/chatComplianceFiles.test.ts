import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { STEP_UP_TOKEN_HEADER, mintStepUpToken } from "../../../lib/stepUpToken.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `POST /api/chat/compliance/files/:id/link` (0544, OFFICE-CHAT-PLAN §9.3). 0544's rules — the file is
 * this organisation's, the act is ledgered with its reason before the key is answered — run in
 * `supabase/tests/office-chat-compliance-files.test.mjs`. What this holds the ROUTE to: the console's door
 * (settings section, step-up), the caller from the token, a link of five minutes that SAVES the file
 * under its own name, an `audit_logs` row beside the ledger's, and the refusals answered before anything
 * is signed or recorded.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "11111111-1111-4111-8111-111111111111";
const THREAD = "33333333-3333-4333-8333-333333333333";
const FILE = "66666666-6666-4666-8666-000000000001";
const REASON = { category: "legal", text: "Litigation hold for matter 2026-CV-118" };

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
let me: AuthContext = { userId: USER, email: "ana@example.test", orgId: ORG, role: "admin" };
let rpc: Record<string, unknown> = {};

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
  me = { userId: USER, email: "ana@example.test", orgId: ORG, role: "admin" };
  rpc = { org_module_enabled: true, chat_compliance_file: [{ storage_path: `${ORG}/${THREAD}/${FILE}`, file_name: "BOL.pdf", mime: "application/pdf", byte_size: "9000" }] };
  holder.rec = createSupabaseRecorder({
    rpc: (fn) => rpc[fn],
    storage: {
      createSignedUrl: (path: string, secs: number, opts?: { download?: string }) =>
        ({ data: { signedUrl: `https://storage.test/read/${path}?s=${secs}&dl=${opts?.download ?? ""}` }, error: null }),
    },
    tables: { audit_logs: () => ({ data: [] }) },
  });
});

const stepUp = () => ({ [STEP_UP_TOKEN_HEADER]: mintStepUpToken(env, me.userId, me.orgId!)!.token });
const link = (id: string, body: unknown, headers: Record<string, string> = stepUp()) =>
  fetch(`${baseUrl}/api/chat/compliance/files/${id}/link`, {
    method: "POST", body: JSON.stringify(body), headers: { Authorization: "Bearer token", "Content-Type": "application/json", ...headers },
  });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();
const fileCalls = () => holder.rec!.rpcs().filter((c) => c.fn === "chat_compliance_file");
const signed = () => holder.rec!.storageCalls().filter((c) => c.fn === "createSignedUrl");
const audits = () => holder.rec!.writtenRows("audit_logs") as Array<Record<string, unknown>>;

describe("a reviewer's link to one chat file", () => {
  it("asks the database with the caller and the reason, then signs five minutes that save the file under its name", async () => {
    const res = await link(FILE, { reason: REASON });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ url: `https://storage.test/read/${ORG}/${THREAD}/${FILE}?s=300&dl=BOL.pdf`, file_name: "BOL.pdf", expires_in: 300 });
    expect(fileCalls().map((c) => c.args)).toEqual([{ p_org: ORG, p_actor: USER, p_reason: REASON, p_file: FILE }]);
    expect(signed()[0]!.bucket).toBe("chat-files");
  });

  it("writes an audit_logs row naming the file and the reason", async () => {
    await link(FILE, { reason: REASON });
    expect(audits()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({ org_id: ORG, actor_id: USER, action: "chat_compliance.file" });
    expect(audits()[0]!.meta).toMatchObject({ category: "legal", reason: REASON.text, file_id: FILE });
  });

  it("does nothing without a step-up, without a reason, or for an id that is not one", async () => {
    expect((await link(FILE, { reason: REASON }, {})).status).toBe(403);
    expect((await link(FILE, {})).status).toBe(400);
    expect((await link("not-an-id", { reason: REASON })).status).toBe(404);
    expect(fileCalls()).toEqual([]);
    expect(signed()).toEqual([]);
    expect(audits()).toEqual([]);
  });

  it("another organisation's file is a 404 from the database: nothing signed, nothing audited", async () => {
    rpc.chat_compliance_file = { error: { code: "CH001", message: "no such file in this organisation" } };
    const res = await link(FILE, { reason: REASON });
    expect(res.status).toBe(404);
    expect((await json(res)).error.message).toBe("That file does not exist");
    expect(signed()).toEqual([]);
    expect(audits()).toEqual([]);
  });

  it("a role without the settings section is refused before the database is asked", async () => {
    me = { ...me, role: "dispatcher" };
    expect((await link(FILE, { reason: REASON })).status).toBe(403);
    expect(fileCalls()).toEqual([]);
  });
});
