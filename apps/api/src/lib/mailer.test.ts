import { describe, it, expect } from "vitest";
import { parseSender } from "./mailer.js";
import { loadEnv } from "../env.js";

describe("parseSender", () => {
  it("splits a display-name sender into name + email (for Brevo)", () => {
    expect(parseSender("FuelGuard <miki@silvicominc.com>")).toEqual({ name: "FuelGuard", email: "miki@silvicominc.com" });
  });
  it("handles a bare email", () => {
    expect(parseSender("miki@silvicominc.com")).toEqual({ email: "miki@silvicominc.com" });
  });
  it("trims stray whitespace", () => {
    expect(parseSender("  Ops Team  <  ops@x.com  >")).toEqual({ name: "Ops Team", email: "ops@x.com" });
  });
});

describe("mail provider auto-detection", () => {
  it("prefers Brevo when its key is present (even alongside Resend)", () => {
    const env = loadEnv({ BREVO_API_KEY: "b", RESEND_API_KEY: "r" } as NodeJS.ProcessEnv);
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
});
