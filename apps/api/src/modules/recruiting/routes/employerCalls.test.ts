import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PHONE_CALL_WORDING_VERSION, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { uncopiedCallSummaries } from "../applicantEmployerCalls.js";

/**
 * The office's phone calls to previous employers before filing (D-AW8, APPLICATION-FLOW-V2-PLAN §6.5,
 * C2b3) through its HTTP door, and the summaries filing copies them with.
 *
 * ⚠ The draft is the only source of an employer: a call names a KEY, and the name on the row is the
 * draft's. So the fixture's draft holds a keyed employer, a keyless one (typed before AW1) and a blank
 * entry, and the refusals are measured against each.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INVITE = "10000000-0000-4000-8000-000000000001";
const KEY = "40000000-0000-4000-8000-00000000000a";
const NEW_CALL = "50000000-0000-4000-8000-000000000009";

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = { recruiter: ctx("recruiter"), auditor: ctx("auditor"), dispatcher: ctx("dispatcher") };

const ALL_CONFIRMED = { dates: "confirmed", position: "confirmed", reason: "confirmed", cmv: "confirmed", dot_tested: "confirmed" };
const CALL = {
  employer_key: KEY,
  answered_by: "Dana Whitfield, safety director",
  called_at: "2026-09-24T10:15",
  outcomes: { ...ALL_CONFIRMED, reason: "corrected" },
  corrections: { reason: "Laid off when the Joliet terminal closed" },
};

const EMPLOYERS = [
  { key: KEY, employer_name: "Kowlage Haulage", started_on: "2023-01-01", ended_on: "2025-06-30", phone: "815-555-0100", dot_regulated: true },
  { employer_name: "Rivergate Freight", started_on: "2025-07-01" },
  { key: "", employer_name: "   " },
];

const callsTable = (rows: Array<Record<string, unknown>>) => {
  const read = postgrestFixture(rows);
  return (q: RecordedQuery) => {
    if (q.write?.method === "insert") {
      return [{ id: NEW_CALL, copied_inquiry_id: null, ...(q.write.payload as Record<string, unknown>) }];
    }
    return read(q);
  };
};

const seed = (over: { submitted?: boolean; calls?: Array<Record<string, unknown>> } = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: postgrestFixture([{
        id: INVITE, org_id: ORG, driver_id: DRIVER, created_at: "2026-09-01T00:00:00Z", revoked_at: null,
        submitted_at: over.submitted ? "2026-09-25T00:00:00Z" : null,
      }]),
      // The draft's real shape: the service's path select has to reach `payload->employers` itself.
      application_drafts: postgrestFixture([{ id: "dr-1", org_id: ORG, invitation_id: INVITE, payload: { employers: EMPLOYERS } }]),
      employer_verification_calls: callsTable(over.calls ?? [
        { id: "call-other-org", org_id: OTHER, invitation_id: INVITE, employer_key: KEY, employer_name: "X",
          outcomes: ALL_CONFIRMED, corrections: null, answered_by: "x", called_at: "2026-09-20T15:00:00Z", copied_inquiry_id: null },
      ]),
      organizations: postgrestFixture([{ id: ORG, operating_hours: { tz: "America/Chicago" } }]),
      audit_logs: [],
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

describe("recording a call (D-AW8)", () => {
  it("files it under the draft's employer, by key, in the carrier's clock", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("POST", "/employer-calls", "recruiter", CALL);
    expect(res.status).toBe(201);

    const [row] = rec.writtenRows("employer_verification_calls");
    expect(row).toMatchObject({
      org_id: ORG, invitation_id: INVITE, employer_key: KEY, called_by: "u-recruiter",
      // The name is the DRAFT's — the request never carries one.
      employer_name: "Kowlage Haulage",
      answered_by: "Dana Whitfield, safety director",
      // 10:15 in Chicago on 2026-09-24 is CDT, UTC-5.
      called_at: "2026-09-24T15:15:00.000Z",
      outcomes: CALL.outcomes,
      corrections: { reason: "Laid off when the Joliet terminal closed" },
    });
    expectOrgScoped(rec, ORG);

    const [audit] = rec.writtenRows("audit_logs") as Array<{ action: string; meta: Record<string, unknown> }>;
    expect(audit).toMatchObject({ action: "recruiting.employer_call_recorded", meta: { employerKey: KEY } });
    // Who answered and what they said stay in the investigation file, not the log.
    expect(JSON.stringify(audit)).not.toContain("Dana");
    expect(JSON.stringify(audit)).not.toContain("Joliet");
  });

  it("refuses a corrected answer with no correction, naming it", async () => {
    holder.client = seed().client;
    const res = await call("POST", "/employer-calls", "recruiter", { ...CALL, corrections: null });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("corrected");
  });

  it("refuses a key the draft does not hold, writing nothing", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("POST", "/employer-calls", "recruiter", { ...CALL, employer_key: "40000000-0000-4000-8000-0000000000ff" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("employer_not_on_application");
    expect(rec.writtenRows("employer_verification_calls")).toHaveLength(0);
  });

  it("refuses once the application is filed — the inquiry queue records it from then on", async () => {
    const rec = seed({ submitted: true });
    holder.client = rec.client;
    const res = await call("POST", "/employer-calls", "recruiter", CALL);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("already_filed");
    expect(rec.writtenRows("employer_verification_calls")).toHaveLength(0);
  });

  it("is the recruitment section's to write: a viewer may read, and may not record", async () => {
    holder.client = seed().client;
    expect((await call("POST", "/employer-calls", "auditor", CALL)).status).toBe(403);
    expect((await call("GET", "/employer-calls", "auditor")).status).toBe(200);
    expect((await call("GET", "/employer-calls", "dispatcher")).status).toBe(403);
  });
});

describe("reading the calls", () => {
  it("offers the draft's named employers — a keyless one as uncallable — and this org's calls only", async () => {
    const rec = seed();
    holder.client = rec.client;
    const body = (await (await call("GET", "/employer-calls", "recruiter")).json()) as {
      employers: Array<{ key: string | null; name: string }>; calls: unknown[]; filed: boolean; timeZone: string;
    };
    expect(body.employers.map((e) => [e.name, e.key])).toEqual([["Kowlage Haulage", KEY], ["Rivergate Freight", null]]);
    expect(body.calls).toEqual([]);
    expect(body.filed).toBe(false);
    expect(body.timeZone).toBe("America/Chicago");
    expectOrgScoped(rec, ORG);
  });
});

describe("what filing copies (D-AW8, 0376's DA043)", () => {
  it("renders one summary per uncopied call, from the stored row, in the carrier's zone", async () => {
    const rec = seed({
      calls: [
        { id: "c1", org_id: ORG, invitation_id: INVITE, employer_key: KEY, employer_name: "Kowlage Haulage",
          outcomes: CALL.outcomes, corrections: CALL.corrections, answered_by: "Dana Whitfield",
          called_at: "2026-09-24T15:15:00Z", copied_inquiry_id: null },
        { id: "c2", org_id: ORG, invitation_id: INVITE, employer_key: KEY, employer_name: "Kowlage Haulage",
          outcomes: ALL_CONFIRMED, corrections: null, answered_by: "x", called_at: "2026-09-20T15:00:00Z",
          copied_inquiry_id: "inq-already" },
      ],
    });
    const summaries = await uncopiedCallSummaries(rec.client as never, ORG, INVITE);
    expect(Object.keys(summaries)).toEqual(["c1"]);
    expect(summaries.c1).toContain("Kowlage Haulage");
    expect(summaries.c1).toContain("2026-09-24 10:15 (America/Chicago)");
    expect(summaries.c1).toContain('Reason for leaving: Corrected — "Laid off when the Joliet terminal closed".');
    expect(summaries.c1).toContain("Dates of employment: Confirmed.");
    expectOrgScoped(rec, ORG);
  });

  /** The version 0376 writes beside every copied call names the summary's text; a drift would mislabel it. */
  it("is versioned by the string migration 0376 writes", () => {
    const sql = readFileSync(new URL("../../../../../../supabase/migrations/0376_applicant_flow_v2.sql", import.meta.url), "utf8");
    expect(sql).toContain(`'${PHONE_CALL_WORDING_VERSION}'`);
  });

  it("is empty when nothing is owed a copy", async () => {
    expect(await uncopiedCallSummaries(seed({ calls: [] }).client as never, ORG, INVITE)).toEqual({});
  });
});
