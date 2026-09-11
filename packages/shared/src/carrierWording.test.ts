import { describe, expect, it } from "vitest";
import {
  APPLICATION_RELEASE_ORDER,
  applicationWordingIsDraft,
} from "./applicationIntake.js";
import {
  AUTHORIZATION_PURPOSES,
  ESIGN_CONSENT,
  ESIGN_CONSENT_CLAUSES,
  esignConsentBody,
  isDraftDisclosure,
} from "./authorizationContract.js";
import {
  ESIGN_CONSENT_INSTRUMENT,
  PUBLISHABLE_INSTRUMENTS,
  carrierWording,
  nextWordingVersion,
  publishWordingSchema,
  unpublishedInstruments,
  type PublishedWording,
} from "./carrierWording.js";

/**
 * The carrier's own wording (2026-09-11).
 *
 * ⚠ The assertions that matter are the ones about what happens when a carrier has published only
 * SOME of it. Every refusal in the applicant's path reads `isDraftDisclosure(doc.version)`, so an
 * overlay that accidentally handed back a published-looking version for an instrument nobody wrote
 * would open the signing gate on placeholder text — which is the single worst outcome this whole
 * design exists to prevent.
 */

const row = (over: Partial<PublishedWording> = {}): PublishedWording => ({
  instrument: "fcra_disclosure",
  version: "v1",
  title: "Disclosure regarding consumer reports",
  body: "We may obtain consumer reports about you for employment purposes.",
  clauses: null,
  intent: "I authorize the preparation of consumer reports about me.",
  publishedAt: "2026-09-11T10:00:00Z",
  ...over,
});

const consentRow = (over: Partial<PublishedWording> = {}): PublishedWording =>
  row({
    instrument: ESIGN_CONSENT_INSTRUMENT,
    body: null,
    clauses: Object.fromEntries(ESIGN_CONSENT_CLAUSES.map((c) => [c, `Our own ${c} wording.`])),
    title: "Signing electronically",
    intent: "I agree to sign electronically.",
    ...over,
  });

describe("the vocabulary a carrier publishes against", () => {
  it("is the five authorizations plus the electronic-records consent", () => {
    expect([...PUBLISHABLE_INSTRUMENTS].sort()).toEqual(
      [...AUTHORIZATION_PURPOSES, ESIGN_CONSENT_INSTRUMENT].sort(),
    );
  });

  it("⚠ keeps the consent OUT of the screening vocabulary", () => {
    // Adding it to AUTHORIZATION_PURPOSES would make a PSP pull look satisfiable by a consent that
    // authorises nobody to pull anything. The two lists overlap by five and answer different
    // questions.
    expect(AUTHORIZATION_PURPOSES as readonly string[]).not.toContain(ESIGN_CONSENT_INSTRUMENT);
  });
});

describe("the version, which is assigned and never typed", () => {
  it("numbers from one, so it can never look like a draft", () => {
    expect(nextWordingVersion(0)).toBe("v1");
    expect(nextWordingVersion(3)).toBe("v4");
    for (const n of [0, 1, 2, 9, 40]) {
      expect(isDraftDisclosure(nextWordingVersion(n))).toBe(false);
    }
  });

  it("is not something the publish payload can carry", () => {
    // `driver_authorizations` stores the text AND the version; two versions must never be able to
    // mean two different things.
    const parsed = publishWordingSchema.safeParse({
      instrument: "psp", title: "t", intent: "i", body: "b", version: "v1",
    } as never);
    expect(parsed.success && "version" in parsed.data).toBe(false);
  });
});

describe("overlaying what the carrier published", () => {
  it("uses the carrier's text for what it published", () => {
    const w = carrierWording([row()]);
    expect(w.disclosures.fcra_disclosure.version).toBe("v1");
    expect(w.disclosures.fcra_disclosure.body).toContain("We may obtain consumer reports");
    expect(isDraftDisclosure(w.disclosures.fcra_disclosure.version)).toBe(false);
  });

  it("⚠ leaves everything else a draft, so every other refusal stays exactly where it was", () => {
    const w = carrierWording([row()]);
    for (const purpose of AUTHORIZATION_PURPOSES.filter((p) => p !== "fcra_disclosure")) {
      expect(isDraftDisclosure(w.disclosures[purpose].version)).toBe(true);
    }
    expect(isDraftDisclosure(w.esignConsent.version)).toBe(true);
    // And the whole-path gate is still shut on one published instrument out of six.
    expect(applicationWordingIsDraft()).toBe(true);
  });

  it("takes the newest version when an instrument has been republished", () => {
    const w = carrierWording([
      row({ version: "v1", body: "the old wording", publishedAt: "2026-09-01T10:00:00Z" }),
      row({ version: "v2", body: "the corrected wording", publishedAt: "2026-09-11T10:00:00Z" }),
    ]);
    expect(w.disclosures.fcra_disclosure.version).toBe("v2");
    expect(w.disclosures.fcra_disclosure.body).toBe("the corrected wording");
  });

  it("does not care what order the rows arrive in", () => {
    const newest = row({ version: "v2", body: "newer", publishedAt: "2026-09-11T10:00:00Z" });
    const oldest = row({ version: "v1", body: "older", publishedAt: "2026-09-01T10:00:00Z" });
    expect(carrierWording([newest, oldest]).disclosures.fcra_disclosure.body).toBe("newer");
    expect(carrierWording([oldest, newest]).disclosures.fcra_disclosure.body).toBe("newer");
  });

  it("changes nothing at all for a carrier that has published nothing", () => {
    const w = carrierWording([]);
    expect(w.esignConsent).toEqual(ESIGN_CONSENT);
    for (const purpose of AUTHORIZATION_PURPOSES) {
      expect(isDraftDisclosure(w.disclosures[purpose].version)).toBe(true);
    }
  });

  it("composes the published consent in statutory order, like the placeholder", () => {
    const w = carrierWording([consentRow()]);
    const body = esignConsentBody(w.esignConsent);
    for (const clause of ESIGN_CONSENT_CLAUSES) expect(body).toContain(`Our own ${clause} wording.`);
    // Statutory ORDER, not object order: the first clause in the list appears before the last.
    expect(body.indexOf("paper_option")).toBeLessThan(body.indexOf("system_requirements"));
  });

  it("⚠ falls back per clause rather than rendering a gap", () => {
    // Publishing refuses a row with an empty clause. This is the floor under a row written before
    // that rule existed — an empty paragraph in a statutory consent is worse than the placeholder.
    const partial = consentRow({ clauses: { paper_option: "Ours." } });
    const w = carrierWording([partial]);
    expect(w.esignConsent.clauses.paper_option).toBe("Ours.");
    expect(w.esignConsent.clauses.withdrawal_right).toBe(ESIGN_CONSENT.clauses.withdrawal_right);
  });

  it("ignores a key the statute does not name", () => {
    const w = carrierWording([consentRow({ clauses: { ...Object.fromEntries(ESIGN_CONSENT_CLAUSES.map((c) => [c, "x"])), invented: "y" } })]);
    expect(Object.keys(w.esignConsent.clauses).sort()).toEqual([...ESIGN_CONSENT_CLAUSES].sort());
  });
});

describe("what is still owed", () => {
  it("names every instrument the carrier has not published", () => {
    expect(unpublishedInstruments(carrierWording([]))).toHaveLength(PUBLISHABLE_INSTRUMENTS.length);
    const some = carrierWording([row(), consentRow()]);
    expect(unpublishedInstruments(some).sort()).toEqual(
      AUTHORIZATION_PURPOSES.filter((p) => p !== "fcra_disclosure").sort(),
    );
  });

  it("is empty only when all six are published", () => {
    const all = carrierWording([
      ...AUTHORIZATION_PURPOSES.map((p) => row({ instrument: p })),
      consentRow(),
    ]);
    expect(unpublishedInstruments(all)).toEqual([]);
    // And the four the applicant's path collects are all live.
    for (const p of APPLICATION_RELEASE_ORDER) expect(isDraftDisclosure(all.disclosures[p].version)).toBe(false);
  });
});

describe("what a carrier is allowed to publish", () => {
  it("takes a body for an authorization", () => {
    expect(publishWordingSchema.safeParse({ instrument: "psp", title: "t", intent: "i", body: "b" }).success).toBe(true);
  });

  it("refuses an authorization with no wording in it", () => {
    expect(publishWordingSchema.safeParse({ instrument: "psp", title: "t", intent: "i", body: "   " }).success).toBe(false);
    expect(publishWordingSchema.safeParse({ instrument: "psp", title: "t", intent: "i" }).success).toBe(false);
  });

  it("⚠ refuses a 7001(c) consent missing any of its six statutory parts", () => {
    // The single most important refusal here. A consent missing a clause the statute requires is not
    // a consent, and the applicant's screen renders whatever it is given.
    for (const drop of ESIGN_CONSENT_CLAUSES) {
      const clauses = Object.fromEntries(ESIGN_CONSENT_CLAUSES.filter((c) => c !== drop).map((c) => [c, "text"]));
      const parsed = publishWordingSchema.safeParse({
        instrument: ESIGN_CONSENT_INSTRUMENT, title: "t", intent: "i", clauses,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues[0]?.message).toContain(drop);
    }
  });

  it("refuses a consent published as one block of text", () => {
    expect(publishWordingSchema.safeParse({
      instrument: ESIGN_CONSENT_INSTRUMENT, title: "t", intent: "i", body: "all six, somehow",
    }).success).toBe(false);
  });

  it("refuses an authorization published as clauses", () => {
    expect(publishWordingSchema.safeParse({
      instrument: "psp", title: "t", intent: "i", body: "b", clauses: { paper_option: "x" },
    }).success).toBe(false);
  });
});
