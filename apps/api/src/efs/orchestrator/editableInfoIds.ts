import { resolveEditableInfoIds } from "@fuelguard/shared";
import type { CardMutationContext } from "./types.js";

/**
 * The org's editable prompt ids (Step 9.1), read from our own table rather than from the vendor.
 *
 * `getPromptTypes` on the write path would spend a rate-limit budget keyed on IP rather than on the
 * account it protects (Step 5.6), and would make a rate-limited account one whose prompts cannot be
 * edited at all. The account-inventory walk fills `prompt_types`; this reads it.
 *
 * A missing row resolves to the DRID/UNIT fallback rather than failing the write, and that is a
 * decision rather than an oversight: a missing row is the state EVERY org is in until its first
 * inventory walk, and it is the exact behaviour this product had before Phase 9. Turning it into an
 * outage on a surface that worked yesterday would be the worse failure. The narrowing is not silent
 * either — `schemaCheck` warns at boot if the column is absent, and the inventory walk reports
 * whether its own cache write landed.
 *
 * ── Why this is a module rather than a private function in `plan.ts` ────────────────────────────
 * Because the live PROVER needs the same answer, and did not have it. `proofPrompts` built its
 * sample from the hardcoded DRID/UNIT pair, so a `prove prompts_set` run exercised two ids while the
 * write path validated against twenty-four — a green proof covering less than it appeared to. That
 * is the `oeg5RevertLanded` lesson in a different costume: when a live run goes green, ask which
 * code path it exercised, not whether it passed.
 *
 * One lookup, one meaning. Two copies would let plan and proof drift apart again, and the drift
 * would be invisible precisely because both would be green.
 */
export async function resolveOrgEditableInfoIds(ctx: CardMutationContext): Promise<readonly string[]> {
  const { data } = await ctx.admin
    .from("efs_card_control_settings")
    .select("prompt_types")
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  return resolveEditableInfoIds((data as { prompt_types?: string[] } | null)?.prompt_types ?? null);
}
