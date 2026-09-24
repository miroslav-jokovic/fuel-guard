import { describe, it, expect } from "vitest";
import {
  applicationInviteSubject,
  renderApplicationApprovedEmail,
  renderApplicationInviteEmail,
  renderDigestEmail,
  renderInviteEmail,
} from "./email.js";

describe("renderApplicationInviteEmail", () => {
  const mail = () =>
    renderApplicationInviteEmail("Silvicom Inc", "https://app.test/apply/tok3n", 7);

  it("puts the CARRIER in the subject, not this product", () => {
    // The applicant applied to a trucking company and has usually never heard of Silvicom 360. A subject
    // line naming the wrong party is the one that gets deleted unread.
    expect(mail().subject).toBe("Your driver application for Silvicom Inc");
    expect(`${mail().subject}${mail().html}${mail().text}`).not.toMatch(/Silvicom 360/);
  });

  it("carries the link in BOTH bodies — a text-only client must still be able to apply", () => {
    expect(mail().html).toContain("https://app.test/apply/tok3n");
    expect(mail().text).toContain("https://app.test/apply/tok3n");
  });

  it("states the expiry in the caller's own units, singular and plural", () => {
    expect(renderApplicationInviteEmail("A", "u", 1).text).toContain("in 1 day.");
    expect(renderApplicationInviteEmail("A", "u", 14).text).toContain("in 14 days.");
  });

  /**
   * The carrier's name comes from an `organizations` row somebody typed. It is interpolated into
   * HTML, so it is escaped — the same rule every other template here follows, asserted because a
   * template is exactly where escaping gets dropped during a rewrite.
   */
  it("escapes the carrier name", () => {
    const evil = renderApplicationInviteEmail('Ac<script>me & Co"', "https://x.test/apply/t", 7);
    expect(evil.html).not.toContain("<script>");
    expect(evil.html).toContain("&amp;");
  });

  /**
   * It must not read like the abandonment nudge, which opens "You started an application and it is
   * still saved" — a sentence about a draft that does not exist yet at this point in the flow.
   */
  it("does not claim the applicant has already started", () => {
    expect(mail().text).not.toMatch(/still saved|started an application|pick up where/i);
  });
  it("uses the one subject-line string, so the phrase an applicant searches for is what was sent", () => {
    expect(mail().subject).toBe(applicationInviteSubject("Silvicom Inc"));
  });
});

describe("renderApplicationApprovedEmail", () => {
  const mail = () => renderApplicationApprovedEmail("Silvicom Inc");
  const all = () => `${mail().subject}\n${mail().html}\n${mail().text}`;

  it("puts the CARRIER in the subject, not this product", () => {
    expect(mail().subject).toBe("Silvicom Inc has approved your application");
    expect(all()).not.toMatch(/Silvicom 360/);
  });

  /**
   * ⚠ THE test in this file, and it has now said three different things.
   *
   * Until 2026-09-18 this template carried no link because there was none to send (0220 stores one
   * SHA-256). A5b gave the invitation a second hash (0345) and the email carried a sign link. AF5
   * (D-AF3, 0369) moved signing into the office: every mark is refused until the office opens signing
   * at the desk, so a link here would open a packet that refuses every place on it. Both bodies,
   * because a text-only client is the one most likely to be tapped straight through.
   */
  it("carries no link at all, because signing now happens in the office", () => {
    expect(all()).not.toMatch(/\/apply\/|https?:\/\/|<a /);
  });

  it("tells them where they sign, and that the carrier will be in touch about the visit", () => {
    for (const body of [mail().text, mail().html]) {
      expect(body).toContain("You sign it in their office");
      expect(body).toContain("Silvicom Inc will contact you about coming in");
    }
  });

  /**
   * ⚠ Approved is not hired. The road test and orientation are still ahead, and a driver who reads
   * "hired" buys a ticket on a promise nobody made.
   */
  it("never tells them they are hired", () => {
    expect(all()).not.toMatch(/\bhired\b|welcome aboard|job offer/i);
  });

  /**
   * The line it must no longer say: "ready to sign" was the A5b subject, and it is false until the
   * office opens signing.
   */
  it("does not say the application is ready to sign on their link", () => {
    expect(all()).not.toMatch(/ready to sign|read it and sign|still works/i);
  });

  it("escapes the carrier name", () => {
    const evil = renderApplicationApprovedEmail('Ac<script>me & Co"');
    expect(evil.html).not.toContain("<script>");
    expect(evil.html).toContain("&amp;");
  });

  /**
   * The office may have corrected an answer, and §391.21(b)(12) has the applicant swear every entry
   * is true. Telling them nothing was lost and that changes are marked is what makes the signing
   * something other than a surprise.
   */
  it("says their answers survived and that corrections are marked", () => {
    expect(mail().text).toContain("Nothing you filled in has been lost");
    expect(mail().text).toContain("marked for you before you sign");
  });
});

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
