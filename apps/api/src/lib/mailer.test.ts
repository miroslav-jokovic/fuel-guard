import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { parseSender, replyAddress, sendEmail } from "./mailer.js";
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

/**
 * Reply-To (2026-11-17): MAIL_FROM becomes the unread `no-reply@`, so a reply must be sent somewhere a
 * person reads — recruiting for applicant mail, the office's address for everything else.
 */
describe("Reply-To", () => {
  const base = { NODE_ENV: "test", MAIL_FROM: "Silvicom Inc <no-reply@silvicominc.com>" };
  const mail = { to: ["a@example.test"], subject: "s", html: "<p>h</p>", text: "t" };
  let bodies: Record<string, unknown>[] = [];
  beforeEach(() => {
    bodies = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return new Response("{}", { status: 200 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const both = { MAIL_REPLY_TO: "360@silvicominc.com", MAIL_REPLY_TO_RECRUITING: "recruiting@silvicominc.com" };

  it("Brevo carries the office address on office mail and recruiting's on applicant mail", async () => {
    const env = loadEnv({ ...base, MAIL_PROVIDER: "brevo", BREVO_API_KEY: "b", ...both } as NodeJS.ProcessEnv);
    await sendEmail(env, mail);
    await sendEmail(env, { ...mail, replyTo: "recruiting" });
    expect(bodies.map((b) => b.replyTo)).toEqual([{ email: "360@silvicominc.com" }, { email: "recruiting@silvicominc.com" }]);
    expect(bodies[0]!.sender).toEqual({ name: "Silvicom Inc", email: "no-reply@silvicominc.com" });
  });

  it("Resend carries the same two addresses as reply_to", async () => {
    const env = loadEnv({ ...base, MAIL_PROVIDER: "resend", RESEND_API_KEY: "r", ...both } as NodeJS.ProcessEnv);
    await sendEmail(env, mail);
    await sendEmail(env, { ...mail, replyTo: "recruiting" });
    expect(bodies.map((b) => b.reply_to)).toEqual(["360@silvicominc.com", "recruiting@silvicominc.com"]);
  });

  it("sends no Reply-To at all when neither is set, so a reply goes to MAIL_FROM as before", async () => {
    const env = loadEnv({ ...base, MAIL_PROVIDER: "brevo", BREVO_API_KEY: "b", MAIL_REPLY_TO: "" } as NodeJS.ProcessEnv);
    await sendEmail(env, { ...mail, replyTo: "recruiting" });
    expect(bodies[0]).not.toHaveProperty("replyTo");
  });

  it("answers an applicant at the office address when only that one is set", () => {
    expect(replyAddress({ MAIL_REPLY_TO: "360@silvicominc.com", MAIL_REPLY_TO_RECRUITING: undefined }, "recruiting")).toBe("360@silvicominc.com");
  });

  it("refuses to boot on a malformed address rather than send mail whose replies vanish", () => {
    expect(() => loadEnv({ ...base, MAIL_REPLY_TO_RECRUITING: "recruiting@" } as NodeJS.ProcessEnv)).toThrow(/MAIL_REPLY_TO_RECRUITING/);
  });
});
