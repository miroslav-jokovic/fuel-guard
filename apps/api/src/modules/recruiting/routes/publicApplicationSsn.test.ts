import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { hashInvitationToken } from "../applicationIntake.js";
import { open, secretAad } from "../../../lib/secretBox.js";

/**
 * The SSN in the form, over HTTP (Q-AM3, 0589; `applicantSsn.ts`).
 *
 * What is pinned: the nine digits reach `record_applicant_ssn` SEALED, with the last four beside them
 * and the org from the token, never the request; the answer carries only the last four; a malformed
 * number is refused before any write; and the window closes at the driver's first packet mark, as
 * every other answer's does.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const TOKEN = "d".repeat(43);
const INV = "11111111-2222-4333-8444-555555555555";

let server: Server;
let baseUrl: string;
let seq = 0;
const post = (path: string, body?: unknown) =>
  fetch(`${baseUrl}/api/public/application/${TOKEN}${path}`, {
    method: "POST",
    // A distinct address per call — the surface is rate limited per IP (see publicApplication.test.ts).
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${(seq++ % 250) + 1}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

type Row = Record<string, unknown>;
interface Answer {
  ok?: boolean;
  last4?: string;
  error?: { code: string; message: string };
}
const read = async (res: Response): Promise<Answer> => (await res.json()) as Answer;

const KEY = Buffer.alloc(32, 7).toString("base64");
const ENV = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: KEY } as NodeJS.ProcessEnv);

const seed = (opts: { invitation?: Row; marks?: number; rpc?: Record<string, unknown> } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: [{
        id: INV, org_id: ORG, driver_id: DRIVER, token_hash: hashInvitationToken(TOKEN),
        expires_at: "2099-01-01T00:00:00Z", revoked_at: null, consented_at: "2026-09-26T08:00:00Z",
        intake_completed_at: null, releases_completed_at: null, submitted_at: null,
        ...opts.invitation,
      }],
      // `signingStarted` asks for a count (head: true), so the fixture answers with one.
      application_packet_marks: { data: [], count: opts.marks ?? 0 },
    },
    rpc: { record_applicant_ssn: null, ...opts.rpc },
  });
/** The token lookup cannot carry an org — the token finds it; the carrier's wording is read BY its id. */
const TOKEN_LOOKUP = { exempt: ["application_invitations", "organizations", "org_disclosures"] };

beforeAll(async () => {
  const app = createApp(ENV);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

describe("the SSN, from the form", () => {
  it("writes it sealed with its last four, from the token's own org, and answers with the last four only", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post("/ssn", { ssn: "123-45-6789" });
    expect(res.status).toBe(201);
    expect(await read(res)).toEqual({ ok: true, last4: "6789" });
    const [call] = rec.rpcs();
    expect(call!.fn).toBe("record_applicant_ssn");
    const args = call!.args as Row;
    expect(args).toMatchObject({ p_org: ORG, p_invitation: INV, p_driver: DRIVER, p_last4: "6789", p_entered_by: "applicant" });
    // Sealed: not readable as stored, and it opens to the nine digits only under this org's purpose.
    expect(String(args.p_sealed)).not.toContain("123456789");
    expect(open(ENV, String(args.p_sealed), secretAad(ORG, "driver_ssn"))).toBe("123456789");
    expectOrgScoped(rec, ORG, TOKEN_LOOKUP);
  });

  it("refuses a number that is not nine digits, and writes nothing", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post("/ssn", { ssn: "12345" });
    expect(res.status).toBe(400);
    expect(rec.rpcs()).toEqual([]);
  });

  it("is closed once the driver has started signing, like every other answer", async () => {
    const rec = seed({ marks: 1 });
    holder.client = rec.client;
    const res = await post("/ssn", { ssn: "123456789" });
    expect(res.status).toBe(409);
    expect((await read(res)).error?.code).toBe("application_not_editable");
    expect(rec.rpcs()).toEqual([]);
  });

  it("refuses a filed application, and a dead link says nothing more than any dead link", async () => {
    const filed = seed({ invitation: { submitted_at: "2026-11-01T00:00:00Z" } });
    holder.client = filed.client;
    expect((await post("/ssn", { ssn: "123456789" })).status).toBe(409);
    const dead = seed({ invitation: { revoked_at: "2026-11-01T00:00:00Z" } });
    holder.client = dead.client;
    const res = await post("/ssn", { ssn: "123456789" });
    expect(res.status).toBe(404);
    expect((await read(res)).error?.code).toBe("invalid_link");
    expect(dead.rpcs()).toEqual([]);
  });
});
