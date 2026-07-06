import { describe, it, expect } from "vitest";
import { renderDigestEmail, renderInviteEmail } from "./email.js";

describe("renderInviteEmail", () => {
  it("includes the org, the accept link, and escapes html", () => {
    const m = renderInviteEmail("Silvicom", "https://app/accept-invite?token=abc");
    expect(m.subject).toContain("Silvicom");
    expect(m.html).toContain("https://app/accept-invite?token=abc");
    expect(m.text).toContain("https://app/accept-invite?token=abc");
  });
});

describe("renderDigestEmail", () => {
  it("renders the AI summary, the stat chips, and repeat offenders", () => {
    const m = renderDigestEmail("Silvicom", "Two high-risk cases this week.\n\nWatch Unit 637.", {
      alertCount: 2,
      siphonCount: 1,
      declineAlertCount: 0,
      topVehicles: [{ unit: "637", count: 3 }],
      appUrl: "https://app",
    });
    expect(m.subject).toContain("weekly fuel-theft digest");
    expect(m.html).toContain("Two high-risk cases this week.");
    expect(m.html).toContain("637 (3)");
    expect(m.text).toContain("High/critical alerts: 2");
  });

  it("omits the data-health line when no health is provided", () => {
    const m = renderDigestEmail("Silvicom", "Quiet week.", {
      alertCount: 0, siphonCount: 0, declineAlertCount: 0, topVehicles: [], appUrl: "https://app",
    });
    expect(m.html).not.toContain("Data health");
    expect(m.text).not.toContain("Data health");
  });

  it("renders a clean data-health line (no drift, no failures)", () => {
    const m = renderDigestEmail("Silvicom", "Quiet week.", {
      alertCount: 0, siphonCount: 0, declineAlertCount: 0, topVehicles: [], appUrl: "https://app",
      health: { lastCheckLabel: "8h ago", driftFixed: 0, syncFailures: 0 },
    });
    expect(m.html).toContain("Data health");
    expect(m.html).toContain("last integrity check 8h ago");
    expect(m.html).toContain("no data drift");
    expect(m.text).toContain("Data health: last integrity check 8h ago");
  });

  it("surfaces drift repaired and sync failures when present", () => {
    const m = renderDigestEmail("Silvicom", "Busy week.", {
      alertCount: 1, siphonCount: 0, declineAlertCount: 0, topVehicles: [], appUrl: "https://app",
      health: { lastCheckLabel: "2h ago", driftFixed: 4, syncFailures: 2 },
    });
    expect(m.html).toContain("4 row(s) of drift repaired");
    expect(m.html).toContain("2 sync failure(s)");
    expect(m.text).toContain("Settings → Data & Sync");
  });
});
