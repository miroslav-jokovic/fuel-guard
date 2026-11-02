import { describe, expect, it } from "vitest";
import {
  RECRUITING_MESSAGES,
  RECRUITING_MESSAGE_KEYS,
  STANDARD_WORDING,
  fillPlaceholders,
  isGsm7,
  messagePartIssue,
  messageWordingIssues,
  messageWordingSaveSchema,
  resolveMessageParts,
  textMessageParts,
} from "./recruitingMessages.js";
import { renderApplicantEmail, renderApplicantText } from "./applicantMessages.js";

/**
 * The carrier's wording for an applicant's messages (HIRING-WORKFLOW-AUDIT §12 MT2): the closed
 * placeholder list, the one-line and GSM-7 rules, the standard words as the default, and the fixed pieces
 * — link, expiry, dead-link caveat, rates / HELP / STOP — that no wording can remove.
 */
const VARS = { carrier: "Acme Freight", firstName: "Pat", days: 14 };
const W = (over: Partial<typeof STANDARD_WORDING>) => ({ ...STANDARD_WORDING, ...over });

describe("the catalogue", () => {
  it("lists each key once, in the order Settings shows them", () => {
    expect(RECRUITING_MESSAGES.map((m) => m.key)).toEqual([...RECRUITING_MESSAGE_KEYS]);
  });

  it("offers {days} only on the messages that carry an expiry", () => {
    const withDays = RECRUITING_MESSAGES.filter((m) => m.placeholders.includes("days")).map((m) => m.key);
    expect(withDays).toEqual(["invitation", "application_ready", "videos"]);
  });
});

describe("placeholders", () => {
  it("fills first name, carrier and days; an unknown first name reads 'there'", () => {
    expect(fillPlaceholders("Hi {first_name} — {carrier}, {days}", VARS)).toBe("Hi Pat — Acme Freight, 14 days");
    expect(fillPlaceholders("Hi {first_name}", { ...VARS, firstName: null })).toBe("Hi there");
    expect(fillPlaceholders("{days}", { ...VARS, days: 1 })).toBe("1 day");
  });

  it("refuses a placeholder the message does not have, and a misspelt one, naming it", () => {
    expect(messagePartIssue("reminder", "emailParagraph", "You have {days}")).toContain("{days}");
    expect(messagePartIssue("invitation", "emailSubject", "Hi {frist_name}")).toContain("{frist_name}");
    expect(messagePartIssue("invitation", "emailSubject", "Hi {first_name}")).toBeNull();
  });

  it("refuses a stray brace outside a placeholder", () => {
    expect(messagePartIssue("invitation", "emailParagraph", "Bring a {pen")).not.toBeNull();
    expect(messagePartIssue("invitation", "emailParagraph", "Bring a pen}")).not.toBeNull();
  });
});

describe("the part rules", () => {
  it("keeps the subject, heading and lead to one line; the paragraph may have several", () => {
    for (const p of ["emailSubject", "emailHeading", "textLead"] as const) {
      expect(messagePartIssue("invitation", p, "a\nb")).toBe("Keep this to one line.");
    }
    expect(messagePartIssue("invitation", "emailParagraph", "a\nb")).toBeNull();
  });

  it("holds the text lead to GSM-7 — a curly quote or an emoji is refused, plain punctuation is not", () => {
    expect(messagePartIssue("invitation", "textLead", "It’s ready:")).toContain("plain characters");
    expect(messagePartIssue("invitation", "textLead", "Ready 🚚")).toContain("plain characters");
    expect(messagePartIssue("invitation", "textLead", "It's ready, Pat! Tap: (2 min)")).toBeNull();
    // The email parts are not texts: a curly quote is fine there.
    expect(messagePartIssue("invitation", "emailSubject", "It’s ready")).toBeNull();
  });

  it("collects every part's issue for one save", () => {
    expect(Object.keys(messageWordingIssues("reminder", W({ emailSubject: "a\nb", textLead: "x {days}" })))).toEqual(["emailSubject", "textLead"]);
    expect(messageWordingIssues("reminder", STANDARD_WORDING)).toEqual({});
  });

  it("reads an empty or blank part as null — the standard words — and refuses one over its limit", () => {
    expect(messageWordingSaveSchema.parse({ emailSubject: "  ", emailHeading: "", emailParagraph: null, textLead: " Hi " }))
      .toEqual({ emailSubject: null, emailHeading: null, emailParagraph: null, textLead: "Hi" });
    expect(messageWordingSaveSchema.safeParse({ ...STANDARD_WORDING, textLead: "x".repeat(121) }).success).toBe(false);
    expect(messageWordingSaveSchema.safeParse({ ...STANDARD_WORDING, emailParagraph: "x".repeat(1001) }).success).toBe(false);
    expect(messageWordingSaveSchema.safeParse({ emailSubject: null }).success).toBe(false);
  });
});

describe("GSM-7 and text parts", () => {
  it("counts 160 plain characters as one part, 161 as two, and a UCS-2 text in 70s", () => {
    expect(isGsm7("Hello [world] €5")).toBe(true);
    expect(textMessageParts("x".repeat(160))).toBe(1);
    expect(textMessageParts("x".repeat(161))).toBe(2);
    // Each extension character costs two.
    expect(textMessageParts("€".repeat(80))).toBe(1);
    expect(textMessageParts("€".repeat(81))).toBe(2);
    expect(textMessageParts("’".repeat(70))).toBe(1);
    expect(textMessageParts("’".repeat(71))).toBe(2);
  });
});

describe("what goes out", () => {
  it("is the standard words where the carrier wrote nothing", () => {
    for (const key of RECRUITING_MESSAGE_KEYS) {
      const std = RECRUITING_MESSAGES.find((m) => m.key === key)!.standardParts(VARS);
      expect(resolveMessageParts(key, VARS)).toEqual(std);
    }
  });

  it("is the carrier's part, filled, where it wrote one — and only that part", () => {
    const p = resolveMessageParts("invitation", VARS, W({ emailHeading: "Welcome, {first_name}" }));
    expect(p.emailHeading).toBe("Welcome, Pat");
    expect(p.emailSubject).toBe("Your driver application for Acme Freight");
  });

  it.each(["invitation", "application_ready", "videos"] as const)(
    "%s's email keeps the button, the pasted link and the expiry whatever the carrier wrote",
    (key) => {
      const mail = renderApplicantEmail(key, VARS, "https://app.test/apply/tok", W({
        emailSubject: "S", emailHeading: "H", emailParagraph: "P",
      }));
      expect(mail.subject).toBe("S");
      expect(mail.html).toContain('href="https://app.test/apply/tok"');
      expect(mail.html).toContain("paste this link into your browser");
      expect(mail.text).toContain("https://app.test/apply/tok");
      expect(mail.text).toContain("stops working in 14 days");
    },
  );

  it("says the earlier link is dead in every message that rotates it, whatever the carrier wrote", () => {
    const w = W({ emailParagraph: "P", textLead: "L:" });
    expect(renderApplicantEmail("application_ready", VARS, "u", w).text).toContain("no longer works");
    expect(renderApplicantEmail("videos", VARS, "u", w).text).toContain("no longer works");
    expect(renderApplicantEmail("reminder", VARS, "u", w).text).toContain("no longer works");
    expect(renderApplicantText("application_ready", VARS, "u", w)).toContain("Your earlier link no longer works.");
    expect(renderApplicantText("reminder", VARS, "u", w)).toContain("This link replaces any earlier one.");
  });

  it("escapes the carrier's words in the html and keeps a paragraph's line breaks", () => {
    const mail = renderApplicantEmail("invitation", VARS, "u", W({ emailHeading: "<b>Hi</b>", emailParagraph: "One\nTwo & <i>" }));
    expect(mail.html).toContain("&lt;b&gt;Hi&lt;/b&gt;");
    expect(mail.html).toContain("One<br>Two &amp; &lt;i&gt;");
    expect(mail.html).not.toContain("<b>Hi</b>");
    expect(mail.text).toContain("One\nTwo & <i>");
  });

  it("gives the reminder a heading only when the carrier writes one", () => {
    expect(renderApplicantEmail("reminder", VARS, "u").html).not.toContain("<h2");
    expect(renderApplicantEmail("reminder", VARS, "u", W({ emailHeading: "Still there?" })).html).toContain("<h2");
  });

  it.each(RECRUITING_MESSAGE_KEYS)("%s's text starts with the carrier's name and ends with STOP, around the carrier's lead", (key) => {
    const t = renderApplicantText(key, VARS, "https://app.test/apply/tok", W({ textLead: "Hi {first_name}, tap here:" }));
    expect(t.startsWith("Acme Freight: ")).toBe(true);
    expect(t).toContain("Hi Pat, tap here: https://app.test/apply/tok ");
    expect(t).toMatch(/STOP to opt out\.$/);
  });

  it("keeps the invitation text's attestation, rates and HELP in front of and behind any lead", () => {
    const t = renderApplicantText("invitation", VARS, "L", W({ textLead: "Tap:" }));
    expect(t).toBe("Acme Freight: You asked us to text you your driver application. Tap: L This link works for 14 days. "
      + "Msg & data rates may apply. Reply HELP for help, STOP to opt out.");
  });
});
