import { z } from "zod";
import { REQUIRED_TRAINING_TYPES } from "./qualificationGate.js";
import { certificationCreateSchema, type CertificationCreateRequest } from "./complianceContract.js";

/**
 * Qualification-file SEEDING (H-CS — the F-H1 operational unlock).
 *
 * The gate fail-closes every hazmat load until `certifications` exist, and no UI ever populated the
 * table — so on day one a fleet's every driver is `not_started` and nothing can clear. Entering a
 * roster through the per-driver CertManager means ~7 records × N drivers of identical clicking.
 *
 * This module is the bulk path: one grid row per driver (CDL expiry, medical expiry, endorsement
 * letters, one training date + provider) expands into the SAME `CertificationCreateRequest` records
 * the single-entry path uses — same Zod gate, same `insert_certification` supersede RPC, same audit
 * trail. Seeding is data entry, not a bypass: nothing here softens the gate, it just lets a safety
 * manager state the facts fast. The expansion is pure and unit-tested; the API route owns I/O.
 *
 * The one deliberate modeling shortcut: a single training date + provider expands to ALL FOUR
 * §172.704(a) required types (general awareness, function-specific, safety, security awareness).
 * That mirrors reality — drivers take one hazmat course covering the four areas, certified by one
 * provider on one date. A fleet whose training genuinely differs per type records those in
 * CertManager; the seed is the common case, not the only path.
 */

export const SEED_ENDORSEMENT_LETTERS = ["H", "N", "X"] as const;

export const qualificationSeedDriverSchema = z
  .object({
    driverId: z.uuid(),
    /** ISO dates (YYYY-MM-DD). A blank field seeds nothing for that kind — never a guessed expiry. */
    cdlExpiresAt: z.string().nullish(),
    medicalExpiresAt: z.string().nullish(),
    /** Endorsement letters held. X (tank+hazmat combined) may stand alone. */
    endorsements: z.array(z.enum(SEED_ENDORSEMENT_LETTERS)).default([]),
    /** One completion date + provider → all four §172.704(a) types (see header). */
    trainingCompletedAt: z.string().nullish(),
    trainingProviderName: z.string().max(200).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.trainingCompletedAt && !v.trainingProviderName?.trim()) {
      ctx.addIssue({ code: "custom", path: ["trainingProviderName"], message: "§172.704(d) requires the training provider's name" });
    }
  });
export type QualificationSeedDriver = z.infer<typeof qualificationSeedDriverSchema>;

export const qualificationSeedSchema = z.object({
  drivers: z.array(qualificationSeedDriverSchema).max(500).default([]),
  /** Carrier-level file — the org half of F-H1 (PHMSA registration + financial responsibility). */
  org: z
    .object({
      phmsaRegistrationExpiresAt: z.string().nullish(),
      financialResponsibilityExpiresAt: z.string().nullish(),
    })
    .nullish(),
  /** Skip kinds a subject already holds a CURRENT certification for (default). Re-running the seed
   *  then never supersedes a richer CertManager entry with a terser seeded one. */
  skipExisting: z.boolean().default(true),
});
export type QualificationSeedRequest = z.infer<typeof qualificationSeedSchema>;

/** What an expanded record is FOR — lets the skip-existing filter match like against like. */
export interface SeedExpansion {
  request: CertificationCreateRequest;
  /** Matching key against existing current certifications. */
  key: { subjectType: "driver" | "organization"; subjectId: string; kind: string; qualifier: string | null; trainingType: string | null };
}

/**
 * Expand a seed into individually-valid CertificationCreateRequests. Pure — ids come from the
 * caller (`makeId`), dates pass through untouched. Every produced request is re-validated through
 * `certificationCreateSchema` so the bulk path can never smuggle in a shape the single path rejects.
 */
export function expandQualificationSeed(
  seed: QualificationSeedRequest,
  orgId: string,
  makeId: () => string,
): SeedExpansion[] {
  const out: SeedExpansion[] = [];
  const push = (raw: Record<string, unknown>, key: SeedExpansion["key"]) => {
    out.push({ request: certificationCreateSchema.parse(raw), key });
  };

  for (const d of seed.drivers) {
    if (d.cdlExpiresAt) {
      push(
        { id: makeId(), subjectType: "driver", subjectId: d.driverId, kind: "cdl", expiresAt: d.cdlExpiresAt },
        { subjectType: "driver", subjectId: d.driverId, kind: "cdl", qualifier: null, trainingType: null },
      );
    }
    if (d.medicalExpiresAt) {
      push(
        { id: makeId(), subjectType: "driver", subjectId: d.driverId, kind: "medical_card", expiresAt: d.medicalExpiresAt },
        { subjectType: "driver", subjectId: d.driverId, kind: "medical_card", qualifier: null, trainingType: null },
      );
    }
    for (const letter of d.endorsements) {
      // No expiry on purpose: the gate's §10.4 null rule inherits the CDL's expiry.
      push(
        { id: makeId(), subjectType: "driver", subjectId: d.driverId, kind: "endorsement", qualifier: letter },
        { subjectType: "driver", subjectId: d.driverId, kind: "endorsement", qualifier: letter, trainingType: null },
      );
    }
    if (d.trainingCompletedAt && d.trainingProviderName?.trim()) {
      for (const t of REQUIRED_TRAINING_TYPES) {
        push(
          {
            id: makeId(), subjectType: "driver", subjectId: d.driverId, kind: "hazmat_training",
            trainingType: t, issuedAt: d.trainingCompletedAt,
            trainingProviderName: d.trainingProviderName.trim(), trainingCertified: true,
          },
          { subjectType: "driver", subjectId: d.driverId, kind: "hazmat_training", qualifier: null, trainingType: t },
        );
      }
    }
  }

  if (seed.org?.phmsaRegistrationExpiresAt) {
    push(
      { id: makeId(), subjectType: "organization", subjectId: orgId, kind: "phmsa_registration", expiresAt: seed.org.phmsaRegistrationExpiresAt },
      { subjectType: "organization", subjectId: orgId, kind: "phmsa_registration", qualifier: null, trainingType: null },
    );
  }
  if (seed.org?.financialResponsibilityExpiresAt) {
    push(
      { id: makeId(), subjectType: "organization", subjectId: orgId, kind: "financial_responsibility", expiresAt: seed.org.financialResponsibilityExpiresAt },
      { subjectType: "organization", subjectId: orgId, kind: "financial_responsibility", qualifier: null, trainingType: null },
    );
  }
  return out;
}

export interface ExistingCertKey {
  subject_type: string;
  subject_id: string;
  kind: string;
  qualifier: string | null;
  training_type: string | null;
}

/** The skip-existing filter: drop expansions whose subject already holds a matching CURRENT cert. */
export function filterAgainstExisting(expansions: SeedExpansion[], existing: ExistingCertKey[]): { toInsert: SeedExpansion[]; skipped: SeedExpansion[] } {
  const keyOf = (s: { subjectType?: string; subject_type?: string; subjectId?: string; subject_id?: string; kind: string; qualifier: string | null; trainingType?: string | null; training_type?: string | null }): string =>
    [s.subjectType ?? s.subject_type, s.subjectId ?? s.subject_id, s.kind, s.qualifier ?? "", s.trainingType ?? s.training_type ?? ""].join("|");
  const have = new Set(existing.map(keyOf));
  const toInsert: SeedExpansion[] = [];
  const skipped: SeedExpansion[] = [];
  for (const e of expansions) (have.has(keyOf(e.key)) ? skipped : toInsert).push(e);
  return { toInsert, skipped };
}
