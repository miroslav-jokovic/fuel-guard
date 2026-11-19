import { describe, expect, it } from "vitest";
import { decodeHtmlAttr, findPilotQuoteLink, isPilotDocUrl, unwrapLink } from "./pilotQuoteLink.js";

/**
 * The email is rebuilt from its measured SHAPE (the 11/19 message, read 2026-11-18): Proofpoint v2 around SES
 * click tracking around Pilot's validate link, plus a second link to the customer portal. The real link is not
 * committed — its `hash` is the credential to a contract price file.
 */
const QUOTE = "https://docgenapex.apex.pilotcloud.net:443/apexdocs/validate?document=74ff1085-93c3-463c-affe-f97b3b921206&hash=Zm9vYmFy%3d";
const PORTAL = "https://customerportal.pilotflyingj.com/";

/** SES: the target, percent-encoded except `:` and `=` (as measured), as the first path segment after /L0/. */
const ses = (target: string) =>
  `https://rwwypr8z.r.us-east-1.awstrack.me/L0/${encodeURIComponent(target).replace(/%3A/g, ":").replace(/%3D/g, "=")}/1/0100019a-e9136b99-ab02-474e-8e64-94fa34656497-000000/AbCdEf=473`;

/** Proofpoint v2: percent-encode, then `%` → `-` and `/` → `_` (so a literal `-` arrives as `-2D`). */
const proofpoint = (target: string) => {
  const enc = target.replace(/[^A-Za-z0-9./]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
  return `https://urldefense.proofpoint.com/v2/url?u=${enc.replace(/%/g, "-").replace(/\//g, "_")}&amp;d=DwMCaQ&amp;c=abc&amp;r=def&amp;m=ghi&amp;s=jkl&amp;e=`;
};

const email = (...hrefs: string[]) =>
  `<html><body><p>PILOT PRICING: Please view the link below to view your price quote.</p>` +
  hrefs.map((h, i) => `<a href="${h}">${i === 0 ? "View Price Quote" : "https://customerportal.pilotflyingj.com/"}</a>`).join("") +
  `<p>Please note, this link will only be valid for up to 48 hours.</p></body></html>`;

describe("unwrapLink", () => {
  it("peels Proofpoint then SES back to Pilot's validate link, byte for byte", () => {
    expect(unwrapLink(proofpoint(ses(QUOTE)))).toBe(QUOTE);
  });

  it("matches the measured encoding: a '-' in the SES host arrives as -2D and a '%2F' inside SES as -252F", () => {
    const pp = proofpoint(ses(QUOTE));
    expect(pp).toContain("us-2Deast-2D1.awstrack.me_L0_https-3A-252F-252Fdocgenapex.apex.pilotcloud.net-3A443-252F");
    expect(pp).toContain("-2526hash-3DZm9vYmFy-25253d_1_");
  });

  it("leaves a link it does not recognise as a wrapper unchanged", () => {
    expect(unwrapLink(PORTAL)).toBe(PORTAL);
    const v3 = "https://urldefense.com/v3/__https://docgenapex.apex.pilotcloud.net/x__;!!abc$";
    expect(unwrapLink(v3)).toBe(v3);
  });

  it("does not throw on a broken percent sequence", () => {
    expect(() => unwrapLink("https://urldefense.proofpoint.com/v2/url?u=https-3A__x-ZZ")).not.toThrow();
  });
});

describe("decodeHtmlAttr", () => {
  it("decodes the entities Outlook writes in an href", () => {
    expect(decodeHtmlAttr("a?x=1&amp;y=2&#61;&#x3D;")).toBe("a?x=1&y=2==");
  });
});

describe("isPilotDocUrl", () => {
  it("accepts https on pilotcloud.net only", () => {
    expect(isPilotDocUrl(QUOTE)).toBe(true);
    expect(isPilotDocUrl(QUOTE.replace("https:", "http:"))).toBe(false);
    expect(isPilotDocUrl("https://docgenapex.apex.pilotcloud.net.evil.example/validate")).toBe(false);
    expect(isPilotDocUrl("https://evilpilotcloud.net/validate")).toBe(false);
    expect(isPilotDocUrl("https://user:pw@docgenapex.apex.pilotcloud.net/validate")).toBe(false);
    expect(isPilotDocUrl("not a url")).toBe(false);
  });
});

describe("findPilotQuoteLink", () => {
  it("finds the quote link in the measured email and skips the portal link", () => {
    expect(findPilotQuoteLink(email(proofpoint(ses(QUOTE)), proofpoint(ses(PORTAL))))).toBe(QUOTE);
  });

  it("finds it whatever order the links come in", () => {
    expect(findPilotQuoteLink(email(proofpoint(ses(PORTAL)), proofpoint(ses(QUOTE))))).toBe(QUOTE);
  });

  it("finds an unwrapped link (no mail gateway) and a single-quoted href", () => {
    expect(findPilotQuoteLink(`<a href='${QUOTE.replace(/&/g, "&amp;")}'>View</a>`)).toBe(QUOTE);
  });

  it("answers null for an email with only the portal link", () => {
    expect(findPilotQuoteLink(email(proofpoint(ses(PORTAL))))).toBeNull();
  });
});
