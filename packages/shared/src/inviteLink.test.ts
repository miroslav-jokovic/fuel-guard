import { describe, it, expect } from "vitest";
import {
  parseInviteUrl,
  hasSessionMaterial,
  inviteLinkErrorMessage,
} from "./inviteLink.js";

describe("parseInviteUrl", () => {
  it("reads the token_hash link we email", () => {
    const p = parseInviteUrl("https://app.silvicom.com/accept-invite?token_hash=abc123&type=invite");
    expect(p.verifyTokenHash).toBe("abc123");
    expect(p.verifyType).toBe("invite");
    expect(p.errorDescription).toBeNull();
    expect(hasSessionMaterial(p)).toBe(true);
  });

  it("reads a recovery link (a re-invite to an already-confirmed address)", () => {
    const p = parseInviteUrl("https://app.silvicom.com/accept-invite?token_hash=r1&type=recovery");
    expect(p.verifyType).toBe("recovery");
  });

  it("still reads the implicit-grant fragment, for links already in inboxes", () => {
    const p = parseInviteUrl(
      "https://app.silvicom.com/accept-invite#access_token=at&refresh_token=rt&type=invite",
    );
    expect(p.accessToken).toBe("at");
    expect(p.refreshToken).toBe("rt");
    expect(hasSessionMaterial(p)).toBe(true);
  });

  it("reads the PKCE code shape", () => {
    const p = parseInviteUrl("https://app.silvicom.com/accept-invite?code=pkce-code");
    expect(p.code).toBe("pkce-code");
    expect(hasSessionMaterial(p)).toBe(true);
  });

  it("treats `token` on a pasted /auth/v1/verify link as a token_hash, not our invite token", () => {
    const p = parseInviteUrl(
      "https://xyz.supabase.co/auth/v1/verify?token=hashed&type=invite&redirect_to=https%3A%2F%2Fapp.silvicom.com%2Faccept-invite",
    );
    expect(p.verifyTokenHash).toBe("hashed");
    expect(p.inviteToken).toBeNull();
  });

  it("digs our invite token out of a nested redirect_to", () => {
    const p = parseInviteUrl(
      "https://xyz.supabase.co/auth/v1/verify?token=hashed&type=invite&redirect_to=https%3A%2F%2Fapp.silvicom.com%2Faccept-invite%3Ftoken%3Dour-invite",
    );
    expect(p.inviteToken).toBe("our-invite");
    expect(p.verifyTokenHash).toBe("hashed");
  });

  it("surfaces the spent-link error fragment GoTrue redirects with", () => {
    const p = parseInviteUrl(
      "https://app.silvicom.com/accept-invite#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(p.errorDescription).toBe("Email link is invalid or has expired");
    expect(hasSessionMaterial(p)).toBe(false);
  });

  it("ignores a type it does not recognise rather than passing it to verifyOtp", () => {
    const p = parseInviteUrl("https://app.silvicom.com/accept-invite?token_hash=t&type=email_change");
    expect(p.verifyType).toBeNull();
  });

  it("survives a malformed redirect_to instead of throwing", () => {
    const p = parseInviteUrl("https://app.silvicom.com/accept-invite?redirect_to=%E0%A4%A");
    expect(p.inviteToken).toBeNull();
  });
});

describe("inviteLinkErrorMessage", () => {
  it("tells a user whose link was already used to ask for a resend", () => {
    const p = parseInviteUrl("https://app.silvicom.com/accept-invite#error=access_denied");
    expect(inviteLinkErrorMessage(p)).toMatch(/expired or was already used/);
  });

  it("distinguishes a bare visit from a spent link", () => {
    expect(inviteLinkErrorMessage(parseInviteUrl("https://app.silvicom.com/accept-invite"))).toMatch(
      /doesn’t look like an invitation link/,
    );
  });

  it("is null when the link can produce a session", () => {
    expect(
      inviteLinkErrorMessage(parseInviteUrl("https://app.silvicom.com/accept-invite?token_hash=a&type=invite")),
    ).toBeNull();
  });

  it("prefers the spent-link message when an error rides alongside stale tokens", () => {
    const p = parseInviteUrl(
      "https://app.silvicom.com/accept-invite#access_token=at&refresh_token=rt&error=access_denied",
    );
    expect(inviteLinkErrorMessage(p)).toMatch(/expired or was already used/);
  });
});
