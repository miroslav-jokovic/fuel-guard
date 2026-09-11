import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { hashInvitationToken, isIntakeError } from "./applicationIntake.js";
import { applicantVisibleEdits, requestReview } from "./applicationHandoff.js";

/**
 * The driver handing the application to the office (F4, D-AX11).
 *
 * ⚠ Two things are worth pinning and the rest is plumbing. **Idempotence**, because this is a button
 * on a phone with one bar of signal and a second tap must not move the phase again; and **what the
 * driver is shown of the office's corrections**, because the next thing they do is swear that every
 * entry is true, and that has to be true of the entries as they now stand.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "a".repeat(43);
const NOW = new Date("2026-09-11T12:00:00Z");

const invitation = (over: Record<string, unknown> = {}) => ({
  id: INV,
  org_id: ORG,
  driver_id: DRIVER,
  token_hash: hashInvitationToken(TOKEN),
  expires_at: "2026-10-01T00:00:00Z",
  revoked_at: null,
  consented_at: "2026-09-09T09:00:00Z",
  releases_completed_at: "2026-09-09T09:10:00Z",
  review_requested_at: null,
  approved_at: null,
  submitted_at: null,
  ...over,
});

const seed = (over: { invitation?: Record<string, unknown>; draft?: boolean; edits?: unknown[] } = {}) =>
  createSupabaseRecorder({
    tables: {
      // A function fixture, not an array: `supabaseRecorder` records `.eq()` and does not apply it,
      // so an array would answer another carrier's query with this carrier's row.
      application_invitations: (q) => {
        const row = over.invitation ?? invitation();
        const org = q.filters().find((f) => f.col === "org_id")?.val;
        return org !== undefined && org !== row.org_id ? [] : [row];
      },
      application_drafts: over.draft === false ? [] : [{ invitation_id: INV }],
      application_edits: (over.edits ?? []) as never,
      audit_logs: [],
    },
  });

describe("handing it to the office", () => {
  it("stamps when it was handed over, and records the act", async () => {
    const rec = seed();
    const result = await requestReview(rec.client, TOKEN, { ip: "1.2.3.4", userAgent: "a phone" }, NOW);
    expect(isIntakeError(result)).toBe(false);
    if (isIntakeError(result)) return;
    expect(result.reviewRequestedAt).toBe(NOW.toISOString());

    const written = rec.writtenRows("application_invitations")[0] as Record<string, unknown>;
    expect(written.review_requested_at).toBe(NOW.toISOString());
    // ⚠ Only that column. `submitted_at` is the certification's to stamp, and a hand-off that also
    // stamped it would file an uncertified application.
    expect(Object.keys(written)).toEqual(["review_requested_at"]);

    const audit = rec.writtenRows("audit_logs")[0] as Record<string, unknown>;
    expect(audit.action).toBe("application_review_requested");
    // An applicant is not a user of this system and has no row in `members`.
    expect(audit.actor_id).toBeNull();
  });

  it("⚠ a second tap changes nothing and is not an error", async () => {
    const rec = seed({ invitation: invitation({ review_requested_at: "2026-09-10T08:00:00Z" }) });
    const result = await requestReview(rec.client, TOKEN, { ip: null, userAgent: null }, NOW);
    expect(isIntakeError(result)).toBe(false);
    if (isIntakeError(result)) return;
    // The FIRST hand-off is the one that happened — the clock is not restarted.
    expect(result.reviewRequestedAt).toBe("2026-09-10T08:00:00Z");
    expect(rec.writtenRows("application_invitations")).toHaveLength(0);
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });

  it("writes only where the phase is still empty, because two taps race", async () => {
    // A check-then-write has a gap, and this is a button pressed twice on a slow connection.
    const rec = seed();
    await requestReview(rec.client, TOKEN, { ip: null, userAgent: null }, NOW);
    const filters = rec.writes().flatMap((q) => q.filters());
    expect(filters.some((f) => f.col === "review_requested_at" && f.val === null)).toBe(true);
  });

  it("refuses when there is nothing saved to read", async () => {
    // Stamping a phase over an empty draft puts a row in somebody's queue with nothing in it.
    const rec = seed({ draft: false });
    const result = await requestReview(rec.client, TOKEN, { ip: null, userAgent: null }, NOW);
    expect(isIntakeError(result) && result.code).toBe("nothing_to_review");
    expect(rec.writtenRows("application_invitations")).toHaveLength(0);
  });

  it("refuses once the application has been certified and filed", async () => {
    const rec = seed({ invitation: invitation({ submitted_at: "2026-09-10T10:00:00Z" }) });
    const result = await requestReview(rec.client, TOKEN, { ip: null, userAgent: null }, NOW);
    expect(isIntakeError(result) && result.code).toBe("already_submitted");
  });

  it("gives a dead link the same answer every dead link gets", async () => {
    const rec = seed({ invitation: invitation({ revoked_at: "2026-09-10T10:00:00Z" }) });
    const result = await requestReview(rec.client, TOKEN, { ip: null, userAgent: null }, NOW);
    expect(isIntakeError(result) && result.code).toBe("invalid_link");
  });

  it("scopes its write to the invitation's own org", async () => {
    // The service role bypasses RLS, so the filter is the only thing between two carriers.
    const rec = seed();
    await requestReview(rec.client, TOKEN, { ip: null, userAgent: null }, NOW);
    // ⚠ The invitation LOOKUP is exempt because it is by token hash: there is no org to filter by
    // until the token resolves, and this surface never accepts an org from a request. The write that
    // follows is the one that must carry it, so it is asserted directly rather than waived with it.
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations"] });
    const write = rec.writes().find((q) => q.table === "application_invitations");
    expect(write?.filters().some((f) => f.col === "org_id" && f.val === ORG)).toBe(true);
  });
});

describe("what the driver is shown of the office's corrections", () => {
  const EDIT = {
    path: ["employers", 0, "city"],
    before: "Jolliet",
    after: "Joliet",
    edited_at: "2026-09-11T09:00:00Z",
    edited_by: "cccccccc-dddd-4eee-8fff-000000000000",
  };

  it("gives the change and when, and NEVER who made it", async () => {
    // ⚠ The driver is owed what changed about their own statement before they swear to it. Which
    // member of staff typed it is the carrier's internal record, and naming an individual to an
    // applicant is a different thing from telling them the carrier corrected something.
    const rec = seed({ edits: [EDIT] });
    const shown = await applicantVisibleEdits(rec.client, ORG, INV);
    expect(shown).toEqual([
      { path: ["employers", 0, "city"], before: "Jolliet", after: "Joliet", editedAt: "2026-09-11T09:00:00Z" },
    ]);
    expect(JSON.stringify(shown)).not.toContain("cccccccc");
  });

  it("is empty for an application nobody corrected, which is most of them", async () => {
    const rec = seed();
    expect(await applicantVisibleEdits(rec.client, ORG, INV)).toEqual([]);
  });

  it("reads only this carrier's rows", async () => {
    const rec = seed({ edits: [EDIT] });
    await applicantVisibleEdits(rec.client, ORG, INV);
    expectOrgScoped(rec, ORG);
  });
});
