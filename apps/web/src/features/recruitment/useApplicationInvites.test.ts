import { describe, it, expect } from "vitest";
import { inviteState, type ApplicationInvitation } from "./useApplicationInvites";

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
  used_at: null,
  revoked_at: null,
  created_at: "2026-08-19T00:00:00Z",
  ...over,
});

describe("an invitation's state", () => {
  it("is open while it is live and untouched", () => {
    expect(inviteState(invite(), NOW)).toBe("open");
  });

  it("is used once the applicant has submitted", () => {
    expect(inviteState(invite({ used_at: "2026-08-19T10:00:00Z" }), NOW)).toBe("used");
  });

  /** A spent link stays "submitted" even past its expiry — what happened outranks what lapsed. */
  it("reports a used link as used even after it would have expired", () => {
    expect(inviteState(invite({ used_at: "2026-08-19T10:00:00Z", expires_at: "2026-08-01T00:00:00Z" }), NOW)).toBe("used");
  });

  it("is revoked when a recruiter closed it", () => {
    expect(inviteState(invite({ revoked_at: "2026-08-19T11:00:00Z" }), NOW)).toBe("revoked");
  });

  it("is expired once the window has passed", () => {
    expect(inviteState(invite({ expires_at: "2026-08-19T00:00:00Z" }), NOW)).toBe("expired");
  });
});
