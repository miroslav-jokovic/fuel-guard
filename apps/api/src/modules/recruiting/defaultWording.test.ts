import { describe, it, expect } from "vitest";
import {
  APPLICATION_RELEASE_ORDER,
  AUTHORIZATION_PURPOSES,
  DISCLOSURES,
  ESIGN_CONSENT,
  ESIGN_CONSENT_CLAUSES,
  applicationWordingIsDraft,
  esignConsentRequired,
  isDraftDisclosure,
  unpublishedInstruments,
} from "@silvicom/shared";
import {
  CLEARINGHOUSE_VERSION,
  ESIGN_VERSION,
  PACKET_VERSION,
  PSP_VERSION,
  defaultWording,
} from "./defaultWording.js";
import { missingPspParagraphs } from "./pspDisclosure.js";

/**
 * The wording this product ships (D-WORD1, 2026-09-14).
 *
 * ── WHAT THIS FILE IS REALLY GUARDING ─────────────────────────────────────────────────────────
 * Every refusal in the applicant's path is `isDraftDisclosure(version)`. Until today they were all
 * closed and the settings page was the way through; now they are all open on deploy, and the thing
 * standing behind them is this catalogue. So two properties matter more than anything else here:
 * that **no instrument is draft** (or an applicant is blocked for a reason nobody can see), and
 * that **no instrument is an engineer's text** (or a driver signs words nobody with a licence to
 * write them ever read).
 *
 * The second is the one a test can only approximate, and the approximation used is provenance: each
 * document must equal what its researched source module produces, and the version must name where
 * it came from.
 */

const wording = defaultWording("Silvicom Inc");

describe("every gate opens, and says why", () => {
  it("ships nothing that `isDraftDisclosure` refuses", () => {
    const draft = AUTHORIZATION_PURPOSES.filter((p) => isDraftDisclosure(wording.disclosures[p].version));
    expect(draft).toEqual([]);
    expect(isDraftDisclosure(wording.esignConsent.version)).toBe(false);
  });

  it("leaves nothing outstanding for a carrier that has published nothing", () => {
    // The number the settings page used to lead with. It is zero before anybody does anything.
    expect(unpublishedInstruments(wording)).toEqual([]);
  });

  it("opens the submission gate", () => {
    expect(applicationWordingIsDraft(wording)).toBe(false);
  });

  /**
   * ⚠ This one is a behaviour CHANGE, not just an unblocking, and it is the right way round.
   * §390.32(d) requires proof of 7001(c) consent behind an electronic §391.21 application. The
   * requirement was dormant only because the consent could not be recorded against draft text; it
   * now arms on deploy, and #762 is what makes every write path actually honour it.
   */
  it("arms the §390.32(d) consent requirement", () => {
    expect(esignConsentRequired(null, wording.esignConsent)).toBe(true);
    expect(esignConsentRequired("2026-09-14T00:00:00Z", wording.esignConsent)).toBe(false);
  });

  it("versions by provenance, so a signature says what it was signed under", () => {
    // `v1` needs this repository at the right commit to mean anything; these do not.
    expect(wording.disclosures.psp.version).toBe(PSP_VERSION);
    expect(wording.disclosures.clearinghouse.version).toBe(CLEARINGHOUSE_VERSION);
    expect(wording.disclosures.fcra_disclosure.version).toBe(PACKET_VERSION);
    expect(wording.esignConsent.version).toBe(ESIGN_VERSION);
    for (const v of [PSP_VERSION, CLEARINGHOUSE_VERSION, PACKET_VERSION, ESIGN_VERSION]) {
      expect(v).toMatch(/^(fmcsa|packet|15usc)/);
    }
  });
});

describe("where every word came from", () => {
  it("takes the four the applicant signs from a source outside this repository's opinions", () => {
    // FMCSA's mandated form, in whole.
    expect(missingPspParagraphs(wording.disclosures.psp.body)).toEqual([]);
    // The carrier's own counsel, off the packet pages.
    expect(wording.disclosures.fcra_disclosure.title).toBe("FAIR CREDIT REPORTING ACT DISCLOSURE");
    expect(wording.disclosures.previous_employer.title).toBe("PAST EMPLOYMENT VERIFICATION");
    expect(wording.disclosures.drug_alcohol.title).toBe("URINALYSIS NOTIFICATION");
  });

  it("⚠ ships not one word of the engineer's placeholders for anything a driver signs", () => {
    // The whole point of D-WORD1. Every placeholder body is still in `DISCLOSURES`; none of them
    // may reach a signature. Compared on the opening clause, which is unique to each.
    for (const purpose of APPLICATION_RELEASE_ORDER) {
      expect(wording.disclosures[purpose].body).not.toBe(DISCLOSURES[purpose].body);
    }
    expect(wording.disclosures.clearinghouse.body).not.toBe(DISCLOSURES.clearinghouse.body);
  });

  it("corrects the Clearinghouse entry to the query it is actually about", () => {
    // ⚠ The placeholder described the FULL query, whose consent is given inside the FMCSA portal.
    // The instrument a carrier holds is the LIMITED query consent — §382.701(b), at least annually.
    const body = wording.disclosures.clearinghouse.body;
    expect(body).toContain("limited query");
    expect(body).toContain("Silvicom Inc");
    expect(DISCLOSURES.clearinghouse.body).toContain("full query");
  });

  it("keeps the consent's six statutory clauses exactly as the statute has them", () => {
    // Only the version changed. A reworded 7001(c) clause would be a drafting act on a statute.
    for (const clause of ESIGN_CONSENT_CLAUSES) {
      expect(wording.esignConsent.clauses[clause]).toBe(ESIGN_CONSENT.clauses[clause]);
      expect(wording.esignConsent.clauses[clause].length).toBeGreaterThan(20);
    }
    // Only the version moved.
    expect(wording.esignConsent.version).not.toBe(ESIGN_CONSENT.version);
    expect(wording.esignConsent.title).toBe(ESIGN_CONSENT.title);
  });

  it("keeps each instrument's citation, which is provenance rather than screen copy", () => {
    for (const purpose of AUTHORIZATION_PURPOSES) {
      expect(wording.disclosures[purpose].citation).toBe(DISCLOSURES[purpose].citation);
      expect(wording.disclosures[purpose].purpose).toBe(purpose);
    }
  });
});

describe("the carrier's name", () => {
  it("reaches the two instruments that authorise a named company", () => {
    const w = defaultWording("Another Carrier, LLC");
    expect(w.disclosures.psp.body).toContain("application for employment with Another Carrier, LLC");
    expect(w.disclosures.clearinghouse.body).toContain("consent to Another Carrier, LLC");
  });

  it("still produces a usable document when the org has no name on file", () => {
    // A blank must never render a sentence that proof-reads as fine and authorises nobody.
    const w = defaultWording("");
    expect(isDraftDisclosure(w.disclosures.psp.version)).toBe(false);
    expect(w.disclosures.psp.body).toContain("application for employment with ____");
    expect(w.disclosures.clearinghouse.body).toContain("consent to the carrier");
  });
});
