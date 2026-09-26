import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { hashInvitationToken } from "../applicationIntake.js";

/**
 * Part 1 of the link, end to end over HTTP (APPLICATION-FLOW-V2-PLAN §6.2, AW2).
 *
 * What is pinned: the answers reach `record_applicant_intake` fill-only and with no tenant from the
 * request; the licence list's order IS its positions; the function's refusals come back as words a
 * phone can show; finishing files Part 1's own photographs and nothing staged beside them, once; and
 * a v2 link cannot sign a permission before Part 1 is finished while a legacy link still can.
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
  keptExisting?: string[];
  licenceCount?: number;
  intakeCompletedAt?: string;
  error?: { code: string; message: string };
}
const read = async (res: Response): Promise<Answer> => (await res.json()) as Answer;

const STAGED = [
  { id: "cap-front", slot: "cdl_front", storage_path: "s/front.webp", content_type: "image/webp", bytes: 10, sha256: "a".repeat(64), captured_at: "2026-09-26T10:00:00Z" },
  { id: "cap-back", slot: "cdl_back", storage_path: "s/back.webp", content_type: "image/webp", bytes: 10, sha256: "b".repeat(64), captured_at: "2026-09-26T10:01:00Z" },
  { id: "cap-mark", slot: "signature_mark", storage_path: "s/mark.png", content_type: "image/png", bytes: 10, sha256: "c".repeat(64), captured_at: "2026-09-26T10:02:00Z" },
];

/**
 * A link, and the captures it staged. `application_captures` is a FUNCTION fixture that honours the
 * `.in("slot", …)` filter the promotion applies — a flat array would hand back the signature mark too,
 * and the test could not tell a promotion that filtered from one that did not.
 */
const seed = (opts: { invitation?: Row; intake?: Row[]; rpc?: Record<string, unknown> } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: [{
        id: INV, org_id: ORG, driver_id: DRIVER, token_hash: hashInvitationToken(TOKEN),
        expires_at: "2099-01-01T00:00:00Z", revoked_at: null, consented_at: "2026-09-26T08:00:00Z",
        intake_completed_at: null, releases_completed_at: null, submitted_at: null,
        ...opts.invitation,
      }],
      application_intakes: opts.intake ?? [],
      application_captures: (q: RecordedQuery) => {
        const slots = q.filters().find((f) => f.col === "slot")?.val as string[] | undefined;
        return slots ? STAGED.filter((c) => slots.includes(c.slot)) : STAGED;
      },
    },
    rpc: {
      record_applicant_intake: { intake_id: "intake-1", licence_count: 2, kept_existing: ["phone"] },
      complete_applicant_intake: "2026-09-26T12:00:00.000Z",
      ...opts.rpc,
    },
  });
/** The token lookup cannot carry an org — the token finds it; the carrier's name and wording are read BY its id. */
const TOKEN_LOOKUP = { exempt: ["application_invitations", "organizations", "org_disclosures"] };

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

describe("Part 1 answers", () => {
  it("writes the answers fill-only, from the token's own org, and answers with names never values", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post("/intake", {
      prior_positive_2y: false, phone: "(708) 236-5732", state: "il", postal_code: "60601",
      endorsements: ["N", "H"],
    });
    expect(res.status).toBe(201);
    expect(await read(res)).toEqual({ ok: true, keptExisting: ["phone"] });

    const [call] = rec.rpcs();
    expect(call!.fn).toBe("record_applicant_intake");
    expect(call!.args).toEqual({
      p_org: ORG,
      p_invitation: INV,
      p_driver: DRIVER,
      // The phone normalised to what 0376 CHECKs, the state upper-cased; endorsements travel apart.
      p_intake: { prior_positive_2y: false, phone: "+17082365732", state: "IL", postal_code: "60601" },
      p_licences: null,
      p_endorsements: ["N", "H"],
      p_overwrite: false,
    });
    expectOrgScoped(rec, ORG, TOKEN_LOOKUP);
  });

  it("refuses a number the SMS provider could never text, before anything is written", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post("/intake", { prior_positive_2y: false, phone: "+44 20 7946 0958" });
    expect(res.status).toBe(400);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses a key the function would silently ignore", async () => {
    holder.client = seed().client;
    const res = await post("/intake", { prior_positive_2y: false, ssn: "123456789" });
    expect(res.status).toBe(400);
  });

  it("says the §40.25(j) question comes first when the function refuses AI009", async () => {
    holder.client = seed({ rpc: { record_applicant_intake: { error: { code: "AI009", message: "prior_positive_required" } } } }).client;
    const res = await post("/intake", { phone: "7082365732" });
    expect(res.status).toBe(409);
    expect((await read(res)).error?.code).toBe("prior_positive_required");
  });

  it("refuses the applicant once Part 1 is finished, without reaching the function", async () => {
    const rec = seed({ invitation: { intake_completed_at: "2026-09-26T11:00:00Z" } });
    holder.client = rec.client;
    const res = await post("/intake", { prior_positive_2y: true });
    expect(res.status).toBe(409);
    expect((await read(res)).error?.code).toBe("intake_frozen");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("answers a revoked link the way every dead link is answered", async () => {
    holder.client = seed({ invitation: { revoked_at: "2026-09-01T00:00:00Z" } }).client;
    const res = await post("/intake", { prior_positive_2y: false });
    expect(res.status).toBe(404);
    expect((await read(res)).error?.code).toBe("invalid_link");
  });
});

describe("the licence list", () => {
  it("sends the list whole, its order as the positions — the current CDL at 0", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post("/intake/licences", {
      licences: [
        { state_code: "il", licence_number: " D123-4567-8901 ", expires_on: "2029-05-01" },
        { state_code: "IN", licence_number: "1234-56-7890", agency: "Indiana BMV" },
      ],
    });
    expect(res.status).toBe(201);
    expect(await read(res)).toEqual({ ok: true, keptExisting: ["phone"], licenceCount: 2 });
    const args = rec.rpcs()[0]!.args as Row;
    expect(args.p_intake).toEqual({});
    expect(args.p_licences).toEqual([
      { position: 0, state_code: "IL", agency: null, licence_number: "D123-4567-8901", expires_on: "2029-05-01", source: "intake" },
      { position: 1, state_code: "IN", agency: "Indiana BMV", licence_number: "1234-56-7890", expires_on: null, source: "intake" },
    ]);
  });

  it("refuses a jurisdiction that is not one, and the same licence twice", async () => {
    holder.client = seed().client;
    expect((await post("/intake/licences", { licences: [{ state_code: "ZZ", licence_number: "1" }] })).status).toBe(400);
    const twice = await post("/intake/licences", {
      licences: [{ state_code: "IL", licence_number: "abc" }, { state_code: "il", licence_number: "ABC" }],
    });
    expect(twice.status).toBe(400);
  });
});

describe("finishing Part 1", () => {
  it("files Part 1's photographs and nothing staged beside them, then stamps once", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post("/intake/complete");
    expect(res.status).toBe(201);
    expect(await read(res)).toEqual({ ok: true, intakeCompletedAt: "2026-09-26T12:00:00.000Z" });

    const copied = rec.storageCalls().filter((c) => c.fn === "copy").map((c) => c.args[0]);
    expect(copied).toEqual(["s/front.webp", "s/back.webp"]);
    const call = rec.rpcs().find((r) => r.fn === "complete_applicant_intake")!;
    const captures = (call.args as { p_captures: Array<{ capture_id: string; kind: string }> }).p_captures;
    expect(captures.map((c) => c.capture_id)).toEqual(["cap-front", "cap-back"]);
    expect(captures.every((c) => c.kind === "cdl")).toBe(true);
    // The act, audited with the invitation and a count — never an answer.
    const audit = rec.writtenRows("audit_logs")[0]!;
    expect(audit).toMatchObject({ action: "application_intake_completed", entity_id: INV });
    expect(JSON.stringify(audit)).not.toMatch(/60601|708/);
  });

  it("answers a second press with the first stamp and files nothing", async () => {
    const rec = seed({ invitation: { intake_completed_at: "2026-09-26T11:00:00Z" } });
    holder.client = rec.client;
    const res = await post("/intake/complete");
    expect(res.status).toBe(201);
    expect((await read(res)).intakeCompletedAt).toBe("2026-09-26T11:00:00Z");
    expect(rec.rpcs()).toHaveLength(0);
    expect(rec.storageCalls()).toHaveLength(0);
  });

  it("says what is missing when the function refuses AI007", async () => {
    holder.client = seed({ rpc: { complete_applicant_intake: { error: { code: "AI007", message: "intake_incomplete" } } } }).client;
    const res = await post("/intake/complete");
    expect(res.status).toBe(409);
    const body = await read(res);
    expect(body.error?.code).toBe("intake_incomplete");
    expect(body.error?.message).toMatch(/both sides of your licence/);
  });
});

describe("the permissions wait for Part 1 on a v2 link", () => {
  const sign = () => post("/release", { purpose: "psp", signed_name: "Ana Driver", esign_consent: true });

  it("refuses a v2 link whose Part 1 is not finished", async () => {
    holder.client = seed({ intake: [{ id: "intake-1" }] }).client;
    const res = await sign();
    expect(res.status).toBe(409);
    expect((await read(res)).error?.code).toBe("intake_incomplete");
  });

  it("lets a legacy link (no Part 1 row) past this check to its old rules", async () => {
    holder.client = seed().client;
    const res = await sign();
    // It stops at the identity rule it always had — the point is that it is NOT `intake_incomplete`.
    expect((await read(res)).error?.code).toBe("identity_missing");
  });
});
