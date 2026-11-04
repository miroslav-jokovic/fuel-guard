import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  AI_MODELS, artDirection, artPrecheck, judgeArt,
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
 * The model sees the template, the slot names, what the scene shows and the photos' labels and hashes —
 * not the brief: the image carries no facts (D-AD9), so it has no use for them. Through the A4 rail, as the
 * Copywriter; `buildArtRequest` is exported so `pnpm ads:eval` asks exactly as this does.
 */

export const ART_DIRECTOR_PROMPT_VERSION = "artDirector@1";
const PROMPT = readFileSync(new URL("./prompt.v1.md", import.meta.url), "utf8");
const MAX_TOKENS = 600;

type Recipe = Pick<AdPresetRecipe, "image_prompt_template" | "image_slots" | "starts_from" | "shows_equipment" | "shows_people">;
type Kit = Pick<AdBrandKit, "equipment_photos" | "people_policy">;

/** The tool for this recipe: one string per slot (lengths and content are `judgeArt`'s), and the photo. */
export function artTool(recipe: Pick<AdPresetRecipe, "image_slots">): ForcedTool<ArtAnswer> {
  return {
    name: "direct_art",
    description: "Fill every image slot with a short visual phrase and choose the reference photo (or null for a text-only scene).",
    schema: z.object({
      slots: z.object(Object.fromEntries(recipe.image_slots.map((s) => [s, z.string().trim().min(1)]))),
      reference_photo: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    }).strict() as unknown as z.ZodType<ArtAnswer>,
  };
}

export function artUserMessage(recipe: Recipe, kit: Kit): string {
  return JSON.stringify({
    template: recipe.image_prompt_template,
    slots: recipe.image_slots,
    scene: { starts_from: recipe.starts_from, shows_equipment: recipe.shows_equipment, shows_people: recipe.shows_people },
    photos: recipe.starts_from === "equipment_photo" ? kit.equipment_photos.map((p) => ({ label: p.label, sha256: p.asset.sha256 })) : [],
  }, null, 2);
}

export function buildArtRequest(recipe: Recipe, kit: Kit) {
  return { model: AI_MODELS.deep, system: PROMPT, user: artUserMessage(recipe, kit), tool: artTool(recipe), maxTokens: MAX_TOKENS };
}

export interface DirectArtInput {
  orgId: string;
  campaignId: string;
  creativeId: string;
  attempt: number;
  recipe: AdPresetRecipe;
  kit: AdBrandKit;
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
    ...buildArtRequest(input.recipe, input.kit),
  });
  if (out.kind !== "succeeded") return out;
  const findings = judgeArt(out.value, input.recipe, input.kit);
  return findings.length === 0
    ? { kind: "ready", generationId: out.generationId, direction: artDirection(out.value, input.recipe, input.kit), replayed: out.replayed }
    : { kind: "refused", generationId: out.generationId, findings, replayed: out.replayed };
}
