import { describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * A truck's and a trailer's own QR code (DE4; `unit_tags`, 0531).
 *
 * ── WHAT IS ONLY TRUE HERE ────────────────────────────────────────────────────────────────────
 *   · **a unit that has a code is never given another** — a faded cab label is reprinted with the
 *     code the row holds, and a second row would be refused by 0531 anyway, but only after a 23505
 *     the label screen would show as a failure;
 *   · **the two 23505s are told apart by re-reading the unit**: a code collision draws again, a unit
 *     labelled a moment ago by somebody else answers with THEIR code;
 *   · **the face is the unit number, then the code, then where it goes** (D-DE6, Q-DE2 (a));
 *   · **a VEH code answers only a truck and a TRL code only a trailer**;
 *   · **the org filter**, because the service role bypasses RLS.
 *
 * ⚠ Fixtures are FUNCTIONS: `supabaseRecorder` records `.eq()` and does not apply it.
 */

const ORG = "org-1";
const TRUCK = "11111111-1111-4111-8111-111111111111";
const TRAILER = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));

const { issueUnitTagCode, resolveTrailerTag, resolveVehicleTag } = await import("./unitTags.js");
const { resolveLabelFaces } = await import("./labels.js");

const filter = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;
const isInsert = (q: RecordedQuery) => q.write?.method === "insert";

/**
 * `unit_tags` as the database would answer it. `held` is each unit's code; `insertErrors` scripts the
 * next inserts' 23505s; `labelledBy` is a code another request writes while ours is in flight.
 */
function world(opts: { held?: Record<string, string>; insertErrors?: number; labelledBy?: Record<string, string> } = {}) {
  const held = { ...(opts.held ?? {}) };
  let errors = opts.insertErrors ?? 0;
  return createSupabaseRecorder({
    tables: {
      vehicles: () => [{ id: TRUCK, unit_number: "654" }],
      trailers: () => [{ id: TRAILER, unit_number: "1203" }],
      unit_tags: (q) => {
        if (isInsert(q)) {
          const row = q.write!.payload as Record<string, string>;
          const unit = row.vehicle_id ?? row.trailer_id!;
          if (errors > 0) {
            errors -= 1;
            if (opts.labelledBy?.[unit]) held[unit] = opts.labelledBy[unit]!;
            return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
          held[unit] = row.tag_code!;
          return [{ tag_code: row.tag_code }];
        }
        const code = filter(q, "tag_code");
        if (code) {
          // The resolver: which unit carries this code, in the column it asked about.
          const hit = Object.entries(held).find(([, c]) => c === code);
          if (!hit) return [];
          const asksTrailer = q.ops.some((o) => o.method === "not" && o.args[0] === "trailer_id");
          const isTrailer = hit[0] === TRAILER;
          if (asksTrailer !== isTrailer) return [];
          return [{ [isTrailer ? "trailer_id" : "vehicle_id"]: hit[0] }];
        }
        const unit = (filter(q, "vehicle_id") ?? filter(q, "trailer_id")) as string | string[] | undefined;
        const ids = Array.isArray(unit) ? unit : unit ? [unit] : [];
        return ids.filter((id) => held[id]).map((id) => ({ vehicle_id: id === TRUCK ? id : null, trailer_id: id === TRAILER ? id : null, tag_code: held[id] }));
      },
    },
  });
}

describe("issuing a unit's code", () => {
  it("hands back the code a unit already has, and writes nothing", async () => {
    rec = world({ held: { [TRUCK]: "7K3M9P" } });
    expect(await issueUnitTagCode(rec.client, ORG, "vehicle", TRUCK, USER)).toBe("7K3M9P");
    expect(rec.queries.some(isInsert)).toBe(false);
    expectOrgScoped(rec, ORG);
  });

  it("issues one to a unit that has none, recording who printed it", async () => {
    rec = world();
    const code = await issueUnitTagCode(rec.client, ORG, "trailer", TRAILER, USER);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(rec.writtenRows("unit_tags")).toEqual([{ org_id: ORG, trailer_id: TRAILER, tag_code: code, issued_by: USER }]);
    expectOrgScoped(rec, ORG);
  });

  it("draws again when the code is taken", async () => {
    rec = world({ insertErrors: 2 });
    const code = await issueUnitTagCode(rec.client, ORG, "vehicle", TRUCK, null);
    expect(typeof code).toBe("string");
    expect(rec.queries.filter(isInsert)).toHaveLength(3);
  });

  it("answers with the other request's code when somebody labelled the unit first", async () => {
    rec = world({ insertErrors: 1, labelledBy: { [TRUCK]: "X4Q2VW" } });
    expect(await issueUnitTagCode(rec.client, ORG, "vehicle", TRUCK, null)).toBe("X4Q2VW");
    expect(rec.queries.filter(isInsert)).toHaveLength(1);
  });

  it("gives up after six collisions instead of hanging", async () => {
    rec = world({ insertErrors: 99 });
    expect(await issueUnitTagCode(rec.client, ORG, "vehicle", TRUCK, null)).toMatchObject({ code: "tag_issue_exhausted" });
    expect(rec.queries.filter(isInsert)).toHaveLength(6);
  });
});

describe("a unit's label face", () => {
  it("prints the unit number big, then the code, then where the label goes", async () => {
    rec = world({ held: { [TRUCK]: "7K3M9P" } });
    const result = await resolveLabelFaces(rec.client, ORG, [
      { kind: "unit", unitKind: "trailer", unitId: TRAILER },
      { kind: "unit", unitKind: "vehicle", unitId: TRUCK },
    ], USER);
    if ("error" in result) throw new Error(result.error);
    const [trailer, truck] = result.faces;
    expect(truck).toMatchObject({ payload: "SIL1:VEH:7K3M9P", code: "654", lines: ["7K3M9P", "Inside cab — driver door jamb"] });
    expect(trailer!.payload).toMatch(/^SIL1:TRL:[0-9A-Z]{6}$/);
    expect(trailer).toMatchObject({ code: "1203", lines: [trailer!.payload.slice(-6), "Inside front wall"] });
    // The order the caller picked, and a code only for the unit that had none.
    expect(rec.writtenRows("unit_tags")).toEqual([expect.objectContaining({ trailer_id: TRAILER, issued_by: USER })]);
    expectOrgScoped(rec, ORG);
  });

  it("drops a unit that is not this org's rather than failing the run", async () => {
    rec = createSupabaseRecorder({ tables: { vehicles: () => [], trailers: () => [], unit_tags: () => [] } });
    const result = await resolveLabelFaces(rec.client, ORG, [{ kind: "unit", unitKind: "vehicle", unitId: TRUCK }]);
    expect(result).toEqual({ faces: [], dropped: 1 });
    expect(rec.queries.some(isInsert)).toBe(false);
  });
});

describe("resolving a scanned unit label", () => {
  const ctx = (id: string) => ({ admin: rec.client, orgId: ORG, id, code: `SIL1:X:${id}` });

  it("opens the truck for its VEH code and the trailer for its TRL code", async () => {
    rec = world({ held: { [TRUCK]: "7K3M9P", [TRAILER]: "X4Q2VW" } });
    expect(await resolveVehicleTag(ctx("7K3M9P"))).toEqual({
      kind: "unit",
      code: "SIL1:X:7K3M9P",
      unit: { kind: "vehicle", id: TRUCK, unitNumber: "654" },
    });
    expect(await resolveTrailerTag(ctx("X4Q2VW"))).toMatchObject({ unit: { kind: "trailer", id: TRAILER, unitNumber: "1203" } });
    expectOrgScoped(rec, ORG);
  });

  it("does not answer a trailer's code read as a truck's, nor a code nobody holds", async () => {
    rec = world({ held: { [TRAILER]: "X4Q2VW" } });
    expect(await resolveVehicleTag(ctx("X4Q2VW"))).toBeNull();
    expect(await resolveTrailerTag(ctx("AAAAAA"))).toBeNull();
  });
});
