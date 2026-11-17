import type { SupabaseClient } from "@supabase/supabase-js";
import { distinctConcepts, planFormatsFor, type PlanConcept, type PlanDrawPreset, type PlanOffer } from "@silvicom/shared";
import { renderChoiceFor } from "../creative/higgsfield/simulatedRender.js";
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

/**
 * What ONE campaign's plan may choose from (V4, 2026-11-17): the carrier's concepts, and the formats this
 * campaign can be made in. The formats follow the campaign's connection, read through the same
 * `renderChoiceFor` compose hands `makeMotion` its video model from — so a plan is offered `motion` exactly
 * where compose would make one, and nowhere else: no real connection has a video model until the owner's
 * sitting chooses it (Q-APX12), and the simulator's exists only on a simulator connection off production.
 * The planning step, both of the plan's doors and the editor's read all ask here.
 */
export async function planOffer(admin: SupabaseClient, campaign: { org_id: string; connection_id: string }, processEnv: NodeJS.ProcessEnv = process.env): Promise<PlanOffer> {
  const [concepts, choice] = await Promise.all([availableConcepts(admin, campaign.org_id), renderChoiceFor(admin, campaign.org_id, campaign.connection_id, processEnv)]);
  return { concepts, formats: planFormatsFor(choice) };
}
