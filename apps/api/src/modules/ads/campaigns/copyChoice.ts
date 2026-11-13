import type { SupabaseClient } from "@supabase/supabase-js";
import { adBriefSchema, adCandidatesSchema, publishedFormats, type AdFormat, type AdsCopyChoice } from "@silvicom/shared";
import { campaignKit, recipeById } from "../compose/composeCampaign.js";
import { drawnCopy } from "../compose/composeCreative.js";
import { overlayFit, type OverlayFinding, type OverlayLanguage } from "../creative/overlay/overlay.js";
import { judgeCopy, type SlotFinding } from "../workers/copywriter/copywriter.js";
import type { Actor } from "../settings/settingsVersions.js";
import { decideOnCreative } from "./creativeDecisions.js";
import { personMove } from "./campaignDoors.js";

/**
 * A person chooses the words of one ad (ADS-AD-LOOK-PLAN Q-ADL7; the owner, 2026-11-12: "we should in settings have
 * texts to choose, or ads page"). The reviewer picks one of the copies the writer offered, or edits any line, and
 * the ad is remade with those words on the SAME picture.
 *
 * ── WHY A NEW CREATIVE, NOT AN EDIT ─────────────────────────────────────────────────────────────
 * 0537 freezes a creative once it leaves the workers ("what a person approved is what runs"), so the words of a
 * `ready` creative are never changed in place. Instead, in this order:
 *   1. the words are checked as compose would check them — every slot of the preset in both languages, each within
 *      its limit and stating nothing the brief does not (`judgeCopy`), and the overlay able to draw them on every
 *      published format in both languages (`overlayFit`) — so a choice that cannot become an ad is refused here,
 *      with the findings, and nothing is written;
 *   2. the choice is recorded (`ads_copy_choices`, 0595; this file is its one writer), naming the creative it
 *      replaces;
 *   3. that creative is rejected through the ordinary door, with the reason saying so (`creativeDecisions.ts`);
 *   4. the campaign moves through `regenerate`, and compose builds the successor from the recorded words,
 *      replaying the replaced creative's picture from its ledger rows (`composeCreative`, `choice`). No new image
 *      is paid for; the overlay and the visual check run again, because the words changed.
 * A second press on the same creative finds the choice already recorded (one per replaced creative) and carries on
 * from wherever the first stopped, so a press interrupted between steps is finished, not duplicated.
 */
export type CopyChoiceOutcome =
  | { kind: "chosen"; replaced: string }
  | { kind: "not_found" }
  | { kind: "refused"; reason: "campaign_not_in_review" | "not_ready" | "settings_not_saved" | "slots_mismatch" | "unknown_candidate" | "chosen_differently" | "cannot_regenerate"; detail?: string }
  | { kind: "words_refused"; copy: SlotFinding[]; overlay: Array<{ format: AdFormat; language: OverlayLanguage; findings: OverlayFinding[] }> };

const LANGUAGES: OverlayLanguage[] = ["en", "es"];

export async function chooseWords(
  admin: SupabaseClient, orgId: string, actor: Actor, campaignId: string, creativeId: string, ask: AdsCopyChoice, now: Date,
): Promise<CopyChoiceOutcome> {
  const [{ data: campaign, error: cErr }, { data: creative, error: crErr }, { data: prior, error: pErr }] = await Promise.all([
    admin.from("ads_campaigns").select("state, brief_snapshot, brand_kit_id").eq("org_id", orgId).eq("id", campaignId).maybeSingle(),
    admin.from("ads_creatives").select("state, preset_version_id, copy, candidates").eq("org_id", orgId).eq("campaign_id", campaignId).eq("id", creativeId).maybeSingle(),
    admin.from("ads_copy_choices").select("copy, from_candidate").eq("org_id", orgId).eq("replaces_creative_id", creativeId).maybeSingle(),
  ]);
  if (cErr) throw new Error(`ads_campaigns: ${cErr.message}`);
  if (crErr) throw new Error(`ads_creatives: ${crErr.message}`);
  if (pErr) throw new Error(`ads_copy_choices: ${pErr.message}`);
  if (!campaign || !creative) return { kind: "not_found" };
  const c = campaign as { state: string; brief_snapshot: unknown; brand_kit_id: string | null };
  const cr = creative as { state: string; preset_version_id: string; copy: { en: Record<string, string>; es: Record<string, string> } | null; candidates: unknown };

  // A press that already recorded this choice resumes from where it stopped; a different choice is refused.
  const recorded = prior as { copy: AdsCopyChoice["copy"]; from_candidate: number | null } | null;
  if (recorded && (JSON.stringify(recorded.copy) !== JSON.stringify(ask.copy) || recorded.from_candidate !== ask.from_candidate)) return { kind: "refused", reason: "chosen_differently" };
  if (!recorded) {
    if (c.state !== "review") return { kind: "refused", reason: "campaign_not_in_review" };
    if (cr.state !== "ready") return { kind: "refused", reason: "not_ready" };
  }

  // 1. The words, checked as compose checks them.
  const recipe = await recipeById(admin, orgId, cr.preset_version_id);
  const slots = recipe.copy_slots.map((s) => s.name).sort().join(",");
  if (LANGUAGES.some((l) => Object.keys(ask.copy[l]).sort().join(",") !== slots)) return { kind: "refused", reason: "slots_mismatch", detail: `every one of ${slots.replaceAll(",", ", ")}, in English and Spanish` };
  const candidates = adCandidatesSchema.safeParse(cr.candidates);
  if (ask.from_candidate !== null && (!candidates.success || ask.from_candidate >= candidates.data.ranked.length)) return { kind: "refused", reason: "unknown_candidate" };
  const brief = adBriefSchema.parse(c.brief_snapshot);
  const kit = await campaignKit(admin, orgId, c.brand_kit_id);
  if (!kit.ok) return { kind: "refused", reason: "cannot_regenerate", detail: kit.error };
  const verdict = judgeCopy(ask.copy, brief, recipe, { company_name: kit.kit.body.company_name });
  const overlay: Array<{ format: AdFormat; language: OverlayLanguage; findings: OverlayFinding[] }> = [];
  if (recipe.overlay_slots) {
    for (const format of publishedFormats(recipe.formats)) for (const language of LANGUAGES) {
      const findings = overlayFit({ format, language, brief, kit: kit.kit.body, layout: recipe.layout, look: recipe.look, ...drawnCopy(recipe.overlay_slots, ask.copy[language]) });
      if (findings.length) overlay.push({ format, language, findings });
    }
  }
  if (!verdict.ok || overlay.length) return { kind: "words_refused", copy: verdict.ok ? [] : verdict.findings, overlay };

  // 2. The choice, on record. What the person changed is measured against the copy they started from.
  if (!recorded) {
    const start = ask.from_candidate !== null && candidates.success ? candidates.data.ranked[ask.from_candidate]!.copy : cr.copy;
    const edited = recipe.copy_slots.map((s) => s.name).filter((slot) => LANGUAGES.some((l) => start?.[l]?.[slot] !== ask.copy[l][slot]));
    const { error } = await admin.from("ads_copy_choices").insert({
      org_id: orgId, campaign_id: campaignId, replaces_creative_id: creativeId, copy: ask.copy, from_candidate: ask.from_candidate,
      edited_slots: edited, chosen_by: actor.id, chosen_by_name: actor.name,
    });
    // 23505: a press racing this one recorded it first; the read above will see it on the next press.
    if (error && (error as { code?: string }).code !== "23505") throw new Error(`ads_copy_choices: ${error.message}`);
  }

  // An earlier press that got as far as the campaign's move has nothing left to do.
  if (recorded && c.state !== "review") return { kind: "chosen", replaced: creativeId };

  // 3. The creative it replaces, rejected for that reason (a no-op when an earlier press already did).
  const decided = await decideOnCreative(admin, orgId, actor, campaignId, creativeId, { decision: "reject", reason: "Replaced: the words were chosen by a person; the same picture is redrawn with them." }, now);
  if (decided.kind === "not_found") return { kind: "not_found" };
  if (decided.kind === "refused") return { kind: "refused", reason: decided.reason === "settings_not_saved" ? "settings_not_saved" : "not_ready" };

  // 4. Compose builds the successor.
  const moved = await personMove(admin, orgId, actor, campaignId, { event: "regenerate", reason: `${actor.name} chose the words of one ad` }, now);
  if (moved.kind !== "moved") return { kind: "refused", reason: "cannot_regenerate", detail: moved.kind === "refused" ? moved.reason : moved.kind };
  return { kind: "chosen", replaced: creativeId };
}
