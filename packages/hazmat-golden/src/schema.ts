/**
 * Golden scenario schema (@hazmat/golden) — the SME-authorable acceptance-test format (plan H2).
 *
 * A scenario is `{ name, docRef, verifiedBy, input, expect }`. It is deliberately declarative and
 * human-readable (authored as YAML) so a hazmat-knowledgeable reviewer — NOT only a developer — can
 * write and audit it. The independent-authorship rule (D11 / plan H2) is hard: the `expect` values are
 * authored by the SME working from the CFR text / doc-17, NEVER by the engine implementer and NEVER by
 * running the engine and pasting its output. `verifiedBy` records who authored the expectation and is
 * REQUIRED — the gate refuses a scenario without it.
 *
 * `input` is the engine `LoadInput` MINUS `dataset` and `evaluatedAt` (the runner injects the real
 * shipped dataset + a fixed clock). It is kept loosely typed here so this schema does not have to track
 * every future field of the engine's input contract — the engine's own `loadInputSchema` validates it
 * when the scenario runs, and a bad input surfaces as a clear error against the scenario name.
 */

import { z } from "zod";

const placardName = z.string(); // validated against the engine's PlacardName at run time via the verdict

export const goldenExpectSchema = z
  .object({
    /** Overall eligibility the verdict must report. */
    eligibility: z.enum(["eligible", "blocked", "not_checked"]).optional(),
    /** Placards that MUST appear in `placards.required`. */
    placardsRequired: z.array(placardName).default([]),
    /** Placards that MUST appear in `placards.prohibited`. */
    placardsProhibited: z.array(placardName).default([]),
    /** Placards that must NOT be required (negative assertion). */
    placardsAbsent: z.array(placardName).default([]),
    /** Optional substitutions that must be offered, e.g. { instead: "FLAMMABLE", use: "GASOLINE" }. */
    optionalSubstitutions: z.array(z.object({ instead: placardName, use: placardName })).default([]),
    /** ID numbers that must be displayed (as the verdict prints them, e.g. "UN1203"). */
    idDisplays: z.array(z.string()).default([]),
    /** ERG guide numbers that must be emitted (idNumber as printed, e.g. "1203"). */
    ergGuides: z.array(z.object({ idNumber: z.string(), guide: z.string() })).default([]),
    /** Marks that must appear (HOT / MARINE_POLLUTANT / LIMITED_QUANTITY). */
    marks: z.array(z.enum(["HOT", "MARINE_POLLUTANT", "LIMITED_QUANTITY"])).default([]),
    /** Rule IDs that must appear across eligibility.blocks ∪ segregation. */
    findingRuleIds: z.array(z.string()).default([]),
    /** Rule IDs that must appear specifically in `segregation`. */
    segregationRuleIds: z.array(z.string()).default([]),
    /** Rule IDs that must NOT appear anywhere (blocks ∪ segregation). */
    absentRuleIds: z.array(z.string()).default([]),
    /** Shipping-paper (BOL) expectations — checked only when `runBol: true`. */
    bol: z
      .object({
        /** Required §172.202(a) basic description per line, in order (exact match). */
        basicDescriptions: z.array(z.string()).default([]),
        /** Substrings that must appear somewhere in the BOL validation output. */
        mustContain: z.array(z.string()).default([]),
        /** BOL finding rule IDs that must appear. */
        findingRuleIds: z.array(z.string()).default([]),
      })
      .optional(),
  })
  .strict();
export type GoldenExpect = z.infer<typeof goldenExpectSchema>;

export const goldenScenarioSchema = z
  .object({
    /** Unique, human-readable scenario name. */
    name: z.string().min(1),
    /** The CFR / doc-17 citation the expected outcome is grounded in (authorship provenance). */
    docRef: z.string().min(1),
    /** Free-text description of the real-world case. */
    description: z.string().default(""),
    /** REQUIRED — who authored the expected values (D11 independent-authorship rule). */
    verifiedBy: z.string().min(1),
    /** Date the expectation was authored/verified (YYYY-MM-DD). */
    verifiedOn: z.string().default(""),
    /** v1.18 sourcing: the REAL BOL this scenario was captured from (photo filename / load id).
     *  Empty only on `deliberate` scenarios and the `_`-prefixed harness examples. */
    sourceBolRef: z.string().default(""),
    /** v1.18: true when this scenario was deliberately constructed to close a named coverage-
     *  checklist gap reality never produced (built WITH the SME from a minimally-modified real
     *  BOL). `deliberateGap` names the gap. */
    deliberate: z.boolean().default(false),
    deliberateGap: z.string().default(""),
    /** Also run `validateBol` and check `expect.bol`. */
    runBol: z.boolean().default(false),
    /** Pin this scenario to a specific dataset version (H-LQ: LQ scenarios need ≥ 2026.08.0 for
     *  column 8A). null → the shipped LATEST_DATASET_VERSION, same as before. */
    datasetVersion: z.string().nullable().default(null),
    /** The engine LoadInput minus dataset + evaluatedAt (runner injects both). */
    input: z.record(z.string(), z.unknown()),
    /** The independently-authored expectation. */
    expect: goldenExpectSchema,
  })
  .strict();
export type GoldenScenario = z.infer<typeof goldenScenarioSchema>;

/** Parse + validate an untrusted scenario object (from a YAML file), tagging errors with the source. */
export function parseScenario(raw: unknown, source: string): GoldenScenario {
  const r = goldenScenarioSchema.safeParse(raw);
  if (!r.success) {
    throw new Error(`golden scenario "${source}" is invalid:\n${z.prettifyError(r.error)}`);
  }
  return r.data;
}
