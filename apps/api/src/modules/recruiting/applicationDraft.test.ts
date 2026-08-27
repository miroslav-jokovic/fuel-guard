import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { DRAFT_PAYLOAD_MAX_BYTES } from "@silvicom/shared";
import { hashInvitationToken } from "./applicationIntake.js";
import { isIntakeError } from "./applicationIntake.js";
import { loadDraft, saveDraft, unlockDraft, viewDraft } from "./applicationDraft.js";

/**
 * The saved draft (A2).
 *
 * Two properties carry this file. The draft is PRUNABLE data holding a date of birth, so the bare
 * link must not read one back (D-APP16); and the tenant scope is explicit on every query, because
 * the service role bypasses RLS and the id came from a token rather than from a session.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const NOW = new Date("2026-08-21T00:00:00Z");
const TOKEN = "c".repeat(43);

const invitation = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  org_id: ORG,
  driver_id: DRIVER,
  token_hash: hashInvitationToken(TOKEN),
  expires_at: "2026-09-01T00:00:00Z",
  revoked_at: null,
  consented_at: null,
  releases_completed_at: null,
  submitted_at: null,
  ...over,
});

const draftRow = (payload: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  payload,
  furthest_section: "identity",
  updated_at: "2026-08-21T09:00:00Z",
  ...over,
});

const seed = (
  opts: { inv?: Record<string, unknown> | null; draft?: Record<string, unknown> | null } = {},
) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: opts.inv === null ? [] : [opts.inv ?? invitation()],
      application_drafts: opts.draft === undefined ? [] : opts.draft === null ? [] : [opts.draft],
    },
    rpc: { save_application_draft: { draft_id: "d-1", updated_at: "2026-08-21T09:05:00Z" } },
  });

const BODY = { payload: { first_name: "Susan" }, section: "identity" };

describe("saving a draft", () => {
  it("writes through the RPC with the org and driver the TOKEN resolved to", async () => {
    const rec = seed();
    const result = await saveDraft(rec.client, TOKEN, BODY, NOW);
    expect(isIntakeError(result)).toBe(false);
    const args = rec.rpcs()[0]!.args as Record<string, unknown>;
    expect(args.p_org).toBe(ORG);
    expect(args.p_driver).toBe(DRIVER);
    expect(args.p_invitation).toBe("inv-1");
    expect(args.p_section).toBe("identity");
  });

  it("refuses on a dead link and writes nothing", async () => {
    const rec = seed({ inv: null });
    const result = await saveDraft(rec.client, TOKEN, BODY, NOW);
    expect(isIntakeError(result) && result.code).toBe("invalid_link");
    expect(rec.rpcs()).toHaveLength(0);
  });

  /** Once the application is filed the certified payload is the record; a later draft could only
   *  ever disagree with it. */
  it("refuses once the application has been submitted", async () => {
    const rec = seed({ inv: invitation({ submitted_at: "2026-08-20T00:00:00Z" }) });
    const result = await saveDraft(rec.client, TOKEN, BODY, NOW);
    expect(isIntakeError(result) && result.code).toBe("already_submitted");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("caps the payload rather than letting a link become free storage", async () => {
    const rec = seed();
    const huge = { blob: "x".repeat(DRAFT_PAYLOAD_MAX_BYTES + 1) };
    const result = await saveDraft(rec.client, TOKEN, { payload: huge, section: null }, NOW);
    expect(isIntakeError(result) && result.code).toBe("draft_too_large");
    expect(rec.rpcs()).toHaveLength(0);
  });
});

/**
 * D-APP16. The link is a session and A10 re-sends it by email; an email is forwarded and a phone is
 * shared. Once a draft holds a date of birth, the bare token stops being enough to read it.
 */
describe("the read gate", () => {
  it("returns the body while there is nothing sensitive in it", () => {
    const view = viewDraft(draftRow({ first_name: "Susan" }));
    expect(view.locked).toBe(false);
    expect(view.payload).toEqual({ first_name: "Susan" });
  });

  it("withholds the body once a date of birth is typed, but still says where they were", () => {
    const view = viewDraft(draftRow({ first_name: "Susan", date_of_birth: "1980-04-01" }));
    expect(view.locked).toBe(true);
    expect(view.payload).toBeNull();
    // The driver still gets to see that a draft exists and how far they got — that is not the
    // secret, and hiding it would make a resumed session look like a lost one.
    expect(view.furthestSection).toBe("identity");
  });

  it("treats a half-typed or blank date of birth as no date of birth", () => {
    expect(viewDraft(draftRow({ date_of_birth: "" })).locked).toBe(false);
    expect(viewDraft(draftRow({ date_of_birth: "   " })).locked).toBe(false);
    // Unvalidated by design, so the wrong type is a state that actually occurs.
    expect(viewDraft(draftRow({ date_of_birth: 19800401 })).locked).toBe(false);
  });

  it("scopes the read to the org the token resolved to", async () => {
    const rec = seed({ draft: draftRow({ first_name: "Susan" }) });
    await loadDraft(rec.client, ORG, "inv-1");
    const filters = JSON.stringify(rec.forTable("application_drafts")[0]!.filters());
    expect(filters).toContain(ORG);
    expect(filters).toContain("inv-1");
  });
});

/**
 * The service role bypasses RLS, so every query carries its own tenant scope — including the ones on
 * a table whose id is already unique, because that id arrived from a token rather than from a
 * session and the filter is what makes the provenance explicit.
 *
 * `application_invitations` is the one exemption, and it is the point of the whole design: the token
 * is resolved BY HASH to discover which org this is. There is no org to filter by yet, and accepting
 * one from the request is exactly what `publicApplication.ts` refuses to do.
 */
describe("tenant scoping", () => {
  const EXEMPT = { exempt: ["application_invitations"] };

  it("holds on the read", async () => {
    const rec = seed({ draft: draftRow({ first_name: "Susan" }) });
    await loadDraft(rec.client, ORG, "inv-1");
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("holds on the save", async () => {
    const rec = seed();
    await saveDraft(rec.client, TOKEN, BODY, NOW);
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("holds on the unlock", async () => {
    const rec = seed({ draft: draftRow({ date_of_birth: "1980-04-01" }) });
    await unlockDraft(rec.client, TOKEN, "1980-04-01", NOW);
    expectOrgScoped(rec, ORG, EXEMPT);
  });
});

describe("unlocking", () => {
  const locked = draftRow({ first_name: "Susan", date_of_birth: "1980-04-01" });

  it("hands back the body for the matching date of birth", async () => {
    const rec = seed({ draft: locked });
    const result = await unlockDraft(rec.client, TOKEN, "1980-04-01", NOW);
    expect(isIntakeError(result)).toBe(false);
    expect(isIntakeError(result) ? null : result.payload).toEqual({
      first_name: "Susan",
      date_of_birth: "1980-04-01",
    });
  });

  it("tolerates the whitespace a phone keyboard adds", async () => {
    const rec = seed({ draft: locked });
    const result = await unlockDraft(rec.client, TOKEN, " 1980-04-01 ", NOW);
    expect(isIntakeError(result) ? null : result.locked).toBe(false);
  });

  /** A wrong guess reveals nothing and burns nothing: no counter, no lockout, no stamp. A driver
   *  mistyping their own birthday must not need a support call. */
  it("returns the same locked view for a wrong date, and leaves the invitation alone", async () => {
    const rec = seed({ draft: locked });
    const result = await unlockDraft(rec.client, TOKEN, "1980-04-02", NOW);
    expect(isIntakeError(result)).toBe(false);
    expect(isIntakeError(result) ? null : result.locked).toBe(true);
    expect(isIntakeError(result) ? null : result.payload).toBeNull();
    expect(rec.writtenRows("application_invitations")).toHaveLength(0);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("is a no-op when there is nothing gated, and does not say whether a draft exists", async () => {
    const empty = await unlockDraft(seed({ draft: null }).client, TOKEN, "1980-04-01", NOW);
    const open = await unlockDraft(seed({ draft: draftRow({ first_name: "Susan" }) }).client, TOKEN, "1980-04-01", NOW);
    expect(isIntakeError(empty) ? null : empty.locked).toBe(false);
    expect(isIntakeError(open) ? null : open.locked).toBe(false);
  });

  it("refuses a dead link before it looks at anything", async () => {
    const rec = seed({ inv: null, draft: locked });
    const result = await unlockDraft(rec.client, TOKEN, "1980-04-01", NOW);
    expect(isIntakeError(result) && result.code).toBe("invalid_link");
    expect(rec.forTable("application_drafts")).toHaveLength(0);
  });
});
