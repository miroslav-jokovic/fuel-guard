import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext, LeadContactRecord } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { LEAD_CONTACTS_MAX } from "../leads/leadContacts.js";

/**
 * `GET /recruitment/leads/:id/contacts` (E4a) through the mount: the doors, the org scope, the order, and what
 * a purged lead still answers. Its own file because `leads.test.ts` sits at the size budget.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const LEAD = "50000000-0000-4000-8000-000000000001";
const QUIET = "50000000-0000-4000-8000-000000000002";
const PURGED = "50000000-0000-4000-8000-000000000005";
const THEIRS = "50000000-0000-4000-8000-000000000009";

const LEADS = [
  { id: LEAD, org_id: ORG, purged_at: null },
  { id: QUIET, org_id: ORG, purged_at: null },
  { id: PURGED, org_id: ORG, purged_at: "2026-11-01T00:00:00Z" },
  { id: THEIRS, org_id: OTHER_ORG, purged_at: null },
];
const contact = (id: string, lead: string, at: string, note: string | null, org = ORG) => ({
  id, org_id: org, lead_id: lead, direction: "outbound", method: "call", outcome: "no_answer", note,
  created_by: "u-recruiter", created_by_name: "Dana Recruiter", contacted_at: at, created_at: at,
});
const CONTACTS = [
  contact("c-older", LEAD, "2026-11-02T09:00:00Z", "Left a message"),
  contact("c-newer", LEAD, "2026-11-03T09:00:00Z", null),
  contact("c-purged-note", PURGED, "2026-10-30T09:00:00Z", "Ray said his wife answers this number"),
  contact("c-purged-bare", PURGED, "2026-10-29T09:00:00Z", null),
  contact("c-theirs", THEIRS, "2026-11-03T09:00:00Z", "Another carrier's note", OTHER_ORG),
];

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = Object.fromEntries(["admin", "recruiter", "auditor", "dispatcher", "driver"].map((r) => [r, ctx(r)]));

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const read = (lead: string, token = "recruiter") =>
  fetch(`${baseUrl}/api/recruitment/leads/${lead}/contacts`, { headers: { Authorization: `Bearer ${token}` } });
const contactsOf = async (res: Response) => ((await res.json()) as { contacts: LeadContactRecord[] }).contacts;

/** The fixture applies the query's own filters and, unlike `postgrestFixture`, its order and limit: those are what is under test. */
function contactRows(q: RecordedQuery) {
  const rows = postgrestFixture(CONTACTS)(q) as typeof CONTACTS;
  const order = q.ops.find((o) => o.method === "order");
  const ordered = order?.args[0] === "contacted_at" && (order.args[1] as { ascending: boolean }).ascending === false
    ? [...rows].sort((a, b) => b.contacted_at.localeCompare(a.contacted_at))
    : rows;
  const limit = q.ops.find((o) => o.method === "limit");
  return limit ? ordered.slice(0, limit.args[0] as number) : ordered;
}

function seed(over: { contactError?: boolean } = {}): void {
  rec = createSupabaseRecorder({
    tables: {
      recruiting_leads: postgrestFixture(LEADS),
      recruiting_contacts: (q: RecordedQuery) => (over.contactError ? { data: null, error: { message: "refused" } } : contactRows(q)),
      audit_logs: [],
    },
  });
  holder.client = rec.client;
}

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

describe("reading who already contacted a lead (E4a)", () => {
  it("is read by anyone who can view recruiting, newest first, scoped to the carrier, and writes nothing", async () => {
    seed();
    const res = await read(LEAD, "auditor");
    expect(res.status).toBe(200);
    expect((await contactsOf(res)).map((c) => c.id)).toEqual(["c-newer", "c-older"]);
    expectOrgScoped(rec, ORG);
    expect(rec.writtenRows("audit_logs")).toEqual([]);
  });

  it("names the person who made the contact and keeps their user id and the carrier's id behind", async () => {
    seed();
    const [newest, older] = await contactsOf(await read(LEAD));
    expect(older).toEqual({
      id: "c-older", direction: "outbound", method: "call", outcome: "no_answer", note: "Left a message",
      note_withheld: false, created_by_name: "Dana Recruiter", contacted_at: "2026-11-02T09:00:00Z",
    });
    expect(newest).toMatchObject({ note: null, note_withheld: false });
  });

  it("bounds the read at its limit", async () => {
    seed();
    await read(LEAD);
    const q = rec.queries.find((r) => r.table === "recruiting_contacts")!;
    expect(q.ops.find((o) => o.method === "limit")?.args[0]).toBe(LEAD_CONTACTS_MAX);
  });

  it("a lead nobody has contacted answers an empty list, not a refusal", async () => {
    seed();
    const res = await read(QUIET);
    expect(res.status).toBe(200);
    expect(await contactsOf(res)).toEqual([]);
  });

  it("a purged lead keeps its contacts as evidence and withholds their notes until counsel rules", async () => {
    seed();
    const res = await read(PURGED, "auditor");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("wife");
    const { contacts } = JSON.parse(body) as { contacts: LeadContactRecord[] };
    expect(contacts.map((c) => [c.id, c.note, c.note_withheld, c.created_by_name])).toEqual([
      ["c-purged-note", null, true, "Dana Recruiter"],
      ["c-purged-bare", null, false, "Dana Recruiter"],
    ]);
  });

  it("another carrier's lead, an unknown lead and a malformed id all read as no lead", async () => {
    seed();
    expect((await read(THEIRS)).status).toBe(404);
    expect((await read("50000000-0000-4000-8000-0000000000ff")).status).toBe(404);
    expect(rec.queries.filter((q) => q.table === "recruiting_contacts")).toEqual([]);
    const before = rec.queries.length;
    expect((await read("not-a-uuid")).status).toBe(404);
    expect(rec.queries).toHaveLength(before);
  });

  it("is closed to roles outside recruiting", async () => {
    seed();
    expect((await read(LEAD, "dispatcher")).status).toBe(403);
    expect((await read(LEAD, "driver")).status).toBe(403);
    expect(rec.queries).toEqual([]);
  });

  it("a read that fails says so rather than showing a lead nobody called", async () => {
    seed({ contactError: true });
    expect((await read(LEAD)).status).toBe(500);
  });
});
