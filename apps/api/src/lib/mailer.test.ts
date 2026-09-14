import { describe, it, expect } from "vitest";
import { parseSender } from "./mailer.js";
import { loadEnv } from "../env.js";

describe("parseSender", () => {
  it("splits a display-name sender into name + email (for Brevo)", () => {
    expect(parseSender("Silvicom 360 <miki@silvicominc.com>")).toEqual({ name: "Silvicom 360", email: "miki@silvicominc.com" });
  });
  it("handles a bare email", () => {
    expect(parseSender("miki@silvicominc.com")).toEqual({ email: "miki@silvicominc.com" });
  });
  it("trims stray whitespace", () => {
    expect(parseSender("  Ops Team  <  ops@x.com  >")).toEqual({ name: "Ops Team", email: "ops@x.com" });
  });
});

/** Capture whatever `loadEnv` warns while it runs, without letting it reach the test output. */
function warningsFrom(source: NodeJS.ProcessEnv): string {
  const seen: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void seen.push(args.join(" "));
  try {
    loadEnv(source);
  } finally {
    console.warn = original;
  }
  return seen.join("\n");
}

/**
 * ⚠ **The first case here used to assert the opposite**, and the turn is the point of it.
 *
 * Brevo was preferred because it verifies a single sender with no DNS. That weighed setup effort
 * and missed what matters more: Brevo rewrites every link for click tracking and keeps the
 * destination URL in its event log, and the links this file carries are credentials. Measured
 * 2026-09-14 — a live invitation token came back out of `GET /v3/smtp/statistics/events` in
 * plaintext and its SHA-256 matched the invitation's `token_hash` exactly. Brevo cannot disable
 * transactional tracking below an Enterprise plan; Resend has it off by default on every domain.
 * So when both keys are present the safe provider has to win.
 */
describe("mail provider auto-detection", () => {
  it("prefers Resend when both keys are present, because Brevo logs every link it rewrites", () => {
    const env = loadEnv({ BREVO_API_KEY: "b", RESEND_API_KEY: "r" } as NodeJS.ProcessEnv);
    expect(env.MAIL_PROVIDER).toBe("resend");
  });
  it("still falls back to Brevo when it is the only key, rather than sending nothing at all", () => {
    const env = loadEnv({ BREVO_API_KEY: "b" } as NodeJS.ProcessEnv);
    expect(env.MAIL_PROVIDER).toBe("brevo");
  });
  it("falls back to Resend when only its key is set", () => {
    const env = loadEnv({ RESEND_API_KEY: "r" } as NodeJS.ProcessEnv);
    expect(env.MAIL_PROVIDER).toBe("resend");
  });
  it("respects an explicit MAIL_PROVIDER", () => {
    const env = loadEnv({ MAIL_PROVIDER: "brevo", RESEND_API_KEY: "r" } as NodeJS.ProcessEnv);
    expect(env.MAIL_PROVIDER).toBe("brevo");
  });

  /** No gate can see a Railway variable, so the deploy log is the only place this can be said. */
  it("warns on every boot that ends up on Brevo, whichever way it got there", () => {
    expect(warningsFrom({ BREVO_API_KEY: "b" } as NodeJS.ProcessEnv)).toMatch(/MAIL_PROVIDER=brevo/);
    expect(warningsFrom({ MAIL_PROVIDER: "brevo", RESEND_API_KEY: "r" } as NodeJS.ProcessEnv))
      .toMatch(/recoverable from/);
  });
  it("says nothing when the provider is Resend", () => {
    expect(warningsFrom({ RESEND_API_KEY: "r" } as NodeJS.ProcessEnv)).not.toMatch(/MAIL_PROVIDER/);
  });
});
