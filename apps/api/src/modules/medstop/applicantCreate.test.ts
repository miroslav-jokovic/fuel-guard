import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MedstopApplicantFacts } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { MedstopClient } from "./client.js";
import { MEDSTOP_CREATES_PER_SWEEP, createMedstopApplicants, readApplicantCreate } from "./applicantCreate.js";

/**
 * Creating the applicant in Med-Stop when Part 1 is complete (UX5c, MEDSTOP-PLAN §7A.13). Every
 * create is a real person in the carrier's real account (no test host), so what is proved is what is
 * NOT sent: ordering off sends nothing; an applicant already tried, already in Med-Stop, or who
 * declined is skipped; the attempt is claimed before the one POST and never retried; and what IS sent
 * is Med-Stop's own blank form, every key kept.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** `GET /Employee/new` as measured 2026-10-13 — blanks only, so nobody's data. */
const BLANK: Record<string, unknown> = {
  id: "", employerid: "EMPLOYER-1", employeeid: "", eeid: "", dot: "Y", dotagency: "FMCSA", branch: "",
  branchid: "BRANCH-1", ssn: "", birthdate: null, lname: "", fname: "", mname: "", gender: "", eyes: "",
  hair: "", status: "", dotstatus: "Y", applicationdate: "2026-10-13T00:00:00Z", startdate: "2026-10-13T00:00:00Z",
  annualreview: "2027-10-13T00:00:00Z", medexpiration: null, code: "", position: "", category: "", address: "",
  address1: "", city: "", state: "", zip: "", country: "US", phone1: "", fax1: "", email: "", emergencycontact: "",
  drivingtype: "", idclass: "", license: "", licensestate: "", licenseclass: "", licenseexpiration: null,
  licenserestrictions: "", licenseendorsements: "", idnumber: "", idstate: "", idexpiration: null,
};

const person = (n: number, over: Partial<MedstopApplicantFacts> = {}): MedstopApplicantFacts => ({
  invitationId: `inv-${n}`, driverId: `d-${n}`, firstName: "Ann", middleName: null, lastName: "Driver",
  birthDate: "1985-03-07", gender: "female", addressLine1: "12 Depot Rd", addressLine2: null, city: "Joliet",
  state: "IL", postalCode: "60432", phone: "+13125550142", licenceNumber: `D${n}`, licenceState: "IL",
  licenceExpiresOn: "2029-01-31", cdlClass: "A", ...over,
});

const credential = (ordersEnabled: boolean) => [{
  base_url: "https://api.med-stop.com", enabled: true, api_key_sealed: "sealed", key_expires_on: null, last_synced_at: null,
  last_error: null, orders_enabled: ordersEnabled, order_contact_email: "der@silvicom.test", order_contact_phone: "3125550100",
}];

function db(opts: { orders?: boolean; attempted?: string[]; held?: string[]; claimError?: unknown } = {}) {
  return createSupabaseRecorder({
    tables: {
      medstop_credentials: credential(opts.orders ?? true),
      medstop_employees: (opts.held ?? []).map((driver_id) => ({ driver_id })),
      medstop_applicant_creates: {
        data: (opts.attempted ?? []).map((invitation_id) => ({ invitation_id })),
        ...(opts.claimError ? { writeError: opts.claimError } : {}),
      },
      audit_logs: [],
    },
  });
}

type Call = { method: string; path: string; body: Record<string, unknown> | null };
function medstop(post: () => Response | Promise<Response> = () => new Response(JSON.stringify({ data: { eeid: "EE-NEW" } }), { status: 200 })) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    calls.push({ method: init?.method ?? "GET", path: u.pathname, body: init?.body ? JSON.parse(init.body as string) : null });
    if ((init?.method ?? "GET") === "GET" && u.pathname === "/Employee/new") return new Response(JSON.stringify({ data: BLANK }), { status: 200 });
    if (init?.method === "POST" && u.pathname === "/Employee/new") return post();
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { client: new MedstopClient({ apiKey: "k", baseUrl: "https://api.med-stop.com", fetchImpl, maxRetries: 0, sleep: async () => {} }), calls };
}
const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");
const run = (rec: ReturnType<typeof db>, client: MedstopClient, people: MedstopApplicantFacts[]) =>
  createMedstopApplicants(rec.client as unknown as SupabaseClient, client, ORG, async () => people);

describe("createMedstopApplicants — who is sent", () => {
  it("sends nobody, and does not even read Part 1, while ordering is switched off (D-MSUX11)", async () => {
    const { client, calls } = medstop();
    const load = vi.fn(async () => [person(1)]);
    const r = await createMedstopApplicants(db({ orders: false }).client as unknown as SupabaseClient, client, ORG, load);
    expect(r.ordersOff).toBe(true);
    expect(load).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("skips an application already tried, a person Med-Stop already holds, and one who declined", async () => {
    const { client, calls } = medstop();
    const rec = db({ attempted: ["inv-1"], held: ["d-2"] });
    const r = await run(rec, client, [person(1), person(2), person(3, { gender: "declined" })]);
    expect(posts(calls)).toEqual([]);
    expect(r).toMatchObject({ created: 0, skipped: 1 });
  });

  it("creates at most a sweep's worth at a time", async () => {
    const { client, calls } = medstop();
    await run(db(), client, Array.from({ length: MEDSTOP_CREATES_PER_SWEEP + 3 }, (_, i) => person(i)));
    expect(posts(calls)).toHaveLength(MEDSTOP_CREATES_PER_SWEEP);
  });
});

describe("createMedstopApplicants — what is sent, and how often", () => {
  it("POSTs Med-Stop's own blank form back with ours filled in — the same 46 keys, its defaults kept", async () => {
    const { client, calls } = medstop();
    await run(db(), client, [person(1)]);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /Employee/new", "POST /Employee/new"]);
    const sent = posts(calls)[0]!.body!;
    expect(Object.keys(sent)).toEqual(Object.keys(BLANK));
    expect(sent).toMatchObject({
      branchid: "BRANCH-1", dotagency: "FMCSA", status: "APPLICANT", category: "DRIVER", gender: "FEMALE",
      idclass: "CDL", idnumber: "D1", ssn: "", startdate: null, phone1: "(312) 555-0142",
    });
  });

  it("claims the attempt BEFORE the POST, then records it created — with ids only in the audit", async () => {
    const { client } = medstop();
    const rec = db();
    expect(await run(rec, client, [person(1)])).toMatchObject({ created: 1 });
    const writes = rec.forTable("medstop_applicant_creates").filter((q) => q.write);
    expect(writes.map((q) => q.write!.method)).toEqual(["insert", "update"]);
    expect(writes[0]!.write!.payload).toMatchObject({ invitation_id: "inv-1", outcome: "unknown" });
    expect(writes[1]!.write!.payload).toMatchObject({ outcome: "created", medstop_id: "EE-NEW" });
    const audit = JSON.stringify(rec.writtenRows("audit_logs"));
    expect(audit).toContain("medstop.applicant.created");
    expect(audit).not.toMatch(/D1|1985|Depot|5550142/);
  });

  it("records Med-Stop's refusal in its own words, sent once", async () => {
    const { client, calls } = medstop(() => new Response(JSON.stringify({ msg: { msg: "Licence already on file" } }), { status: 400 }));
    const rec = db();
    expect(await run(rec, client, [person(1)])).toMatchObject({ refused: 1 });
    expect(posts(calls)).toHaveLength(1);
    expect(rec.writtenRows("medstop_applicant_creates")[1]).toMatchObject({ outcome: "refused", message: "Licence already on file" });
  });

  it("never retries an unanswered POST: it may have landed, so it is recorded unknown", async () => {
    const { client, calls } = medstop(() => { throw new TypeError("fetch failed"); });
    const rec = db();
    expect(await run(rec, client, [person(1)])).toMatchObject({ unknown: 1 });
    expect(posts(calls)).toHaveLength(1);
    expect(rec.writtenRows("medstop_applicant_creates")[1]).toMatchObject({ outcome: "unknown" });
  });

  it("sends nothing when another sweep claimed the application first", async () => {
    const { client, calls } = medstop();
    await run(db({ claimError: { code: "23505", message: "duplicate key" } }), client, [person(1)]);
    expect(posts(calls)).toEqual([]);
  });

  it("org-scopes every read and write (the service role bypasses RLS)", async () => {
    const rec = db();
    await run(rec, medstop().client, [person(1)]);
    expectOrgScoped(rec, ORG);
  });
});

describe("readApplicantCreate", () => {
  it("answers the newest attempt for the applicant's invitations, and nothing without any", async () => {
    const rec = createSupabaseRecorder({ tables: { medstop_applicant_creates: [{ outcome: "refused", message: "No", attempted_at: "2026-10-13T20:00:00Z" }] } });
    expect(await readApplicantCreate(rec.client as unknown as SupabaseClient, ORG, ["inv-1"])).toEqual({ outcome: "refused", message: "No", at: "2026-10-13T20:00:00Z" });
    expect(await readApplicantCreate(rec.client as unknown as SupabaseClient, ORG, [])).toBeNull();
    expectOrgScoped(rec, ORG);
  });
});
