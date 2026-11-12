import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  AD_CAMERA_DISTANCES, AD_FOCAL_SUBJECTS, AI_MODELS, FRAME_CLAUSE, QUIET_REGION, artDirection, artPrecheck, judgeArt, publishedFormats,
  type AdBrandKit, type AdPresetRecipe, type ArtAnswer, type ArtDirection, type ArtFinding, type ArtRefusal,
} from "@silvicom/shared";
import type { ForcedTool } from "../../../../lib/anthropic.js";
import { generateWithClaude, type ClaudeGenerationDeps, type ClaudeGenerationOutcome } from "../../generations/claudeGeneration.js";

/**
 * The Art director (ADS-AGENT-BUILD-WORKFLOW C2; plan D-AD9, D-AD11): fills a preset's image-prompt slots
 * and picks the kit photo the image starts from. The rules are `artDirection.ts`'s (`@silvicom/shared`,
 * pure): `artPrecheck` before the model is asked — no reference photo for a scene with equipment, people
 * under a "none" policy, each refused without a call — and `judgeArt` after, so no digit, quotation or
 * request for lettering becomes an image prompt and the photo named is this kit's. The prompt handed on is
 * `composeImagePrompt`'s, which always ends with the no-lettering clause.
 *
 * The model sees the template, the slot names, what the scene shows, the photos' labels and hashes, and — since
 * CQ2 (D-AD20) — the brief's SUBJECT MATTER as `context`: what the job is like (flatbed freight, regional runs,
 * Midwest lanes), so the setting and the hour it chooses fit THIS job and two campaigns on one preset no longer
 * get the same picture (ADS-CREATIVE-QUALITY-PLAN G-CQ2). Still not the claims: the image carries no facts
 * (D-AD9), and `judgeArt` refuses any digit in a slot whatever the context said. Through the A4 rail, as the
 * Copywriter; `buildArtRequest` is exported so `pnpm ads:eval` asks exactly as this does.
 *
 * Since AG3 (prompt v3, 2026-11-10; audit F-AG2) it also DIRECTS THE COMPOSITION. It is told what it could not
 * know and must not decide — the frame's shape, which part of it the words will cover (`QUIET_REGION` of the
 * preset's layout, D-AD28) and the headline that will be drawn there, so the picture suits the words — and it
 * answers the two things only it can: what the one subject is and how near the camera stands, each from a
 * closed list. The headline is the English one compose chose (AG1): it already passed the claim check, and it
 * is data to this model like every other field — never text to draw.
 *
 * Prompt v4 (2026-11-11, ADS-AD-LOOK-PLAN D-ADL10, D-ADL14): the plain part it is told about is now the half the
 * looks' words measure, not a third; and it is asked for the commercial photograph — low sun or night, a low
 * camera on the equipment, `medium` distance — over the snapshot, unless the job's own context makes the weather
 * the story. v3 already chose low light in most answers; v4 removes the two examples that taught the rest.
 *
 * Prompt v5 (2026-11-12, ADS-AD-LOOK-PLAN Q-ADL8, Q-ADL10; the owner approved the recording): the three looks draw
 * no button, so the plain part is "a headline and one short line" and two-fifths, not half (`QUIET_REGION`); a
 * tractor with its trailer is seen from ahead and to one side so the trailer's long side shows, because the
 * carrier's own marks go there afterwards; and it is told not to describe markings — the clean side and the plain
 * grille are `EQUIPMENT_CLAUSE`'s, fixed phrases of ours, not a model's.
 */

export const ART_DIRECTOR_PROMPT_VERSION = "artDirector@5";
const PROMPT = readFileSync(new URL("./prompt.v5.md", import.meta.url), "utf8");
const MAX_TOKENS = 600;

type Recipe = Pick<AdPresetRecipe, "image_prompt_template" | "image_slots" | "starts_from" | "shows_equipment" | "shows_people" | "layout" | "formats">;
type Kit = Pick<AdBrandKit, "equipment_photos" | "people_policy">;

/** The tool for this recipe: one string per slot (lengths and content are `judgeArt`'s), and the photo. */
export function artTool(recipe: Pick<AdPresetRecipe, "image_slots">): ForcedTool<ArtAnswer> {
  return {
    name: "direct_art",
    description: "Fill every image slot with a short visual phrase, choose the reference photo (or null for a text-only scene), and say what the one subject is and how near it is seen.",
    schema: z.object({
      slots: z.object(Object.fromEntries(recipe.image_slots.map((s) => [s, z.string().trim().min(1)]))),
      reference_photo: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
      focal_subject: z.enum(AD_FOCAL_SUBJECTS),
      camera_distance: z.enum(AD_CAMERA_DISTANCES),
    }).strict() as unknown as z.ZodType<ArtAnswer>,
  };
}

/** What the job is like, as the brief's `subject_matter.details` (CQ2); empty when a fixture or a caller has none. */
export type ArtContext = readonly string[];

export function artUserMessage(recipe: Recipe, kit: Kit, context: ArtContext = [], headline: string | null = null): string {
  const frame = publishedFormats(recipe.formats)[0] ?? null;
  return JSON.stringify({
    template: recipe.image_prompt_template,
    slots: recipe.image_slots,
    scene: { starts_from: recipe.starts_from, shows_equipment: recipe.shows_equipment, shows_people: recipe.shows_people },
    composition: { frame: frame ? FRAME_CLAUSE[frame] : null, kept_plain: QUIET_REGION[recipe.layout].where },
    headline,
    context,
    photos: recipe.starts_from === "equipment_photo" ? kit.equipment_photos.map((p) => ({ label: p.label, sha256: p.asset.sha256 })) : [],
  }, null, 2);
}

export function buildArtRequest(recipe: Recipe, kit: Kit, context: ArtContext = [], headline: string | null = null) {
  return { model: AI_MODELS.deep, system: PROMPT, user: artUserMessage(recipe, kit, context, headline), tool: artTool(recipe), maxTokens: MAX_TOKENS };
}

export interface DirectArtInput {
  orgId: string;
  campaignId: string;
  creativeId: string;
  attempt: number;
  recipe: AdPresetRecipe;
  kit: AdBrandKit;
  /** The brief's `subject_matter.details` (CQ2). */
  context?: ArtContext;
  /** The English headline the overlay will draw (AG1's chosen copy); null when a caller has none. */
  headline?: string | null;
}

export type DirectArtOutcome =
  | { kind: "ready"; generationId: string; direction: ArtDirection; replayed: boolean }
  | { kind: "refused"; generationId: string; findings: ArtFinding[]; replayed: boolean }
  | { kind: "not_possible"; reason: ArtRefusal }
  | Exclude<ClaudeGenerationOutcome<ArtAnswer>, { kind: "succeeded" }>;

export async function directArt(deps: ClaudeGenerationDeps, input: DirectArtInput): Promise<DirectArtOutcome> {
  const reason = artPrecheck(input.recipe, input.kit);
  if (reason) return { kind: "not_possible", reason };
  const out = await generateWithClaude(deps, {
    orgId: input.orgId,
    agent: "art_director",
    campaignId: input.campaignId,
    creativeId: input.creativeId,
    idempotencyKey: `art:${input.creativeId}:${input.attempt}`,
    promptVersion: ART_DIRECTOR_PROMPT_VERSION,
    ...buildArtRequest(input.recipe, input.kit, input.context ?? [], input.headline ?? null),
  });
  if (out.kind !== "succeeded") return out;
  const findings = judgeArt(out.value, input.recipe, input.kit);
  return findings.length === 0
    ? { kind: "ready", generationId: out.generationId, direction: artDirection(out.value, input.recipe, input.kit), replayed: out.replayed }
    : { kind: "refused", generationId: out.generationId, findings, replayed: out.replayed };
}
