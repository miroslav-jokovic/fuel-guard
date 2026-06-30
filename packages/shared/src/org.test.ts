import { describe, it, expect } from "vitest";
import { orgSettingsFormSchema, renderAnomalyAlertEmail } from "./index.js";

describe("orgSettingsFormSchema", () => {
  const base = {
    name: "Silvicom Inc.",
    operating_hours: { start: "05:00", end: "20:00", tz: "America/Chicago" },
    notifications_enabled: true,
    notification_emails: ["ops@silvicominc.com"],
  };
  it("accepts valid settings", () => {
    expect(orgSettingsFormSchema.safeParse(base).success).toBe(true);
  });
  it("rejects a bad time format", () => {
    expect(orgSettingsFormSchema.safeParse({ ...base, operating_hours: { ...base.operating_hours, start: "5am" } }).success).toBe(false);
  });
  it("rejects an invalid notification email", () => {
    expect(orgSettingsFormSchema.safeParse({ ...base, notification_emails: ["nope"] }).success).toBe(false);
  });
});

describe("renderAnomalyAlertEmail", () => {
  const items = [
    { unit: "T-101", rule_id: "exceeds_tank_capacity", severity: "critical" as const, message: "Over tank capacity" },
    { unit: "T-104", rule_id: "mpg_deviation", severity: "high" as const, message: "MPG 18% below baseline" },
  ];
  const out = renderAnomalyAlertEmail("Silvicom Inc.", items, "https://app.example.com");

  it("summarizes count + criticality in the subject", () => {
    expect(out.subject).toContain("2");
    expect(out.subject).toContain("critical");
  });
  it("includes each vehicle and a review link", () => {
    expect(out.html).toContain("T-101");
    expect(out.html).toContain("T-104");
    expect(out.html).toContain("https://app.example.com/anomalies");
    expect(out.text).toContain("- T-101 [critical]");
  });
  it("escapes HTML in messages", () => {
    const evil = renderAnomalyAlertEmail("Org", [{ unit: "<b>x</b>", rule_id: "r", severity: "high", message: "a<script>" }], "https://x");
    expect(evil.html).not.toContain("<script>");
    expect(evil.html).toContain("&lt;script&gt;");
  });
});
