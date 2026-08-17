import { z } from "zod";
import {
  EFS_DYNAMIC_INFO_IDS,
  EFS_INFO_LABELS,
  EFS_MATCH_VALUE_MAX,
  EFS_PROMPT_ACCRUAL_MAX,
  EFS_VALIDATION_TYPES,
} from "./efsCardCatalog.js";
import { cardVersionSchema } from "./cardVersion.js";

/**
 * What the pump asks a driver for — the prompt half of the card-control contract.
 *
 * Split out of `cardControlContract.ts` when Step 9.2 pushed that file past the 500-line budget.
 * The boundary is not arbitrary: prompts are the one sub-document with its own vendor vocabulary
 * (seven validation types, an accrual value, a pair of length-gated bounds), their own audit history
 * — P1-6a, P1-6b and the reportValue deletion all live here — and the only surface where a lost
 * record silently stops a pump. Everything in this file is re-exported from `cardControlContract.ts`
 * so no caller has to know it moved.
 */

/**
 * One prompt, as an operator may submit it (Step 9.2).
 *
 * ── `infoId` is a string here, and validated where the ANSWER lives ──────────────────────────────
 * It was `z.enum(EFS_EDITABLE_INFO_IDS)`. That enum is a compile-time constant and the editable set
 * is now per-ACCOUNT, resolved from `getPromptTypes` — so the enum could only ever be right for an
 * account that happens to match it. Worse, the two disagreeing is not inert: a submission the schema
 * accepts but the resolved set excludes used to append a SECOND record with the same `infoId`
 * (audit P1-6b's duplicate shape). `promptsEdits` refuses that as of Step 9.1c, and this schema
 * stops pretending it can decide the question at parse time.
 *
 * Shape only, then: four upper-case letters, which is what `string (4)` means in the guide's own
 * table (p36). Whether THIS account offers it is a runtime fact and is answered by the runtime.
 *
 * ── All seven validation types, and DYNAMIC is card-level ────────────────────────────────────────
 * The guide lists seven on the CARD pages (p36, p135, p138) and six on the POLICY pages (p84, p146),
 * omitting `DYNAMIC` from the latter. This schema describes a card write, so seven is correct here —
 * and that asymmetry is the vendor's, recorded rather than smoothed over.
 */
export const promptInputSchema = z.object({
  infoId: z.string().trim().toUpperCase().regex(/^[A-Z]{4}$/, "An Info ID is four letters."),
  validationType: z.enum(EFS_VALIDATION_TYPES),
  matchValue: z.string().trim().max(EFS_MATCH_VALUE_MAX).nullable(),
  reportValue: z.string().trim().max(EFS_MATCH_VALUE_MAX).nullable(),
  /**
   * The accrual value, and ONLY meaningful for `ACCRUAL_CHECK`.
   *
   * The guide, verbatim (p36, p135, p138): *"For the accrual check method for odometer or hubometer,
   * this is the accrual value. For all other info ids/validation type combos just leave as `<value/>`
   * or `<value>0</value>`."*
   *
   * Typed as an integer here although the vendor describes it three different ways — `int` in the
   * WSDL's `WSCardInfo`, "String" on the guide's card pages, "int(24)" on setPolicy (p146). An
   * integer is the only reading all three admit, production returns `"0"`, and the wire form is
   * digits either way.
   */
  value: z.coerce.number().int().min(0).max(EFS_PROMPT_ACCRUAL_MAX).nullable().default(null),
  /**
   * Length checking, and the two bounds it gates.
   *
   * `minimum`/`maximum` are "Only checked if lengthCheck is true" (p36, p135) — so sending bounds
   * without the flag is not a smaller version of the feature, it is a no-op the vendor accepts and
   * ignores, which is this account's demonstrated failure mode for shapes it does not expect
   * (audit W3). The refinement below refuses the combination rather than letting an operator believe
   * they set a limit.
   *
   * The guide contradicts itself on what the bounds MEAN — "the maximum value" on the card pages,
   * "Max length" on the policy pages (p84, p146). Both readings are gated on the same flag, so this
   * schema takes no position on which is right; it only refuses the shape that is inert under either.
   */
  lengthCheck: z.boolean().default(false),
  minimum: z.coerce.number().int().min(0).nullable().default(null),
  maximum: z.coerce.number().int().min(0).nullable().default(null),
  remove: z.boolean().default(false),
})
  .refine(
    (p) => p.remove || p.validationType !== "EXACT_MATCH" || (p.matchValue ?? "").length > 0,
    // The pump validates driver entry AGAINST this value. Empty + EXACT_MATCH means nothing a driver
    // types can ever match: the card silently stops fueling (audit P1-6a). Clearing the value while
    // keeping validation on is never what an operator meant — make them pick one.
    { message: "EXACT_MATCH needs a value to match — clear the validation type instead of the value." },
  )
  .refine(
    (p) => p.remove || p.validationType !== "DYNAMIC" || (EFS_DYNAMIC_INFO_IDS as readonly string[]).includes(p.infoId),
    // "DYNAMIC can only be used with CNTN, PPIN and DRID" (p36, p136). PPIN is denied by this product
    // (EFS_UNEDITABLE_INFO_IDS), so in practice this reaches CNTN and DRID — a narrowing of the
    // vendor's rule that belongs to the denial, not to this refinement.
    { message: "DYNAMIC is only valid on the Control number, Personal identifier and Driver ID prompts." },
  )
  .refine(
    (p) => p.remove || p.validationType !== "ACCRUAL_CHECK" || (p.value ?? 0) > 0,
    // An ACCRUAL_CHECK whose accrual is 0 is the guide's own "no accrual configured" sentinel, so
    // submitting one asks the pump to follow an odometer by nothing. Production carries exactly that
    // on both policies (docs/25 Q3) — which is a fact about the account, not a shape to accept from
    // an operator who has just chosen odometer following on purpose.
    { message: "Odometer following needs an accrual value above zero." },
  )
  .refine(
    (p) => p.lengthCheck || (p.minimum === null && p.maximum === null),
    { message: "A minimum or maximum is only checked when length checking is on." },
  )
  .refine(
    (p) => p.minimum === null || p.maximum === null || p.minimum <= p.maximum,
    { message: "The minimum cannot exceed the maximum." },
  );
export type PromptInput = z.infer<typeof promptInputSchema>;

/**
 * The fields Step 9.2 added, at the values that mean "not configured".
 *
 * Exported because `.default()` puts these in the PARSED type, so every caller that builds a
 * `PromptInput` by hand — the drawer's drafts, the add-a-prompt control, their tests — must supply
 * them. Spreading one shared constant is what keeps "an unconfigured prompt" a single definition
 * rather than five literals that drift apart, and it is why `value: 0` and `value: null` cannot come
 * to mean different things in different files.
 *
 * `value: null` rather than `0`: the guide's "leave as <value/> or <value>0</value>" is about the
 * WIRE, and the wire form is produced by `promptsEdits`. In a draft, null says the operator has not
 * chosen an accrual, which is the state an ACCRUAL_CHECK submission is refused for.
 */
export const PROMPT_INPUT_UNSET = {
  value: null,
  lengthCheck: false,
  minimum: null,
  maximum: null,
} as const satisfies Pick<PromptInput, "value" | "lengthCheck" | "minimum" | "maximum">;

export const setPromptsSchema = z.object({
  expectedVersion: cardVersionSchema,
  /**
   * Full-replace is the EFS semantic, not a convenience: the API carries every prompt record and
   * requires explicit `remove: true` before omitting one from the setCardV2 document.
   */
  replaceAll: z.literal(true),
  // Bounded by what is actually editable, and UNIQUE by infoId: EFS's prompts array is a full
  // replace, and two records with one infoId is a document shape the vendor never emits — on this
  // vendor, "accepted and ignored" is the documented failure mode for shapes it has never seen
  // (audit P1-6b). The append loop in efsCardEdits would have pushed both.
  prompts: z.array(promptInputSchema)
    // Bounded by the vendor's own vocabulary rather than by what this product happens to allow: the
    // guide's Info IDs table has 26 entries, so no honest card can carry more records than that and
    // a request claiming to is malformed regardless of which ids it names. The old cap was
    // `EFS_EDITABLE_INFO_IDS.length` — 2 — which was a compile-time guess at a per-account fact and
    // would have refused a legitimate five-prompt card the moment Step 9.1 widened the set.
    .max(Object.keys(EFS_INFO_LABELS).length)
    .refine(
      (list) => new Set(list.map((p) => p.infoId)).size === list.length,
      { message: "Each prompt may appear once." },
    ),
  /**
   * Dropping the DRID record stops the pump asking who is fuelling, and every downstream attribution
   * decision loses its strongest signal. Explicit opt-in plus step-up re-auth; never a side effect of
   * clearing a text box.
   */
  allowRemoveDriverId: z.boolean().default(false),
});
export type SetPromptsRequest = z.infer<typeof setPromptsSchema>;
