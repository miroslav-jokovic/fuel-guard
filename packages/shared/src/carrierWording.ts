import { z } from "zod";
import {
  AUTHORIZATION_PURPOSES,
  DISCLOSURES,
  ESIGN_CONSENT,
  ESIGN_CONSENT_CLAUSES,
  isDraftDisclosure,
  type AuthorizationPurpose,
  type DisclosureDocument,
  type EsignConsentClause,
  type EsignConsentDocument,
} from "./authorizationContract.js";

/**
 * The carrier's own wording, overlaid on the code's placeholders.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────
 * Every instrument is a module constant in `authorizationContract.ts` and all six are `v0-draft`.
 * `isDraftDisclosure()` reads that string, and behind it refuse every submission, every signature,
 * the 7001(c) gate, every PSP order, every §40.25 letter and every Clearinghouse query. A driver who
 * fills in nine screens meets a disabled button.
 *
 * ⚠ **The wording is not ours to write.** Publishing it took an engineer and a deploy, which is the
 * missing capability rather than a configuration detail — the carrier has drafted text and counsel
 * has to rule on it, and neither of them can reach a TypeScript constant.
 *
 * ── THE SHAPE OF THE FIX, AND WHY NOTHING DOWNSTREAM CHANGES ──────────────────────────────────
 * This module answers one question: *given the rows a carrier has published, what are the six
 * documents?* Unpublished instruments keep the code's `v0-draft` constants. So every guarantee
 * downstream keeps working **unchanged** — `isDraftDisclosure(doc.version)` still decides whether a
 * signature may be taken, `recordRelease` still composes the stored text server-side, and the gates
 * still open by themselves. All that moves is where the document came from.
 *
 * It is pure on purpose: the rows come from the api, and the overlay can be tested without one.
 */

/**
 * What a carrier may publish.
 *
 * ⚠ **This is a PUBLISHING vocabulary and must never be fed to `hasLiveAuthorization` or
 * `SCREENING_PREREQUISITES`.** `esign_consent` is in it and is deliberately NOT an
 * `AuthorizationPurpose`: the 7001(c) consent unlocks nothing and authorises nobody to pull
 * anything, and `authorizationContract.ts` says in as many words that adding it to that list would
 * make a PSP pull look satisfiable by the wrong consent. The two vocabularies overlap by five
 * members and answer different questions.
 */
export const ESIGN_CONSENT_INSTRUMENT = "esign_consent" as const;

export const PUBLISHABLE_INSTRUMENTS = [
  ...AUTHORIZATION_PURPOSES,
  ESIGN_CONSENT_INSTRUMENT,
] as const;

export type PublishableInstrument = (typeof PUBLISHABLE_INSTRUMENTS)[number];

export const PUBLISHABLE_INSTRUMENT_LABELS: Record<PublishableInstrument, string> = {
  fcra_disclosure: "Consumer report disclosure and authorization",
  psp: "FMCSA Pre-Employment Screening Program (PSP)",
  previous_employer: "Previous-employer safety performance release",
  clearinghouse: "Drug & Alcohol Clearinghouse query consent",
  drug_alcohol: "Controlled substances and alcohol testing consent",
  esign_consent: "Agreeing to sign and receive these documents electronically",
};

/** One published row, as the database holds it. */
export interface PublishedWording {
  instrument: PublishableInstrument;
  version: string;
  title: string;
  /** The five authorizations. Null for the consent. */
  body: string | null;
  /** The consent's six statutory clauses. Null for the five authorizations. */
  clauses: Record<string, string> | null;
  intent: string;
  publishedAt: string;
}

/**
 * What an office sends when it publishes.
 *
 * ⚠ No `version` field, and that is the point. `driver_authorizations` stores the text AND the
 * version, and the whole value of the version is that it identifies the text — so if a carrier could
 * type `v1` twice with different wording, two signatures would name one version and mean different
 * things. The service assigns the next integer.
 */
export const publishWordingSchema = z
  .object({
    instrument: z.enum(PUBLISHABLE_INSTRUMENTS),
    title: z.string().trim().min(1).max(200),
    intent: z.string().trim().min(1).max(2000),
    body: z.string().trim().max(20_000).nullish(),
    clauses: z.record(z.string(), z.string().trim().max(5_000)).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.instrument === ESIGN_CONSENT_INSTRUMENT) {
      if (v.body != null && v.body !== "") {
        ctx.addIssue({ code: "custom", path: ["body"], message: "The electronic-records consent is published as clauses, not as one block of text." });
      }
      /**
       * ⚠ All six, each non-empty. 15 U.S.C. 7001(c)(1)(B)(i)(I) through (c)(1)(C)(i) are six
       * separate statutory disclosures, and a consent missing one is not a consent. This is the one
       * place that can catch it — the applicant's screen renders whatever it is given.
       */
      const missing = ESIGN_CONSENT_CLAUSES.filter((c) => !(v.clauses ?? {})[c]?.trim());
      if (missing.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["clauses"],
          message: `The law requires all six parts of this consent. Still empty: ${missing.join(", ")}.`,
        });
      }
      return;
    }
    if (v.clauses != null) {
      ctx.addIssue({ code: "custom", path: ["clauses"], message: "Only the electronic-records consent is published as clauses." });
    }
    if (!v.body?.trim()) {
      ctx.addIssue({ code: "custom", path: ["body"], message: "The wording is needed." });
    }
  });

export type PublishWording = z.infer<typeof publishWordingSchema>;

/**
 * The next version for an instrument, given how many times it has been published.
 *
 * Numbering from 1 rather than 0, so the result can never satisfy `isDraftDisclosure()`'s
 * `startsWith("v0")` — the gate opens by construction rather than by a rule somebody could relax.
 */
export const nextWordingVersion = (publishedCount: number): string => `v${publishedCount + 1}`;

export interface CarrierWording {
  disclosures: Record<AuthorizationPurpose, DisclosureDocument>;
  esignConsent: EsignConsentDocument;
}

/**
 * The six documents this carrier's applicants are shown, given what it has published.
 *
 * Anything unpublished keeps the code's placeholder — which is `v0-draft`, which is what keeps every
 * downstream refusal in place for a carrier that has not finished. There is no third state and no
 * flag: published or not, read off the version, exactly as before.
 */
export function carrierWording(published: readonly PublishedWording[]): CarrierWording {
  /** Newest wins. Rows arrive newest-first from the api, but sorting here makes that not matter. */
  const live = new Map<PublishableInstrument, PublishedWording>();
  for (const row of [...published].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))) {
    live.set(row.instrument, row);
  }

  const disclosures = { ...DISCLOSURES } as Record<AuthorizationPurpose, DisclosureDocument>;
  for (const purpose of AUTHORIZATION_PURPOSES) {
    const row = live.get(purpose);
    if (!row || !row.body) continue;
    disclosures[purpose] = {
      ...DISCLOSURES[purpose],
      version: row.version,
      title: row.title,
      body: row.body,
      intent: row.intent,
    };
  }

  const consentRow = live.get(ESIGN_CONSENT_INSTRUMENT);
  const esignConsent: EsignConsentDocument = consentRow?.clauses
    ? {
      ...ESIGN_CONSENT,
      version: consentRow.version,
      title: consentRow.title,
      intent: consentRow.intent,
      clauses: Object.fromEntries(
        // ⚠ Read through the statutory list rather than through the stored object's own keys: a row
        // carrying an extra key must not add a clause, and one missing a key falls back to the
        // placeholder rather than rendering an empty paragraph. Publishing already refuses a row
        // with a gap; this is the floor under a row written before that rule existed.
        ESIGN_CONSENT_CLAUSES.map((c) => [c, consentRow.clauses?.[c]?.trim() || ESIGN_CONSENT.clauses[c]]),
      ) as Record<EsignConsentClause, string>,
    }
    : ESIGN_CONSENT;

  return { disclosures, esignConsent };
}

/** The instruments this carrier still has to publish before an applicant can get anywhere. */
export const unpublishedInstruments = (wording: CarrierWording): PublishableInstrument[] => [
  ...AUTHORIZATION_PURPOSES.filter((p) => isDraftDisclosure(wording.disclosures[p].version)),
  ...(isDraftDisclosure(wording.esignConsent.version) ? [ESIGN_CONSENT_INSTRUMENT] : []),
];
