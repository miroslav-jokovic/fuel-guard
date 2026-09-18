import { describe, it, expect } from "vitest";
import {
  inviteState,
  liveApplicationInvitation,
  type ApplicationInvitation,
} from "./useApplicationInvites";

/**
 * What an invitation is doing right now, DERIVED rather than stored — the same rule the applicant
 * pipeline follows (H6). A status column here would need updating by whoever spends the link, and
 * the one thing that spends it is an unauthenticated stranger.
 */
const NOW = new Date("2026-08-20T12:00:00Z");
const invite = (over: Partial<ApplicationInvitation> = {}): ApplicationInvitation => ({
  id: "inv-1",
  driver_id: "d1",
  email: null,
  expires_at: "2026-09-01T00:00:00Z",
  consented_at: null,
  releases_completed_at: null,
  review_requested_at: null,
  approved_at: null,
  submitted_at: null,
  revoked_at: null,
  created_at: "2026-08-19T00:00:00Z",
  has_draft: false,
  ...over,
});

describe("an invitation's state", () => {
  it("is open while it is live and untouched", () => {
    expect(inviteState(invite(), NOW)).toBe("open");
  });

  it("is used once the applicant has submitted", () => {
    expect(inviteState(invite({ submitted_at: "2026-08-19T10:00:00Z" }), NOW)).toBe("used");
  });

  /**
   * A5. Before the ceremony existed nobody could be here: the link was open until it was spent, and
   * "the driver is part-way through signing" was a state the office could not see because nothing
   * called the signing endpoint.
   */
  it("is signing once the driver has consented but not yet sent it", () => {
    expect(inviteState(invite({ consented_at: "2026-08-19T09:00:00Z" }), NOW)).toBe("signing");
    expect(
      inviteState(invite({ consented_at: "2026-08-19T09:00:00Z", releases_completed_at: "2026-08-19T09:05:00Z" }), NOW),
    ).toBe("signing");
  });

  /** A spent link stays "submitted" even past its expiry — what happened outranks what lapsed. */
  it("reports a used link as used even after it would have expired", () => {
    expect(inviteState(invite({ submitted_at: "2026-08-19T10:00:00Z", expires_at: "2026-08-01T00:00:00Z" }), NOW)).toBe("used");
  });

  it("is revoked when a recruiter closed it", () => {
    expect(inviteState(invite({ revoked_at: "2026-08-19T11:00:00Z" }), NOW)).toBe("revoked");
    // Revoking a half-signed application is a thing a carrier may do; the signatures already given
    // stay, because a signature is evidence of what somebody consented to.
    expect(inviteState(invite({ consented_at: "2026-08-19T09:00:00Z", revoked_at: "2026-08-19T11:00:00Z" }), NOW)).toBe("revoked");
  });

  it("is expired once the window has passed", () => {
    expect(inviteState(invite({ expires_at: "2026-08-19T00:00:00Z" }), NOW)).toBe("expired");
  });
});

/**
 * ⚠ The four situations this function used to call `open`, and the owner met three of them in one
 * afternoon. It read `consented_at` — a stamp that is never set while the carrier's wording is draft,
 * which is the state of every carrier today — so a driver six screens in, an application waiting on
 * the office, and one already sent back to be signed all read the same as an untouched link.
 */
describe("what the office can now tell apart", () => {
  it("says the driver is filling it in, the moment anything is typed", () => {
    expect(inviteState(invite({ has_draft: true }), NOW)).toBe("filling");
  });

  it("stays open for a link nobody has opened", () => {
    expect(inviteState(invite(), NOW)).toBe("open");
  });

  it("names the one state where the CARRIER owes the next move", () => {
    expect(
      inviteState(invite({ has_draft: true, review_requested_at: "2026-08-19T10:00:00Z" }), NOW),
    ).toBe("awaiting_review");
  });

  it("and the one where the driver does", () => {
    expect(
      inviteState(
        invite({
          has_draft: true,
          review_requested_at: "2026-08-19T10:00:00Z",
          approved_at: "2026-08-19T11:00:00Z",
        }),
        NOW,
      ),
    ).toBe("approved");
  });

  it("⚠ lets the LINK's own state outrank the application's", () => {
    // A revoked link is not an application in progress, whatever the draft says — and the draft row
    // survives the revocation, so reading it without reading `revoked_at` would report a stopped
    // application as live.
    expect(
      inviteState(invite({ has_draft: true, review_requested_at: "2026-08-19T10:00:00Z", revoked_at: "2026-08-19T12:00:00Z" }), NOW),
    ).toBe("revoked");
    expect(
      inviteState(invite({ has_draft: true, expires_at: "2026-08-19T00:00:00Z" }), NOW),
    ).toBe("expired");
  });

  it("is used once it is signed and filed, whatever came before", () => {
    expect(
      inviteState(
        invite({
          has_draft: true,
          review_requested_at: "2026-08-19T10:00:00Z",
          approved_at: "2026-08-19T11:00:00Z",
          submitted_at: "2026-08-19T11:30:00Z",
        }),
        NOW,
      ),
    ).toBe("used");
  });
});

/**
 * Which application the office is looking at (B6).
 *
 * ⚠ **This rule also exists on the server, as a PostgREST filter**, and the two must agree —
 * `applicantChecklist.ts` writes it as `.is("revoked_at", null).order("created_at", desc).limit(1)`.
 * It is not one shared function because a fold cannot be handed to PostgREST, and making the server
 * read every invitation so both could call one is a worse trade than a named, tested pair.
 */
describe("the live invitation", () => {
  const at = (id: string, created: string, revoked: string | null = null) =>
    invite({ id, created_at: created, revoked_at: revoked });

  it("is the newest, whatever order the rows arrive in", () => {
    const rows = [
      at("old", "2026-08-01T00:00:00Z"),
      at("new", "2026-08-19T00:00:00Z"),
      at("middle", "2026-08-10T00:00:00Z"),
    ];
    expect(liveApplicationInvitation(rows)?.id).toBe("new");
  });

  /**
   * ⚠ The half that was MISSING from the server's rule until B4, and it was a real divergence: the
   * same driver could be described by two different applications on two adjacent surfaces, which is
   * D-HM2's failure named exactly. A revoked row is dead everywhere or it is dead nowhere.
   */
  it("skips a revoked row even when it is the newest", () => {
    const rows = [
      at("live", "2026-08-10T00:00:00Z"),
      at("revoked", "2026-08-19T00:00:00Z", "2026-08-19T01:00:00Z"),
    ];
    expect(liveApplicationInvitation(rows)?.id).toBe("live");
  });

  it("is null when every invitation has been revoked, and null when there are none", () => {
    expect(liveApplicationInvitation([at("a", "2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z")])).toBeNull();
    expect(liveApplicationInvitation([])).toBeNull();
  });
});
