import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The selfie beside the licence photo, and the office's reading of it (AW6, §6.7), through its HTTP
 * door. The fixture holds captures for this invitation, and a selfie of ANOTHER org's on the same
 * invitation id, so a query that forgot its org filter would serve a stranger's face.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INVITE = "10000000-0000-4000-8000-000000000001";

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = { recruiter: ctx("recruiter"), auditor: ctx("auditor"), dispatcher: ctx("dispatcher") };

const capture = (org: string, slot: string, path: string) => ({
  id: `${slot}-${org}`, org_id: org, invitation_id: INVITE, slot, storage_path: path, captured_at: "2026-09-27T14:00:00Z",
});
const OURS = [
  capture(ORG, "selfie", `${ORG}/${INVITE}/selfie.webp`),
  capture(ORG, "cdl_front", `${ORG}/${INVITE}/front.webp`),
  capture(ORG, "cdl_back", `${ORG}/${INVITE}/back.webp`),
];

const intakeTable = (rows: Array<Record<string, unknown>>) => {
  const read = postgrestFixture(rows);
  return (q: RecordedQuery) =>
    q.write?.method === "update" ? rows.filter((r) => r.org_id === ORG).map((r) => ({ invitation_id: r.invitation_id })) : read(q);
};

const seed = (over: { captures?: Array<Record<string, unknown>>; intake?: Record<string, unknown> | null; invited?: boolean; done?: boolean } = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: postgrestFixture(over.invited === false ? [] : [{
        id: INVITE, org_id: ORG, driver_id: DRIVER, created_at: "2026-09-01T00:00:00Z", revoked_at: null,
        intake_completed_at: over.done === false ? null : "2026-09-27T14:05:00Z",
      }]),
      application_captures: postgrestFixture([
        ...(over.captures ?? OURS),
        capture(OTHER, "selfie", `${OTHER}/${INVITE}/stranger.webp`),
      ]),
      application_intakes: intakeTable(over.intake === null ? [] : [{
        org_id: ORG, invitation_id: INVITE, selfie_verdict: null, selfie_verdict_at: null, ...(over.intake ?? {}),
      }]),
      audit_logs: [],
    },
    storage: {
      createSignedUrls: (paths: string[]) => ({
        data: paths.map((path) => ({ path, signedUrl: `https://signed.test/${path}` })),
        error: null,
      }),
    },
  });

let server: Server;
let baseUrl: string;

const call = (method: string, path: string, token: string, body?: unknown) =>
  fetch(`${baseUrl}/api/recruitment/applicants/${DRIVER}${path}`, {
    method,
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

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

describe("reading the two photos (AW6)", () => {
  it("signs the selfie and the licence's front — and nothing else, and nobody else's", async () => {
    const rec = seed({ intake: { selfie_verdict: "matches", selfie_verdict_at: "2026-09-27T15:00:00Z" } });
    holder.client = rec.client;
    const res = await call("GET", "/intake/selfie", "recruiter");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      partOneDone: true,
      selfie: { url: `https://signed.test/${ORG}/${INVITE}/selfie.webp`, capturedAt: "2026-09-27T14:00:00Z" },
      licenceFront: { url: `https://signed.test/${ORG}/${INVITE}/front.webp`, capturedAt: "2026-09-27T14:00:00Z" },
      verdict: { verdict: "matches", at: "2026-09-27T15:00:00Z" },
    });
    const [signed] = rec.storageCalls().filter((c) => c.fn === "createSignedUrls");
    expect(signed?.bucket).toBe("application-captures");
    // The back is not asked for; the other org's selfie is not either. Five minutes, no longer.
    expect(signed?.args).toEqual([[`${ORG}/${INVITE}/selfie.webp`, `${ORG}/${INVITE}/front.webp`], 300]);
    expectOrgScoped(rec, ORG);
  });

  it("tells a selfie skipped from one not reached yet", async () => {
    const skipped = seed({ captures: [OURS[1]!] });
    holder.client = skipped.client;
    expect(await (await call("GET", "/intake/selfie", "recruiter")).json()).toMatchObject({ partOneDone: true, selfie: null });

    const notYet = seed({ captures: [OURS[1]!], done: false });
    holder.client = notYet.client;
    expect(await (await call("GET", "/intake/selfie", "recruiter")).json()).toMatchObject({ partOneDone: false, selfie: null });
  });

  it("answers an applicant with no live link with nothing, and signs nothing", async () => {
    const rec = seed({ invited: false });
    holder.client = rec.client;
    expect(await (await call("GET", "/intake/selfie", "recruiter")).json()).toEqual({
      partOneDone: false, selfie: null, licenceFront: null, verdict: null,
    });
    expect(rec.storageCalls()).toHaveLength(0);
  });

  it("is the recruitment section's: an auditor reads, a dispatcher does not", async () => {
    holder.client = seed().client;
    expect((await call("GET", "/intake/selfie", "auditor")).status).toBe(200);
    expect((await call("GET", "/intake/selfie", "dispatcher")).status).toBe(403);
  });
});

describe("recording the reading (AW6)", () => {
  it("writes the reading, who and when on the live invitation's intake row, and audits it without a URL", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("POST", "/intake/selfie-verdict", "recruiter", { verdict: "does_not_match" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { verdict: string; at: string };
    expect(body.verdict).toBe("does_not_match");

    const [row] = rec.writtenRows("application_intakes");
    expect(row).toMatchObject({ selfie_verdict: "does_not_match", selfie_verdict_by: "u-recruiter", selfie_verdict_at: body.at });
    const update = rec.queries.find((q) => q.table === "application_intakes" && q.write?.method === "update");
    expect(update?.filters()).toEqual(expect.arrayContaining([{ col: "invitation_id", val: INVITE }]));

    const [audit] = rec.writtenRows("audit_logs") as Array<{ action: string; meta: Record<string, unknown> }>;
    expect(audit).toMatchObject({
      action: "recruiting.selfie_verdict_recorded",
      meta: { driverId: DRIVER, invitationId: INVITE, verdict: "does_not_match" },
    });
    expect(JSON.stringify(audit)).not.toContain("webp");
    expectOrgScoped(rec, ORG);
  });

  it("refuses a reading of a photo nobody took, and writes nothing", async () => {
    const rec = seed({ captures: [OURS[1]!] });
    holder.client = rec.client;
    const res = await call("POST", "/intake/selfie-verdict", "recruiter", { verdict: "matches" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("no_selfie");
    expect(rec.writtenRows("application_intakes")).toHaveLength(0);
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });

  it("refuses an applicant with no live link, and a reading outside 0376's three words", async () => {
    holder.client = seed({ invited: false }).client;
    expect((await call("POST", "/intake/selfie-verdict", "recruiter", { verdict: "matches" })).status).toBe(409);
    holder.client = seed().client;
    expect((await call("POST", "/intake/selfie-verdict", "recruiter", { verdict: "probably" })).status).toBe(400);
  });

  it("reports a write that touched no row as a failure, not a reading", async () => {
    const rec = seed({ intake: null });
    holder.client = rec.client;
    expect((await call("POST", "/intake/selfie-verdict", "recruiter", { verdict: "matches" })).status).toBe(500);
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });

  it("is a manage act: an auditor may look and may not record", async () => {
    holder.client = seed().client;
    expect((await call("POST", "/intake/selfie-verdict", "auditor", { verdict: "matches" })).status).toBe(403);
  });
});
