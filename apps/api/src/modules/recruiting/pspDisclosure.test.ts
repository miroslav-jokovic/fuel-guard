import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  PSP_DISCLOSURE_TITLE,
  PSP_MANDATED_INTENT,
  PSP_MANDATED_PARAGRAPHS,
  missingPspParagraphs,
  pspDisclosure,
} from "./pspDisclosure.js";

/**
 * The PSP disclosure, checked against the federal form it was transcribed from.
 *
 * ── WHY THE BAR IS HIGHER HERE THAN FOR THE CARRIER'S OWN PAGES ───────────────────────────────
 * `packetWording.test.ts` proves we typed the carrier's packet correctly. This proves we typed
 * FMCSA's form correctly, and the consequence of not having is different in kind: the account-holder
 * agreement requires the language "in whole, exactly as provided", so a dropped clause is not a
 * quality problem but a breach of the terms the PSP API token is issued under.
 *
 * The source of truth is `docs/plans/recruitment/psp-disclosure/` — the downloaded PDF and its
 * `pdftotext -layout` extraction, both committed so this comparison works offline and so a reader
 * can hold the federal form beside what we publish.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FORM = join(HERE, "../../../../../docs/plans/recruitment/psp-disclosure/PSPDisclosureandAuthorizationForm.txt");

/** The PDF wraps at a fixed column; the agency's words are what survive collapsing that. */
const flatten = (s: string): string => s.replace(/\s+/g, " ").trim();
const form = flatten(readFileSync(FORM, "utf8"));

/** The employer blank, as a regex fragment — any carrier name, or the underscores, satisfies it. */
const withoutEmployer = (p: string): string[] => p.split("{{EMPLOYER}}").map(flatten);

describe("the transcription", () => {
  it("can read the committed form at all", () => {
    // Guards the guard: an unreadable file makes every comparison below vacuously true.
    expect(form.length).toBeGreaterThan(5_000);
    expect(form).toContain("FOR MANDATORY USE BY ALL");
  });

  /**
   * ⚠ The assertion this file exists for. Every mandated paragraph, found in the federal form.
   * Paragraphs carrying the employer blank are checked as the two fragments either side of it.
   */
  it("reproduces every paragraph of the federal form", () => {
    const missing = PSP_MANDATED_PARAGRAPHS.filter(
      (p) => !withoutEmployer(p).every((part) => form.includes(part)),
    );
    expect(missing).toEqual([]);
  });

  it("reproduces the title and the affirmation the driver signs", () => {
    expect(form).toContain(flatten(PSP_DISCLOSURE_TITLE));
    expect(form).toContain(flatten(PSP_MANDATED_INTENT));
  });

  it("carries 13 paragraphs — a count, because a deletion passes every check above", () => {
    // Everything that REMAINS after a dropped clause is still found in the source, so only a count
    // can see the drop. Six disclosure paragraphs, the AUTHORIZATION heading, its lead-in, three
    // authorization paragraphs, and the two closing NOTICEs.
    expect(PSP_MANDATED_PARAGRAPHS).toHaveLength(13);
  });

  it("keeps the NOTICE that makes the language mandatory in the first place", () => {
    const body = pspDisclosure("Silvicom Inc").body;
    expect(body).toContain("The language must be used in whole, exactly as provided");
    expect(body).toContain("must exist as one stand-alone document");
  });

  /**
   * ⚠ No repair register, deliberately — see the module header. The packet's typos are fixed under
   * D-PKT9; this text gets nothing done to it, because "exactly as provided" came from the agency
   * whose system the report is pulled from.
   */
  it("reproduces the agency's own punctuation, including its curly quotes", () => {
    const body = pspDisclosure("Silvicom Inc").body;
    expect(body).toContain("(“Prospective Employer”)");
    expect(body).toContain("Applicant’s written or electronic consent");
  });
});

describe("filling the carrier's name in", () => {
  it("fills both blanks the form leaves", () => {
    const { body } = pspDisclosure("Silvicom Inc");
    expect(body).toContain("application for employment with Silvicom Inc (“Prospective Employer”)");
    expect(body).toContain("I authorize Silvicom Inc (“Prospective Employer”) to access");
  });

  it("leaves a visible gap rather than a sentence that reads correctly and means nothing", () => {
    // An empty name would render "application for employment with  (“Prospective Employer”)", which
    // proof-reads as fine and authorises nobody.
    const { body } = pspDisclosure("   ");
    expect(body).toContain("application for employment with ____");
  });

  it("does not touch the rest of the language", () => {
    const a = pspDisclosure("Carrier A").body.split("Carrier A").join("X");
    const b = pspDisclosure("A Much Longer Carrier Name, LLC").body.split("A Much Longer Carrier Name, LLC").join("X");
    expect(a).toBe(b);
  });
});

/**
 * The refusal.
 *
 * ⚠ This is the only place in the wording feature where a carrier is told what it may publish, and
 * the exception is argued in the module header: everywhere else the instruments are the carrier's,
 * and this one is the regulator's. An office that shortened it would lose their PSP access without
 * anybody telling them.
 */
describe("refusing an edited PSP consent", () => {
  const good = pspDisclosure("Silvicom Inc").body;

  it("accepts the mandated language with any carrier name in it", () => {
    expect(missingPspParagraphs(good)).toEqual([]);
    expect(missingPspParagraphs(pspDisclosure("Someone Else Trucking").body)).toEqual([]);
  });

  it("accepts it after a round trip through a textarea", () => {
    // Publishing goes through a <textarea>; line endings and trailing spaces are not edits.
    expect(missingPspParagraphs(good.replace(/\n/g, "\r\n") + "   ")).toEqual([]);
  });

  it("names the paragraph somebody deleted", () => {
    const short = good.split("\n\n").filter((p) => !p.startsWith("Any crash or inspection")).join("\n\n");
    const missing = missingPspParagraphs(short);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("Any crash or inspection");
  });

  it("catches a clause quietly dropped from the middle of a paragraph", () => {
    // The failure mode that matters: not a deleted section, which somebody would notice, but a
    // sentence removed from a wall of text.
    const edited = good.replace(
      " I understand and acknowledge that this release of information may assist the Prospective Employer to make a determination regarding my suitability as an employee.",
      "",
    );
    expect(missingPspParagraphs(edited)).toHaveLength(1);
  });

  it("refuses our own placeholder wording outright", () => {
    expect(missingPspParagraphs("We are requesting your crash and roadside inspection history.").length)
      .toBe(PSP_MANDATED_PARAGRAPHS.length);
  });
});
