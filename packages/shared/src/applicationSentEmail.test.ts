import { describe, expect, it } from "vitest";
import { renderApplicationSentEmail } from "./applicationSentEmail.js";

describe("the application-sent email", () => {
  const mail = renderApplicationSentEmail("Silvicom <Inc>", "https://app.test/apply/abc", 14);

  it("names the carrier and carries the link in both bodies", () => {
    expect(mail.subject).toContain("Silvicom <Inc>");
    expect(mail.text).toContain("https://app.test/apply/abc");
    expect(mail.html).toContain("https://app.test/apply/abc");
  });

  /** ⚠ Sending rotates the link, so the first email's link is dead — and the applicant must be told. */
  it("says the earlier link no longer works, in both bodies", () => {
    expect(mail.text).toContain("the one in the earlier email no longer works");
    expect(mail.html).toContain("the one in the earlier email no");
  });

  it("escapes the carrier's name in the html", () => {
    expect(mail.html).not.toContain("<Inc>");
    expect(mail.html).toContain("&lt;Inc&gt;");
  });
});
