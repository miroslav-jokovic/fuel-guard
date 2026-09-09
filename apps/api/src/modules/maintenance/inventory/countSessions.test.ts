import { describe, expect, it, beforeEach, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * The count-session service (INVENTORY-PLAN.md step I5 PR 1).
 *
 * ── WHAT THIS LAYER CAN GET WRONG, GIVEN 0332's MATRIX EXISTS ──────────────────────────────────
 * `supabase/tests/count-sessions.test.mjs` owns the schema's promises: exactly one holder, the
 * holder belongs to this org, closing is one-way. None of that is repeated here, because a mock
 * cannot prove any of it.
 *
 * What is only true in TypeScript, and is therefore pinned here:
 *
 *   · **the org filter.** The API reads with the service role and bypasses RLS, so a missing
 *     `.eq("org_id")` is a cross-tenant read that every other assertion still passes;
 *   · **the holder's NAME is resolved, not stored**, and it comes from whichever of three joins is
 *     populated — a session about a trailer must not render the bay's name because the bay join
 *     happened to be first in the select;
 *   · **`IV017` must reach the caller as itself.** 0332's trigger raises it when a closed walk is
 *     touched; a service that let it fall into the generic `db_error` branch would answer a shop
 *     "Something went wrong" for a session that is simply already closed, and the 409 mapping in
 *     `httpStatus.ts` would never be reached;
 *   · **`started_by` is the actor's, and the id is the SERVER's.** A client-supplied session id would
 *     let two taps of Start produce two walks — the opposite of a movement, where D-INV27 makes the
 *     client's id the idempotency key.
 *
 * ⚠ Fixtures are FUNCTIONS, not flat arrays. `supabaseRecorder` records `.eq()` and does not apply
 * it, so a flat array answers "the open sessions" with the closed one too — and the assertion that
 * a status filter works would pass against a service that never sent one.
 */

const ORG = "org-1";
const USER = "user-1";
const OPEN = "11111111-1111-4111-8111-111111111111";
const CLOSED = "22222222-2222-4222-8222-222222222222";
const KIT = "33333333-3333-4333-8333-333333333333";
const BAY = "44444444-4444-4444-8444-444444444444";
const TRAILER = "55555555-5555-4555-8555-555555555555";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));

const { listCountSessions, getCountSession, openCountSession, closeCountSession } =
  await import("./countSessions.js");

const sessionRow = (over: Record<string, unknown> = {}) => ({
  id: OPEN,
  kind: "location",
  location_id: BAY,
  vehicle_id: null,
  trailer_id: null,
  started_by: USER,
  blind: true,
  status: "open",
  opened_at: "2026-09-09T10:00:00.000Z",
  closed_at: null,
  note: null,
  stock_locations: { name: "Main bay" },
  vehicles: null,
  trailers: null,
  ...over,
});

const closedRow = () =>
  sessionRow({ id: CLOSED, status: "closed", closed_at: "2026-09-09T11:30:00.000Z", blind: false });

const kitRow = () =>
  sessionRow({
    id: KIT,
    kind: "unit",
    location_id: null,
    trailer_id: TRAILER,
    stock_locations: null,
    trailers: { unit_number: "T-4102" },
  });

/** Answers on the filters the service actually sent, which a flat array cannot do. */
const rows = () => [sessionRow(), closedRow(), kitRow()];
const byFilters = (q: { filters: () => Array<{ col: string; val: unknown }> }) => {
  const eq = new Map(q.filters().map((f) => [f.col, f.val]));
  return rows().filter(
    (r) =>
      (!eq.has("status") || r.status === eq.get("status")) &&
      (!eq.has("kind") || r.kind === eq.get("kind")) &&
      (!eq.has("id") || r.id === eq.get("id")),
  );
};

/**
 * `user_profiles` is keyed by auth user id and carries no org — `memberLabels`' own design, and the
 * exemption `inventory.test.ts:117` and `modules/org/routes/members.test.ts:190` both take. It is
 * reached only for ids that came off org-scoped rows in the first place.
 */
const SCOPED = { exempt: ["user_profiles"] };

describe("count session reads", () => {
  beforeEach(() => {
    rec = createSupabaseRecorder({
      tables: { stock_count_sessions: byFilters },
    });
  });

  it("scopes every read to the org, because the service role bypasses RLS", async () => {
    await listCountSessions(rec.client, ORG);
    await getCountSession(rec.client, ORG, OPEN);
    expectOrgScoped(rec, ORG, SCOPED);
  });

  it("sends the status filter rather than filtering after the fact", async () => {
    const result = await listCountSessions(rec.client, ORG, { status: "open" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.sessions.map((s) => s.id)).toEqual([OPEN, KIT]);
  });

  it("names the holder from whichever join is populated", async () => {
    const result = await listCountSessions(rec.client, ORG);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    const labels = Object.fromEntries(result.sessions.map((s) => [s.id, s.holderLabel]));
    expect(labels[OPEN]).toBe("Main bay");
    // The trailer's unit number, and NOT the bay's name — the select lists locations first.
    expect(labels[KIT]).toBe("T-4102");
  });

  it("carries the mode the walk was recorded under, because a variance is read against it", async () => {
    const result = await listCountSessions(rec.client, ORG);
    if ("error" in result) throw new Error("unexpected error");
    expect(result.sessions.find((s) => s.id === OPEN)?.blind).toBe(true);
    expect(result.sessions.find((s) => s.id === CLOSED)?.blind).toBe(false);
  });

  it("answers null for a session that is not this org's, rather than someone else's row", async () => {
    rec = createSupabaseRecorder({ tables: { stock_count_sessions: () => [] } });
    expect(await getCountSession(rec.client, ORG, OPEN)).toBeNull();
  });
});

describe("opening a walk", () => {
  beforeEach(() => {
    rec = createSupabaseRecorder({ tables: { stock_count_sessions: [sessionRow()] } });
  });

  it("records who started it and does not invent an id", async () => {
    await openCountSession(rec.client, ORG, USER, { kind: "location", locationId: BAY, blind: true });
    const write = rec.writes().find((w) => w.table === "stock_count_sessions")?.write;
    expect(write?.payload).toMatchObject({ org_id: ORG, kind: "location", location_id: BAY, started_by: USER });
    // ⚠ The opposite of a movement. D-INV27 makes a movement's id the CLIENT's, because a movement is
    // what a phone queues with no signal; a session is opened with the network up, and a client id
    // would let two taps of Start produce two walks.
    expect(Object.keys(write?.payload ?? {})).not.toContain("id");
  });

  it("passes `blind` through rather than defaulting it, so a reveal is recorded as one", async () => {
    await openCountSession(rec.client, ORG, USER, { kind: "location", locationId: BAY, blind: false });
    expect(rec.writes().find((w) => w.table === "stock_count_sessions")?.write?.payload).toMatchObject({ blind: false });
  });

  it("turns the FK refusal into a sentence about the place, not a 500", async () => {
    rec = createSupabaseRecorder({
      tables: { stock_count_sessions: () => ({ error: { code: "23503", message: "fk" } }) },
    });
    const result = await openCountSession(rec.client, ORG, USER, { kind: "location", locationId: BAY, blind: true });
    expect(result).toMatchObject({ code: "IV012" });
  });

  it("turns the CHECK refusal into the rule it broke", async () => {
    rec = createSupabaseRecorder({
      tables: { stock_count_sessions: () => ({ error: { code: "23514", message: "check" } }) },
    });
    const result = await openCountSession(rec.client, ORG, USER, { kind: "location", locationId: BAY, blind: true });
    expect(result).toMatchObject({ code: "malformed_session" });
  });
});

describe("closing a walk", () => {
  it("writes the closing time with the status, because the schema requires both", async () => {
    rec = createSupabaseRecorder({ tables: { stock_count_sessions: [closedRow()] } });
    await closeCountSession(rec.client, ORG, OPEN);
    const write = rec.writes().find((w) => w.table === "stock_count_sessions")?.write;
    expect(write?.payload).toMatchObject({ status: "closed" });
    expect(typeof (write?.payload as { closed_at?: unknown }).closed_at).toBe("string");
  });

  it("scopes the close to the org", async () => {
    rec = createSupabaseRecorder({ tables: { stock_count_sessions: [closedRow()] } });
    await closeCountSession(rec.client, ORG, OPEN);
    expectOrgScoped(rec, ORG, SCOPED);
  });

  /**
   * The one that matters. 0332's trigger raises `IV017` for a second close — for the service role
   * too, which is the point of it being a trigger — and this service must hand that code onward or
   * `httpStatus.ts` never gets to map it to a 409 and the shop reads "Something went wrong" about a
   * walk that is simply already finished.
   */
  it("reports an already-closed walk as IV017 and not as a database error", async () => {
    rec = createSupabaseRecorder({
      tables: { stock_count_sessions: () => ({ error: { code: "IV017", message: "closed" } }) },
    });
    const result = await closeCountSession(rec.client, ORG, CLOSED);
    expect(result).toMatchObject({ code: "IV017" });
  });

  it("reports an unknown id as gone, which is what another org's id also is", async () => {
    rec = createSupabaseRecorder({ tables: { stock_count_sessions: () => [] } });
    expect(await closeCountSession(rec.client, ORG, "nope")).toBeNull();
  });
});
