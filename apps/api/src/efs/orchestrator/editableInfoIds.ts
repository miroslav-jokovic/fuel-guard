import { resolveEditableInfoIds } from "@fuelguard/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
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
 *
 * ── A THIRD caller arrived with Step 9.1's client half, and it has no mutation context ──────────
 * `loadCardControlAccess` ships the same set to the browser, so the drawer can offer the ids this
 * account actually allows instead of the hardcoded pair. It runs on the READ path and holds only an
 * admin client and an org id — no card, no idempotency key, no user. Hence the split below: the
 * lookup takes what it actually needs, and the context overload stays for the two write-path
 * callers. Adding a second query for the read path is exactly the drift this docblock warns about.
 */
export async function resolveEditableInfoIdsForOrg(
  admin: SupabaseClient,
  orgId: string,
): Promise<readonly string[]> {
  const { data } = await admin
    .from("efs_card_control_settings")
    .select("prompt_types")
    .eq("org_id", orgId)
    .maybeSingle();
  return resolveEditableInfoIds((data as { prompt_types?: string[] } | null)?.prompt_types ?? null);
}

export const resolveOrgEditableInfoIds = (ctx: CardMutationContext): Promise<readonly string[]> =>
  resolveEditableInfoIdsForOrg(ctx.admin, ctx.orgId);
