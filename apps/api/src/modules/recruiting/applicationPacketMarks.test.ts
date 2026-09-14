import { describe, it, expect } from "vitest";
import { driverPlacements, packetPlacementById } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { hashInvitationToken, isIntakeError } from "./applicationIntake.js";
import { packetStops, recordPacketMark } from "./applicationPacketMarks.js";

/**
 * The twenty-two marks on the carrier's packet (P5, D-PKT6).
 *
 * Three properties carry this file, and each of them is a thing the database cannot check:
 *
 *   · **the server composes what was signed.** `packet-signing.test.mjs` proves the transaction
 *     stores whatever it is handed; only a test here can prove that what it is handed is the
 *     inventory's page, line and sentence rather than the request's.
 *   · **a stop that is not the driver's is refused.** Six of the twenty-eight belong to the carrier
 *     or to a witness. The RPC would file `p18c` perfectly happily — it takes the page and the
 *     anchor as arguments — so this refusal exists here or nowhere.
 *   · **the tenant scope is explicit.** The service role bypasses RLS and the invitation id came
 *     from a token rather than from a session.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const NOW = new Date("2026-09-14T12:00:00Z");
const TOKEN = "d".repeat(43);
const CTX = { ip: "203.0.113.9", userAgent: "UA" };

const invitation = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  org_id: ORG,
  driver_id: DRIVER,
  token_hash: hashInvitationToken(TOKEN),
  expires_at: "2026-10-01T00:00:00Z",
  revoked_at: null,
  consented_at: "2026-09-14T08:00:00Z",
  releases_completed_at: "2026-09-14T08:30:00Z",
  review_requested_at: "2026-09-14T09:00:00Z",
  approved_at: "2026-09-14T10:00:00Z",
  submitted_at: null,
  ...over,
});

const seed = (
  opts: { inv?: Record<string, unknown> | null; marks?: Record<string, unknown>[] } = {},
) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: opts.inv === null ? [] : [opts.inv ?? invitation()],
      application_packet_marks: opts.marks ?? [],
    },
    rpc: { record_packet_mark: { mark_id: "mark-1", signed_count: 1, complete: false } },
  });

const body = (placement_id: string, signed_name = "Marija Varmeda") => ({
  placement_id,
  signed_name,
  esign_consent: true as const,
});

describe("recording one mark", () => {
  /**
   * ⚠ The assertion this file exists for. Every field describing WHAT was signed is read out of
   * `PACKET_PLACEMENTS` and none of it is read out of the request — 0092's rule for
   * `hazmat_reviews.attestation`, 0215's for `disclosure_text`. A request that carried its own page
   * and its own sentence would be a signature over text the signer's browser wrote.
   */
  it("composes the page, the line and the sentence from the inventory, not the request", async () => {
    const rec = seed();
    const result = await recordPacketMark(rec.client, TOKEN, body("p22"), CTX, NOW);
    expect(isIntakeError(result)).toBe(false);

    const args = rec.rpcs()[0]!.args as Record<string, unknown>;
    const stop = packetPlacementById("p22")!;
    expect(args.p_org).toBe(ORG);
    expect(args.p_invitation).toBe("inv-1");
    expect(args.p_placement).toBe("p22");
    expect(args.p_page).toBe(stop.page);
    expect(args.p_mark).toBe(stop.mark);
    // The carrier's own spelling reaches the row, because the anchor's job is to be findable on
    // their paper — see `packetPlacements.ts`.
    expect(args.p_anchor).toBe("Driver name Print | Driver signatrure");
    expect(args.p_affirmed).toBe(stop.what);
    expect(args.p_signed_name).toBe("Marija Varmeda");
    expect(args.p_ip).toBe("203.0.113.9");
    expect(args.p_user_agent).toBe("UA");
  });

  /**
   * ⚠ Derived and passed in, never written into the migration (0228's division). Counsel ruling on
   * page 19's duplicated signature line then moves one array rather than an array and a constant in
   * a migration nobody remembers to open.
   */
  it("tells the transaction how many stops there are, from the inventory", async () => {
    const rec = seed();
    await recordPacketMark(rec.client, TOKEN, body("p03"), CTX, NOW);
    const args = rec.rpcs()[0]!.args as Record<string, unknown>;
    expect(args.p_expected_count).toBe(22);
    expect(args.p_expected_count).toBe(driverPlacements().length);
  });

  it("carries the count and the completion back, so the ceremony can advance", async () => {
    const rec = createSupabaseRecorder({
      tables: { application_invitations: [invitation()], application_packet_marks: [] },
      rpc: { record_packet_mark: { mark_id: "m-22", signed_count: 22, complete: true } },
    });
    const result = await recordPacketMark(rec.client, TOKEN, body("p31b"), CTX, NOW);
    expect(isIntakeError(result)).toBe(false);
    expect(result).toMatchObject({ id: "m-22", signedCount: 22, complete: true });
  });
});

/**
 * ⚠ **The refusal the database cannot make.** `record_packet_mark` takes the page and the anchor as
 * arguments, so it would file the carrier's countersignature under the applicant's name without
 * complaint. Twenty-two of the twenty-eight placements are the driver's; the other six are refused
 * here or nowhere.
 */
describe("a stop that is not the driver's", () => {
  it.each([
    ["p18c", "the carrier's countersignature on page 18"],
    ["p19ac", "the carrier's countersignature on page 19"],
    ["p22w", "the witness on page 22"],
    ["p31w", "the witness on page 31"],
  ])("refuses %s — %s", async (placementId) => {
    const rec = seed();
    const result = await recordPacketMark(rec.client, TOKEN, body(placementId), CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("packet_mark_not_the_drivers");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses a placement id that is not in the inventory at all", async () => {
    const rec = seed();
    // p24 left the packet on 2026-08-23 (D-PKT10) — a stale client could still ask for it.
    const result = await recordPacketMark(rec.client, TOKEN, body("p24"), CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("packet_mark_not_the_drivers");
    expect(rec.rpcs()).toHaveLength(0);
  });
});

/**
 * The window D-AX11 opened when it split the signing (0336). Six of these stops are certifications
 * that the answers are true, and the office may still be correcting them — *"a certification of
 * answers the office has since corrected certifies something else."*
 */
describe("the window a packet may be signed in", () => {
  it("refuses before the office has approved, and reaches no transaction", async () => {
    const rec = seed({ inv: invitation({ approved_at: null }) });
    const result = await recordPacketMark(rec.client, TOKEN, body("p03"), CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("packet_not_yet_approved");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses once the application is filed", async () => {
    const rec = seed({ inv: invitation({ submitted_at: "2026-09-14T11:00:00Z" }) });
    const result = await recordPacketMark(rec.client, TOKEN, body("p03"), CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("already_submitted");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses on a dead link", async () => {
    const rec = seed({ inv: null });
    const result = await recordPacketMark(rec.client, TOKEN, body("p03"), CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("invalid_link");
    expect(rec.rpcs()).toHaveLength(0);
  });

  /**
   * ⚠ A signature given electronically by somebody who never agreed to sign electronically is the
   * §390.32(d) gap, and it is checked against the carrier's PUBLISHED wording — the omission that
   * recorded a release with no consent behind it on 2026-09-13.
   */
  it("refuses when the driver never consented to sign electronically", async () => {
    const rec = seed({ inv: invitation({ consented_at: null }) });
    const result = await recordPacketMark(rec.client, TOKEN, body("p03"), CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("esign_consent_required");
    expect(rec.rpcs()).toHaveLength(0);
  });
});

/** The transaction's own refusals, each turned into something the ceremony can act on. */
describe("what the transaction refuses", () => {
  const failing = (code: string, message: string) =>
    createSupabaseRecorder({
      tables: { application_invitations: [invitation()], application_packet_marks: [] },
      rpc: () => ({ data: null, error: { code, message } }),
    });

  it.each([
    ["DR034", "packet_mark_already_made", "packet_mark_already_made"],
    ["DR035", "packet_mark_name_changed", "packet_mark_name_changed"],
    ["DR032", "packet_not_yet_approved", "packet_not_yet_approved"],
    ["DR033", "packet_already_filed", "already_submitted"],
    ["DR030", "application_invitation_not_found", "invalid_link"],
    ["DR031", "application_invitation_unusable", "invalid_link"],
  ])("turns %s into %s", async (code, message, expected) => {
    const rec = failing(code, message);
    const result = await recordPacketMark(rec.client, TOKEN, body("p03"), CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe(expected);
  });
});

describe("the queue the ceremony walks", () => {
  it("serves the driver's stops in the packet's own page order", async () => {
    const rec = seed();
    const stops = await packetStops(rec.client, ORG, "inv-1");
    expect(stops).toHaveLength(22);
    expect(stops.every((s) => s.party === "driver")).toBe(true);
    // ⚠ The paper's order, not a convenient one. A driver reviewing a document they are signing
    // follows the paper, and a queue in another order would disagree with the PDF about what came
    // before what.
    expect(stops.map((s) => s.page)).toEqual([...stops.map((s) => s.page)].sort((a, b) => a - b));
    expect(stops[0]!.id).toBe("p03");
    expect(stops.at(-1)!.id).toBe("p31b");
  });

  /**
   * ⚠ Marked, not filtered. D-PKT6 asks for progress to be visible, and a list that silently
   * shortened as the driver went would make the end unknowable.
   */
  it("marks the stops already collected rather than dropping them", async () => {
    const rec = seed({
      marks: [
        { placement_id: "p03", signed_at: "2026-09-14T11:00:00Z" },
        { placement_id: "p11b", signed_at: "2026-09-14T11:01:00Z" },
      ],
    });
    const stops = await packetStops(rec.client, ORG, "inv-1");
    expect(stops).toHaveLength(22);
    expect(stops.find((s) => s.id === "p03")!.signedAt).toBe("2026-09-14T11:00:00Z");
    expect(stops.find((s) => s.id === "p11b")!.signedAt).toBe("2026-09-14T11:01:00Z");
    // ⚠ p11a and p11b sit on the same page and differ only in what they say. A queue keyed on the
    // page would have marked both.
    expect(stops.find((s) => s.id === "p11a")!.signedAt).toBeNull();
    expect(stops.filter((s) => s.signedAt === null)).toHaveLength(20);
  });

  it("scopes the read to the org the token resolved to", async () => {
    const rec = seed();
    await packetStops(rec.client, ORG, "inv-1");
    expectOrgScoped(rec, ORG);
    const q = rec.forTable("application_packet_marks")[0]!;
    expect(q.filters()).toContainEqual({ col: "invitation_id", val: "inv-1" });
  });
});
