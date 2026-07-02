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
});
