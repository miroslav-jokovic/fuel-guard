import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  CLEARINGHOUSE_FMCSA_PARAGRAPHS,
  CLEARINGHOUSE_SCOPE_PARAGRAPH,
  clearinghouseConsent,
} from "./clearinghouseConsent.js";

/**
 * The Clearinghouse limited-query consent, checked against FMCSA's published sample.
 *
 * ⚠ **Two things are separated here and the separation is the point.** FMCSA's own three
 * paragraphs must match the sample word for word. The scope paragraph beside them is OURS — the
 * answer to the bracketed question the sample hands back to the employer — and it must NOT appear
 * in the sample, because a test that found it there would mean somebody had quietly attributed our
 * drafting to the agency.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FORM = join(HERE, "../../../../../docs/plans/recruitment/clearinghouse-consent/SampleLimitedQueryConsent.txt");

const flatten = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * ⚠ The ONE declared deviation from verbatim, applied to the SOURCE side so the comparison below
 * still means something. The sample opens `I, (Driver Name), hereby provide consent`; we render
 * `I hereby provide consent`, because the signer's name is captured by the ceremony and stored in
 * `driver_authorizations.signed_name` rather than typed into the body of the instrument.
 *
 * Declared here, once, rather than loosened into the matcher — a fuzzy comparison would hide the
 * next deviation instead of this one.
 */
const DRIVER_NAME_BLANK = "I, (Driver Name), hereby provide consent";
const form = flatten(readFileSync(FORM, "utf8"))
  .replace(DRIVER_NAME_BLANK, "I hereby provide consent");
/** The same text with the blank still in it, for the test that asserts we dropped it. */
const formVerbatim = flatten(readFileSync(FORM, "utf8"));
/** The sample writes `(Company Name)`; we write the carrier's name. Compare around both. */
const fragments = (p: string): string[] => p.split("{{COMPANY}}").map(flatten).filter(Boolean);

describe("FMCSA's own paragraphs", () => {
  it("can read the committed sample at all", () => {
    expect(formVerbatim.length).toBeGreaterThan(800);
    expect(form).toContain("Sample Format: General Consent for Limited Queries");
  });

  it("reproduces all three, word for word", () => {
    const missing = CLEARINGHOUSE_FMCSA_PARAGRAPHS.filter(
      (p) => !fragments(p).every((f) => form.includes(f)),
    );
    expect(missing).toEqual([]);
  });

  it("carries three and only three — a count, because a deletion passes the check above", () => {
    expect(CLEARINGHOUSE_FMCSA_PARAGRAPHS).toHaveLength(3);
  });

  /**
   * ⚠ The bracket is guidance to the employer — "is the driver consenting to a single limited
   * query or multiple limited queries?" — and rendering it to a driver would be showing them our
   * homework instead of their consent.
   */
  it("does not transcribe the sample's instructions to the employer", () => {
    const { body } = clearinghouseConsent("Silvicom Inc");
    expect(form).toContain("Employers and employees may also wish to include the terms");
    expect(body).not.toContain("Employers and employees may also wish");
    expect(body).not.toContain("[");
    // Nor the agency's note about the format being optional, which is addressed to us.
    expect(body).not.toContain("FMCSA does not require");
  });

  it("drops `(Driver Name)` rather than filling it — the signer's name lives on the row", () => {
    const { body } = clearinghouseConsent("Silvicom Inc");
    expect(formVerbatim).toContain("I, (Driver Name), hereby provide consent");
    expect(body).toContain("I hereby provide consent to Silvicom Inc");
    expect(body).not.toContain("(Driver Name)");
  });
});

/**
 * ⚠ Ours, and labelled as ours. §382.701(b) requires a limited query at least annually for as long
 * as the driver is employed, so a consent good for one query — or for a fixed window — expires into
 * a compliance failure. The scope is forced by the obligation, not chosen for convenience.
 */
describe("the scope paragraph we supply", () => {
  it("is not in FMCSA's sample, and must never be attributed to them", () => {
    for (const f of fragments(CLEARINGHOUSE_SCOPE_PARAGRAPH)) expect(form).not.toContain(f);
  });

  it("answers every question the sample's bracket asks", () => {
    const { body } = clearinghouseConsent("Silvicom Inc");
    // How many queries, over what period, and how many in total.
    expect(body).toContain("more than one limited query");
    expect(body).toContain("for as long as I am employed by or under contract to Silvicom Inc");
    expect(body).toContain("no limit on the number of limited queries");
  });

  it("tells the driver how to withdraw, and what withdrawing costs them", () => {
    // The third FMCSA paragraph says a refusal stops them driving; a consent that can be withdrawn
    // has to say the same thing about withdrawal, or it reads as a trap.
    const { body } = clearinghouseConsent("Silvicom Inc");
    expect(body).toContain("withdraw this consent at any time");
    expect(body).toContain("stop me performing safety-sensitive functions");
  });

  it("sits where the bracket sat — after the first paragraph, before the rest", () => {
    const { body } = clearinghouseConsent("Silvicom Inc");
    const paras = body.split("\n\n");
    expect(paras).toHaveLength(4);
    expect(paras[0]).toContain("I hereby provide consent");
    expect(paras[1]).toContain("more than one limited query");
    expect(paras[2]).toContain("will not disclose that information");
  });
});

describe("filling the carrier's name in", () => {
  it("fills every place the sample writes (Company Name)", () => {
    const { body, intent } = clearinghouseConsent("Silvicom Inc");
    expect(body).not.toContain("(Company Name)");
    expect(body).not.toContain("{{COMPANY}}");
    expect(intent).not.toContain("{{COMPANY}}");
    // The sample names the company five times; ours names it in the intent too.
    expect(body.split("Silvicom Inc").length - 1).toBeGreaterThanOrEqual(5);
  });

  it("falls back to a phrase that still reads, rather than a hole", () => {
    expect(clearinghouseConsent("  ").body).toContain("consent to the carrier to conduct");
  });

  it("changes nothing but the name", () => {
    const a = clearinghouseConsent("Carrier A").body.split("Carrier A").join("X");
    const b = clearinghouseConsent("Another Carrier, LLC").body.split("Another Carrier, LLC").join("X");
    expect(a).toBe(b);
  });
});
