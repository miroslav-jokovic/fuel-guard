import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MedstopOrderInput } from "@silvicom/shared";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { MedstopClient } from "./client.js";
import { followUpPlacedOrder, orderedCollectionOf, type FillOrderedAppointment } from "./orderFollowUp.js";

/**
 * After Place order (MEDSTOP-PLAN.md §7A.21, MSO1, D-MSO1). Pinned: a pre-employment order reads
 * Med-Stop's request back and hands the site, its address, the go-by and the code to recruiting's writer;
 * the request goes into the mirror at once, through the sweep's own list; nothing here writes to
 * Med-Stop; and — because the order is already billed — no failure after it reaches the caller.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TODAY = "2026-11-03";
const input: MedstopOrderInput = {
  medstopId: "EE-APP", service: "drug", reason: "PRE-EMPLOYMENT", locationId: "LOC-1",
  requestDate: "2026-11-04", requestTime: "16:00", notifyBy: "PHONE CALL",
};
// `Dto.Request`'s fields (spec 4.9.31); the value of `requestdate` is one of §7A.14's unmeasured points.
const request = {
  id: "REQ-77", code: "AUTH-9", registrationnumber: "4471", location: "Concentra Joliet", address: "1051 Essington Rd",
  address1: "Suite 2", city: "Joliet", state: "IL", zip: "60435", phone1: "8155550142", ext1: "2", requestdate: "2026-11-04 16:00:00",
};
const listed = { id: "REQ-77", eeid: "EE-APP", service: "TD", category: "DRUG TEST", reason: "PRE-EMPLOYMENT", observed: "N", dotstatus: "Y", requestdate: "2026-11-04 16:00:00", payment: "EMPLOYER", location: "Concentra Joliet", testid: null, testdate: null, status: "OPEN" };

type Call = { method: string; path: string };
function medstop(opts: { request?: () => Response; list?: () => Response } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    calls.push({ method: init?.method ?? "GET", path: u.pathname + u.search });
    if (u.pathname === "/Request/REQ-77") return opts.request ? opts.request() : new Response(JSON.stringify({ data: request }), { status: 200 });
    if (u.pathname === "/Request/list")
      return opts.list ? opts.list() : new Response(JSON.stringify({ data: { pagemax: 1 }, rows: [[listed, { ...listed, id: "REQ-OTHER" }]] }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { client: new MedstopClient({ apiKey: "k", baseUrl: "https://api.med-stop.com", fetchImpl, maxRetries: 0, pageDelayMs: 0, sleep: async () => {} }), calls };
}
const db = () => createSupabaseRecorder({ tables: {}, rpc: { medstop_merge: 1 } });
const filled: FillOrderedAppointment = async () => ({ appointmentId: "appt-1" });

describe("orderedCollectionOf — Med-Stop's request, as the applicant needs it", () => {
  it("reads the site, the whole address, the phone with its extension, the go-by and the code with its registration number", () => {
    expect(orderedCollectionOf({ data: request }, "REQ-77", input)).toEqual({
      requestId: "REQ-77",
      siteName: "Concentra Joliet",
      siteAddress: "1051 Essington Rd, Suite 2, Joliet, IL 60435",
      sitePhone: "8155550142 ext 2",
      goBy: "2026-11-04T16:00",
      reference: "AUTH-9 (registration 4471)",
    });
  });

  it("falls back to the deadline the order was SENT with when Med-Stop's date carries no time", () => {
    expect(orderedCollectionOf({ data: { ...request, requestdate: "2026-11-04" } }, "REQ-77", { ...input, requestTime: "15:30" })?.goBy).toBe("2026-11-04T15:30");
  });

  it("writes no half appointment: no site name or no street is no collection", () => {
    expect(orderedCollectionOf({ data: { ...request, location: "" } }, "REQ-77", input)).toBeNull();
    expect(orderedCollectionOf({ data: { ...request, address: null, address1: null } }, "REQ-77", input)).toBeNull();
    expect(orderedCollectionOf(null, "REQ-77", input)).toBeNull();
  });
});

describe("followUpPlacedOrder", () => {
  it("fills the applicant's appointment from Med-Stop's request and mirrors that one request at once", async () => {
    const { client, calls } = medstop();
    const rec = db();
    const fill = vi.fn(filled);
    const r = await followUpPlacedOrder(rec.client as unknown as SupabaseClient, client, ORG, "u-1", input, { requestId: "REQ-77", driverId: "d-app" }, TODAY, fill);
    expect(r).toEqual({ requestId: "REQ-77", appointment: "filled" });
    expect(fill).toHaveBeenCalledWith(expect.anything(), ORG, "u-1", "d-app", expect.objectContaining({ siteName: "Concentra Joliet", goBy: "2026-11-04T16:00", reference: "AUTH-9 (registration 4471)" }));
    // The sweep's own list, from yesterday; only the placed request is merged.
    expect(calls.map((c) => c.path)).toEqual(["/Request/REQ-77", "/Request/list?requestedafter=2026-11-02&page=1&pagesize=100"]);
    const merges = rec.rpcs().filter((c) => c.fn === "medstop_merge");
    expect(merges).toHaveLength(1);
    expect(merges[0]!.args).toMatchObject({ p_org: ORG, p_kind: "requests", p_rows: [expect.objectContaining({ medstop_id: "REQ-77", status: "OPEN", location: "Concentra Joliet" })] });
    expect((merges[0]!.args as { p_rows: unknown[] }).p_rows).toHaveLength(1);
  });

  it("writes nothing to Med-Stop — every call it makes is a GET (D-MSUX5: /notify stays off)", async () => {
    const { client, calls } = medstop();
    await followUpPlacedOrder(db().client as unknown as SupabaseClient, client, ORG, "u-1", input, { requestId: "REQ-77", driverId: "d-app" }, TODAY, filled);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("never fails a placed order: an unreadable request is site_unread, a refused or broken fill is not_filled, a failed mirror is nothing", async () => {
    const rec = db();
    const unread = medstop({ request: () => new Response("{}", { status: 500 }), list: () => new Response("{}", { status: 500 }) });
    const fill = vi.fn(filled);
    expect(await followUpPlacedOrder(rec.client as unknown as SupabaseClient, unread.client, ORG, "u-1", input, { requestId: "REQ-77", driverId: "d-app" }, TODAY, fill))
      .toEqual({ requestId: "REQ-77", appointment: "site_unread" });
    expect(fill).not.toHaveBeenCalled();

    const refused: FillOrderedAppointment = async () => ({ refused: "This applicant has no live invitation." });
    expect(await followUpPlacedOrder(rec.client as unknown as SupabaseClient, medstop().client, ORG, "u-1", input, { requestId: "REQ-77", driverId: "d-app" }, TODAY, refused))
      .toEqual({ requestId: "REQ-77", appointment: "not_filled" });

    const broken: FillOrderedAppointment = async () => {
      throw new Error("insert failed");
    };
    expect(await followUpPlacedOrder(rec.client as unknown as SupabaseClient, medstop().client, ORG, "u-1", input, { requestId: "REQ-77", driverId: "d-app" }, TODAY, broken))
      .toEqual({ requestId: "REQ-77", appointment: "not_filled" });
  });

  it("fills nothing for a working driver's test — only an applicant has a step — but still mirrors it", async () => {
    const { client, calls } = medstop();
    const fill = vi.fn(filled);
    const r = await followUpPlacedOrder(db().client as unknown as SupabaseClient, client, ORG, "u-1", { ...input, reason: "POST-ACCIDENT" }, { requestId: "REQ-77", driverId: "d-ann" }, TODAY, fill);
    expect(r).toEqual({ requestId: "REQ-77", appointment: null });
    expect(fill).not.toHaveBeenCalled();
    expect(calls.map((c) => c.path)).toEqual(["/Request/list?requestedafter=2026-11-02&page=1&pagesize=100"]);
  });
});
