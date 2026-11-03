import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
import { MedstopClient } from "./client.js";
import { closeOrder, prepareClose, type ReleaseOrderedAppointment } from "./closeOrder.js";

/**
 * Closing an open order (MEDSTOP-PLAN.md §7A.21, MSO2, D-MSO3). Pinned: what is REFUSED before anything is
 * written (a request we cannot see, a person matched by name only, an order Med-Stop no longer has open, a
 * form for another request, Med-Stop unreachable); that the one write is Med-Stop's own form with only the
 * outcome, the comment and "not a refusal" set, sent once to that request's status; and that nothing after
 * it can report a closed order as not closed.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TODAY = "2026-11-05";

const drivers = [
  { id: "d-app", full_name: "Al Applicant", first_name: "Al", last_name: "Applicant", date_of_birth: null, cdl_number: "B2", cdl_state: "IL", status: "applicant", archived_at: null },
  { id: "d-nam", full_name: "Nam Only", first_name: "Nam", last_name: "Only", date_of_birth: null, cdl_number: null, cdl_state: null, status: "applicant", archived_at: null },
];
const employees = [
  { medstop_id: "EE-APP", roster: "applicant", driver_id: "d-app", match_rule: "licence" },
  { medstop_id: "EE-NAM", roster: "applicant", driver_id: "d-nam", match_rule: "name" },
];
const db = () =>
  createSupabaseRecorder({
    tables: {
      drivers,
      medstop_employees: employees,
      medstop_requests: postgrestFixture([
        { org_id: ORG, medstop_id: "REQ-77", employee_medstop_id: "EE-APP" },
        { org_id: ORG, medstop_id: "REQ-NAM", employee_medstop_id: "EE-NAM" },
        { org_id: "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d", medstop_id: "REQ-OTHER", employee_medstop_id: "EE-APP" },
      ]),
    },
    rpc: { medstop_merge: 1 },
  });

// The close-out form, as measured 2026-11-03 on a real open request (values invented).
const form = { id: "REQ-77", employee: "AL APPLICANT", service: "DRUG TEST", location: "Concentra Joliet", requestdate: "2026-11-04T16:00:00Z", test: "", testlocation: "", status: "", comment: "", refusal: "", notification: "" };
const request = { id: "REQ-77", status: "OPEN", code: "AUTH-9", registrationnumber: "4471", location: "Concentra Joliet", locationid: "LOC-1", zip: "60435-1234", requestdate: "2026-11-04T16:00:00Z" };

type Call = { method: string; path: string; body: unknown };
function medstop(opts: { request?: object | null; form?: object; post?: () => Response; down?: boolean } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    calls.push({ method: init?.method ?? "GET", path: u.pathname + u.search, body: init?.body ? JSON.parse(init.body as string) : null });
    if (opts.down) return new Response("{}", { status: 500 });
    if (init?.method === "POST") return opts.post ? opts.post() : new Response(JSON.stringify({ data: {} }), { status: 200 });
    if (u.pathname === "/Request/REQ-77") return opts.request === null ? new Response("{}", { status: 404 }) : new Response(JSON.stringify({ data: opts.request ?? request }), { status: 200 });
    if (u.pathname === "/Request/REQ-77/status") return new Response(JSON.stringify({ data: opts.form ?? form }), { status: 200 });
    if (u.pathname === "/Request/list") return new Response(JSON.stringify({ data: { pagemax: 1 }, rows: [[{ id: "REQ-77", eeid: "EE-APP", service: "TD", status: "NO SHOW", requestdate: "2026-11-04 16:00:00" }]] }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { client: new MedstopClient({ apiKey: "k", baseUrl: "https://api.med-stop.com", fetchImpl, maxRetries: 0, pageDelayMs: 0, sleep: async () => {} }), calls };
}
const as = (r: ReturnType<typeof db>) => r.client as unknown as SupabaseClient;
const noShow = { status: "NO SHOW" as const };
const released: Array<{ driverId: string; reference: string }> = [];
const release: ReleaseOrderedAppointment = async (_a, _o, driverId, reference) => (released.push({ driverId, reference }), 1);

describe("prepareClose — what is refused, before anything is written", () => {
  it("refuses a request that is not ours, or another org's, without asking Med-Stop", async () => {
    for (const id of ["REQ-NONE", "REQ-OTHER"]) {
      const { client, calls } = medstop();
      expect(await prepareClose(as(db()), client, ORG, id, noShow)).toMatchObject({ refusal: { status: 404, code: "medstop_request_unknown" } });
      expect(calls).toEqual([]);
    }
  });

  it("refuses a request on a person matched by name only (R3)", async () => {
    const { client, calls } = medstop();
    expect(await prepareClose(as(db()), client, ORG, "REQ-NAM", noShow)).toMatchObject({ refusal: { code: "medstop_request_unknown" } });
    expect(calls).toEqual([]);
  });

  it("asks Med-Stop live and refuses an order it no longer has open — a collected donor is never a no-show", async () => {
    const { client } = medstop({ request: { ...request, status: "COMPLETED" } });
    expect(await prepareClose(as(db()), client, ORG, "REQ-77", noShow)).toMatchObject({ refusal: { status: 409, code: "medstop_request_closed" } });
  });

  it("refuses a close-out form that names another request, and an unreachable Med-Stop", async () => {
    expect(await prepareClose(as(db()), medstop({ form: { ...form, id: "REQ-9" } }).client, ORG, "REQ-77", noShow)).toMatchObject({ refusal: { code: "medstop_form" } });
    expect(await prepareClose(as(db()), medstop({ down: true }).client, ORG, "REQ-77", noShow)).toMatchObject({ refusal: { status: 502, code: "medstop_unreachable" } });
  });

  it("previews the person, the site, the go-by and the exact comment, org-scoped", async () => {
    const rec = db();
    const r = await prepareClose(as(rec), medstop().client, ORG, "REQ-77", { status: "CANCELED", note: "Hired elsewhere." });
    expect(r).toMatchObject({
      preview: { requestId: "REQ-77", status: "CANCELED", person: "Al Applicant", site: "Concentra Joliet", goBy: "2026-11-04T16:00", comment: expect.stringMatching(/no longer needed as ordered\. Hired elsewhere\.$/) },
    });
    expect((r as { preview: { comment: string } }).preview.comment.length).toBeGreaterThanOrEqual(30);
    expectOrgScoped(rec, ORG);
  });
});

describe("closeOrder — the one write", () => {
  it("POSTs Med-Stop's own form to that request's status, setting only the outcome, the comment and refusal N — once", async () => {
    const { client, calls } = medstop();
    const r = await closeOrder(as(db()), client, ORG, "REQ-77", noShow, TODAY, release);
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe("/Request/REQ-77/status");
    expect(posts[0]!.body).toEqual({ ...form, status: "NO SHOW", comment: expect.stringContaining("No show"), refusal: "N" });
    expect(r).toMatchObject({ requestId: "REQ-77", status: "NO SHOW", reorder: { medstopId: "EE-APP", zip: "60435", locationId: "LOC-1" } });
  });

  it("retires the appointment the order filled, by its exact reference, and mirrors the new status", async () => {
    released.length = 0;
    const rec = db();
    await closeOrder(as(rec), medstop().client, ORG, "REQ-77", noShow, TODAY, release);
    expect(released).toEqual([{ driverId: "d-app", reference: "AUTH-9 (registration 4471)" }]);
    expect(rec.rpcs().find((c) => c.fn === "medstop_merge")?.args).toMatchObject({ p_kind: "requests", p_rows: [expect.objectContaining({ medstop_id: "REQ-77", status: "NO SHOW" })] });
  });

  it("never retries: a refusal is one attempt; an unanswered POST is 'check Med-Stop'", async () => {
    const refused = medstop({ post: () => new Response(JSON.stringify({ msg: { msg: "comment too short" } }), { status: 400 }) });
    expect(await closeOrder(as(db()), refused.client, ORG, "REQ-77", noShow, TODAY, release)).toMatchObject({ refusal: { code: "medstop_close_refused" } });
    expect(refused.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    const silent = medstop({ post: () => { throw new TypeError("socket hang up"); } });
    expect(await closeOrder(as(db()), silent.client, ORG, "REQ-77", noShow, TODAY, release)).toMatchObject({ refusal: { code: "medstop_close_unknown" } });
  });

  it("writes nothing when a check refuses first", async () => {
    const { client, calls } = medstop({ request: { ...request, status: "CANCELED" } });
    await closeOrder(as(db()), client, ORG, "REQ-77", noShow, TODAY, release);
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("reports a closed order as closed even when retiring its appointment or the mirror fails", async () => {
    const broken: ReleaseOrderedAppointment = async () => {
      throw new Error("update failed");
    };
    const r = await closeOrder(as(db()), medstop().client, ORG, "REQ-77", noShow, TODAY, broken);
    expect(r).toMatchObject({ requestId: "REQ-77", status: "NO SHOW" });
  });
});
