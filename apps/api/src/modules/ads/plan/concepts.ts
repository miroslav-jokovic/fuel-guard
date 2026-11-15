import type { SupabaseClient } from "@supabase/supabase-js";
import { distinctConcepts, type PlanConcept, type PlanDrawPreset } from "@silvicom/shared";
import { listPresets } from "../creative/kitVersions.js";

/**
 * The kinds of ad a carrier can make today (ADS-PLATFORM-V2-PLAN V2c): the hook and scene of each of its
 * presets that is enabled, not archived and has a saved version. An ad is always made from a preset, so this
 * is the whole of what a plan may propose — the Strategist is shown these and nothing else, a plan naming any
 * other is refused (`checkPlan`'s `concept_not_available`), and compose draws from the same rows (`planDraw`).
 * One read, three users, so what is offered, what is allowed and what is made cannot differ.
 */
export async function usablePresets(admin: SupabaseClient, orgId: string): Promise<PlanDrawPreset[]> {
  return (await listPresets(admin, orgId))
    .filter((p) => !p.archived_at && p.current)
    .map((p) => ({ version_id: p.current!.id, key: p.key, enabled: p.current!.enabled, hook_family: p.current!.body.hook_family ?? null, scene_family: p.current!.body.scene_family ?? null }));
}

export async function availableConcepts(admin: SupabaseClient, orgId: string): Promise<PlanConcept[]> {
  return distinctConcepts((await usablePresets(admin, orgId)).filter((p) => p.enabled));
}
