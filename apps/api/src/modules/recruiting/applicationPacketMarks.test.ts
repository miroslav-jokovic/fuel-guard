import { describe, it, expect } from "vitest";
import { driverPlacements, packetPlacementById } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { hashInvitationToken, isIntakeError } from "./applicationIntake.js";
import { adoptedPacketMarks, packetStops, recordPacketMark } from "./applicationPacketMarks.js";

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
  signing_opened_at: "2026-09-20T10:00:00Z",
  submitted_at: null,
  ...over,
});

const seed = (
  opts: {
    inv?: Record<string, unknown> | null;
    marks?: Record<string, unknown>[];
    /** The draft's `applying_as` as the path select returns it (Q-HM14). Absent: no draft row. */
    applyingAs?: string | null;
  } = {},
) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: opts.inv === null ? [] : [opts.inv ?? invitation()],
      application_packet_marks: opts.marks ?? [],
      application_drafts: opts.applyingAs === undefined
        ? []
        : [{ org_id: ORG, invitation_id: "inv-1", applying_as: opts.applyingAs }],
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
    // ⚠ 21 since L-1 (2026-09-24): page 4 is withdrawn from signing. 19 since D-MVR1 (2026-09-25):
    // page 19's two lines are, because the driving-record release is a permission now.
    expect(args.p_expected_count).toBe(19);
    expect(args.p_expected_count).toBe(driverPlacements(null).length);
  });

  /**
   * ⚠ The count is re-read from the link's placement ids, not taken from the transaction (L-1). The
   * RPC counts ROWS, and a row at a withdrawn line would complete the packet one real stop early.
   */
  it("carries the count and the completion back, so the ceremony can advance", async () => {
    const every = driverPlacements(null).map((p) => ({ placement_id: p.id, signed_at: "2026-09-24T12:00:00Z" }));
    const rec = seed({ marks: every });
    const result = await recordPacketMark(rec.client, TOKEN, body("p31b"), CTX, NOW);
    expect(isIntakeError(result)).toBe(false);
    expect(result).toMatchObject({ id: "mark-1", signedCount: 19, complete: true });
  });

  /**
   * ⚠ Production's shape: a walk from before L-1 holding a p04 mark, and from before D-MVR1 holding
   * page 19's two. Twenty-one ROWS, eighteen real stops — and the transaction, counting rows, says
   * complete. The driver must not be told so.
   */
  it("does not count a mark on a withdrawn line towards the packet, whatever the transaction says", async () => {
    const rows = [
      { placement_id: "p04", signed_at: "2026-09-17T12:00:00Z" },
      { placement_id: "p19a", signed_at: "2026-09-17T12:00:00Z" },
      { placement_id: "p19b", signed_at: "2026-09-17T12:00:00Z" },
      ...driverPlacements(null).filter((p) => p.id !== "p31b").map((p) => ({ placement_id: p.id, signed_at: "2026-09-17T12:00:00Z" })),
    ];
    const rec = createSupabaseRecorder({
      tables: { application_invitations: [invitation()], application_packet_marks: rows },
      rpc: { record_packet_mark: { mark_id: "m-21", signed_count: 21, complete: true } },
    });
    const result = await recordPacketMark(rec.client, TOKEN, body("p31a"), CTX, NOW);
    expect(result).toMatchObject({ signedCount: 18, complete: false });
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

  /**
   * ⚠ L-1: page 4 is the driver's line on the paper and is withdrawn from signing. A page loaded
   * before the withdrawal shipped still holds it as a stop; the server is what refuses it, with its
   * own code, so the trace does not send anybody looking for a ceremony that walked the wrong person.
   */
  it("refuses a line withdrawn from signing, and reaches no transaction", async () => {
    const rec = seed();
    const result = await recordPacketMark(rec.client, TOKEN, body("p04"), CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("packet_mark_withdrawn");
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

  /**
   * ⚠ AF5 (D-AF3, 0369): approved is no longer enough. This is the state production's one unfiled
   * walk is in — approved on the old rule, never opened — and it is what a driver meets from home.
   */
  it("refuses an approved packet the office has not opened in person, and reaches no transaction", async () => {
    const rec = seed({ inv: invitation({ signing_opened_at: null }) });
    const result = await recordPacketMark(rec.client, TOKEN, body("p03"), CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("packet_not_opened");
    expect(isIntakeError(result) && result.message).toContain("office");
    expect(rec.rpcs()).toHaveLength(0);
  });

  /** ⚠ 0369's order: a filed packet that was never opened says it is FILED, the true reason. */
  it("answers filed, not unopened, for a filed packet nobody opened", async () => {
    const rec = seed({ inv: invitation({ signing_opened_at: null, submitted_at: "2026-09-14T11:00:00Z" }) });
    const result = await recordPacketMark(rec.client, TOKEN, body("p03"), CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("already_submitted");
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
    ["DR036", "packet_not_opened", "packet_not_opened"],
    ["DR030", "application_invitation_not_found", "invalid_link"],
    ["DR031", "application_invitation_unusable", "invalid_link"],
  ])("turns %s into %s", async (code, message, expected) => {
    const rec = failing(code, message);
    const result = await recordPacketMark(rec.client, TOKEN, body("p03"), CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe(expected);
  });
});

/**
 * ⚠ A0, 2026-09-17. The first signing ceremony this product ever ran stopped two places short and
 * the only evidence it left was an absence — twenty rows where twenty-two belonged. A stop that does
 * not land is a permanent dead end (`usePacketCeremony.sign()` advances only on a 201), so a refusal
 * nobody can find is the expensive kind of silence.
 *
 * ⚠ These do not cover the refusal that actually happened: `p31a` was refused by the rate limiter in
 * `app.ts`, above this module, and is pinned there by *"says so in the log when it refuses an
 * applicant"*.
 */
describe("a refused mark leaves a trace", () => {
  const captureWarnings = (): { lines: unknown[][]; restore: () => void } => {
    const lines: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void lines.push(args);
    return { lines, restore: () => void (console.warn = original) };
  };

  it("names the code, the placement and the invitation, and no more than that", async () => {
    const warn = captureWarnings();
    try {
      const rec = seed({ inv: invitation({ approved_at: null }) });
      await recordPacketMark(rec.client, TOKEN, body("p31a", "Miroslav Jokovic"), CTX, NOW);
      expect(warn.lines).toHaveLength(1);
      expect(warn.lines[0]![0]).toBe("[packet-mark] refused");
      expect(warn.lines[0]![1]).toEqual({
        code: "packet_not_yet_approved",
        placement: "p31a",
        invitation: "inv-1",
      });
    } finally {
      warn.restore();
    }
  });

  /**
   * ⚠ The token is the credential for a live application and the name is the applicant's. Neither
   * belongs in a log line that Railway retains — the blindness A0 cured must not be paid for with a
   * signing link in a log.
   */
  it("keeps the token and the applicant's name out of the line", async () => {
    const warn = captureWarnings();
    try {
      const rec = seed({ inv: invitation({ submitted_at: "2026-09-14T11:00:00Z" }) });
      await recordPacketMark(rec.client, TOKEN, body("p03", "Marija Varmeda"), CTX, NOW);
      // ⚠ First, that there IS a line. Three `not.toContain`s over an empty array pass perfectly and
      // prove nothing — which is precisely what they did when this branch was mutated to check.
      expect(warn.lines).toHaveLength(1);
      const printed = JSON.stringify(warn.lines);
      expect(printed).not.toContain(TOKEN);
      expect(printed).not.toContain("Marija Varmeda");
      expect(printed).not.toContain(CTX.ip);
    } finally {
      warn.restore();
    }
  });

  /** A mark that lands is not an event — twenty-two lines per applicant would bury the one that is. */
  it("says nothing when the mark lands", async () => {
    const warn = captureWarnings();
    try {
      const rec = seed();
      await recordPacketMark(rec.client, TOKEN, body("p03"), CTX, NOW);
      expect(warn.lines).toEqual([]);
    } finally {
      warn.restore();
    }
  });
});

describe("the queue the ceremony walks", () => {
  it("serves the driver's stops in the packet's own page order", async () => {
    const rec = seed();
    const stops = await packetStops(rec.client, ORG, "inv-1");
    expect(stops).toHaveLength(19);
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
    expect(stops).toHaveLength(19);
    expect(stops.find((s) => s.id === "p03")!.signedAt).toBe("2026-09-14T11:00:00Z");
    expect(stops.find((s) => s.id === "p11b")!.signedAt).toBe("2026-09-14T11:01:00Z");
    // ⚠ p11a and p11b sit on the same page and differ only in what they say. A queue keyed on the
    // page would have marked both.
    expect(stops.find((s) => s.id === "p11a")!.signedAt).toBeNull();
    expect(stops.filter((s) => s.signedAt === null)).toHaveLength(17);
  });

  it("scopes the read to the org the token resolved to", async () => {
    const rec = seed();
    await packetStops(rec.client, ORG, "inv-1");
    expectOrgScoped(rec, ORG);
    const q = rec.forTable("application_packet_marks")[0]!;
    expect(q.filters()).toContainEqual({ col: "invitation_id", val: "inv-1" });
  });
});

/**
 * The marks this link has already adopted (Q-PKT9, answered 2026-09-14).
 *
 * ⚠ Served back to the token-holder so a RESUMED walk does not ask them to retype a mark the
 * database has pinned and then refuse them at the next stop with DR035.
 */
describe("what this link has already adopted", () => {
  const seedMarks = (marks: Array<{ mark: string; signed_name: string }>) =>
    createSupabaseRecorder({ tables: { application_packet_marks: marks } });

  it("answers null on both for a link nobody has signed on", async () => {
    const rec = seedMarks([]);
    expect(await adoptedPacketMarks(rec.client, ORG, "inv-1")).toEqual({ signature: null, initials: null });
  });

  /**
   * ⚠ **Read by KIND, never by position.** The pin is per (invitation, mark kind) since 0340, so the
   * first row of ANY kind is not the signature — this fixture puts an INITIALS row first, which is
   * the arrangement that made `packetIsSignedThrough` answer wrongly before Q-PKT8.
   */
  it("finds the signature even when an initials row comes back first", async () => {
    const rec = seedMarks([
      { mark: "initials", signed_name: "MV" },
      { mark: "signature", signed_name: "Marija Varmeda" },
    ]);
    expect(await adoptedPacketMarks(rec.client, ORG, "inv-1")).toEqual({
      signature: "Marija Varmeda",
      initials: "MV",
    });
  });

  it("answers null for a kind this link has not adopted yet", async () => {
    const rec = seedMarks([{ mark: "signature", signed_name: "Marija Varmeda" }]);
    const adopted = await adoptedPacketMarks(rec.client, ORG, "inv-1");
    expect(adopted.signature).toBe("Marija Varmeda");
    expect(adopted.initials).toBeNull();
  });

  /** ⚠ The service role bypasses RLS, so the scope has to be in the query. */
  it("scopes the read to the org and the invitation", async () => {
    const rec = seedMarks([{ mark: "signature", signed_name: "Marija Varmeda" }]);
    await adoptedPacketMarks(rec.client, ORG, "inv-1");
    const q = rec.forTable("application_packet_marks")[0]!;
    expect(q.filters()).toContainEqual({ col: "org_id", val: ORG });
    expect(q.filters()).toContainEqual({ col: "invitation_id", val: "inv-1" });
  });
});

/**
 * Q-HM14 (ruled (b), 2026-09-24; memorandum Q15): a company driver is not asked to sign page 31 "as
 * the owner-operator". Every answer the server gives about the walk — the queue served, the stop
 * refused, the count the database stamps, `complete` — is asked of ONE read of the draft's answer.
 */
describe("a company driver's walk", () => {
  it("is served without p31b, and an owner-operator's with it", async () => {
    const company = await packetStops(seed({ applyingAs: "company_driver" }).client, ORG, "inv-1");
    expect(company.map((s) => s.id)).not.toContain("p31b");
    expect(company.map((s) => s.id)).toContain("p31a");
    expect(company).toHaveLength(18);
    const op = await packetStops(seed({ applyingAs: "owner_operator" }).client, ORG, "inv-1");
    expect(op.at(-1)!.id).toBe("p31b");
    // ⚠ No draft, or no answer in it, is the paper as printed.
    expect(await packetStops(seed({ applyingAs: null }).client, ORG, "inv-1")).toHaveLength(19);
  });

  it("reads one key of the draft by path, scoped to the org, and never its payload", async () => {
    const rec = seed({ applyingAs: "company_driver" });
    await packetStops(rec.client, ORG, "inv-1");
    expectOrgScoped(rec, ORG);
    const q = rec.forTable("application_drafts")[0]!;
    expect(q.filters()).toContainEqual({ col: "invitation_id", val: "inv-1" });
    expect(q.ops.find((o) => o.method === "select")?.args[0]).toBe(
      "applying_as:payload->questionnaire->>applying_as",
    );
  });

  it("refuses p31b as a conflict, before the transaction, naming why", async () => {
    const rec = seed({ applyingAs: "company_driver" });
    const result = await recordPacketMark(rec.client, TOKEN, body("p31b"), CTX, NOW);
    expect(result).toMatchObject({ code: "packet_mark_not_their_capacity" });
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("tells the transaction their count, and is complete at eighteen", async () => {
    const twenty = driverPlacements("company_driver").map((p) => ({ placement_id: p.id, signed_at: "2026-09-24T12:00:00Z" }));
    const rec = seed({ applyingAs: "company_driver", marks: twenty });
    const result = await recordPacketMark(rec.client, TOKEN, body("p31a"), CTX, NOW);
    expect((rec.rpcs()[0]!.args as Record<string, unknown>).p_expected_count).toBe(18);
    expect(result).toMatchObject({ signedCount: 18, complete: true });
  });

  it("does not count a p31b recorded before the answer changed", async () => {
    const every = driverPlacements(null).map((p) => ({ placement_id: p.id, signed_at: "2026-09-24T12:00:00Z" }));
    const withoutP03 = every.filter((m) => m.placement_id !== "p03");
    const rec = seed({ applyingAs: "company_driver", marks: withoutP03 });
    const result = await recordPacketMark(rec.client, TOKEN, body("p03"), CTX, NOW);
    // Eighteen ROWS, one of them p31b: seventeen of a company driver's eighteen stops.
    expect(result).toMatchObject({ signedCount: 17, complete: false });
  });
});
