import { readFileSync } from "node:fs";
import {
  AD_AGENT_MODELS, AD_HOOK_FAMILIES, AD_HOOK_FAMILY_LABELS, AD_SCENE_FAMILIES, AD_SCENE_FAMILY_LABELS, pictureReadingSchema, type PictureReading,
} from "@silvicom/shared";
import type { ForcedTool, UserPart } from "../../../../lib/anthropic.js";
import { generateWithClaude, type ClaudeGenerationDeps, type ClaudeGenerationOutcome } from "../../generations/claudeGeneration.js";
import { fitForVision, type VisionImage } from "../checker/checker.js";

/**
 * The Swipe reader (ADS-PLATFORM-V2-PLAN V2r, D-AD36): from one picture of an ad a recruiter saved to the swipe
 * file, what the ad leads with and what its picture shows — from the plan's own two closed lists — the words
 * printed on it, and in one sentence what it offers.
 *
 * ── WHAT CAN BE CHECKED, AND WHAT IS MEASURED INSTEAD ─────────────────────────────────────────────────
 * The schema holds the two families to the lists the plan uses, so "what it leads with" is a value a plan's angle
 * is compared with, never a sentence. The words cannot be checked by code against a picture. So the item a reading
 * becomes says "as read" (`pictureEvidence`), the plan may write no figure anyway (`checkPlan`), and the reader's
 * accuracy is measured on fixture ads whose words and families are known (`swipeReaderEval.ts`) — every printed
 * phrase found, no figure that is not printed, both families right — before it climbs past L0 (§4R).
 *
 * The picture is shrunk as the Checker shrinks one (`fitForVision`): a larger image is downscaled by the API
 * anyway, so sending more costs tokens and changes nothing.
 */
export const SWIPE_READER_PROMPT_VERSION = "swipeReader@1";
const PROMPT = readFileSync(new URL("./prompt.v1.md", import.meta.url), "utf8");
const MAX_TOKENS = 2500;

export const describeTool: ForcedTool<PictureReading> = {
  name: "describe_ad",
  description: "Describe the saved ad: what it leads with, what its picture shows, its printed words, and what it offers.",
  schema: pictureReadingSchema,
};

export function pictureSheet(note: string | null) {
  return {
    note,
    hooks: AD_HOOK_FAMILIES.map((key) => ({ key, is: AD_HOOK_FAMILY_LABELS[key] })),
    scenes: AD_SCENE_FAMILIES.map((key) => ({ key, is: AD_SCENE_FAMILY_LABELS[key] })),
  };
}

export async function buildPictureRequest(image: VisionImage, note: string | null) {
  const fitted = await fitForVision(image);
  const user: UserPart[] = [
    { type: "image", format: fitted.format, bytes: fitted.bytes },
    { type: "text", text: JSON.stringify(pictureSheet(note), null, 2) },
  ];
  return { ...AD_AGENT_MODELS.swipe_reader, system: PROMPT, user, tool: describeTool, maxTokens: MAX_TOKENS };
}

export interface ReadPictureInput {
  orgId: string;
  entryId: string;
  attempt: number;
  image: VisionImage;
  note: string | null;
}

export type ReadPictureOutcome =
  | { kind: "read"; generationId: string; reading: PictureReading; replayed: boolean }
  | Exclude<ClaudeGenerationOutcome<PictureReading>, { kind: "succeeded" }>;

export const pictureKey = (entryId: string, attempt: number): string => `swipe:${entryId}:${attempt}`;

export async function readPicture(deps: ClaudeGenerationDeps, input: ReadPictureInput): Promise<ReadPictureOutcome> {
  const out = await generateWithClaude(deps, {
    orgId: input.orgId, agent: "swipe_reader", idempotencyKey: pictureKey(input.entryId, input.attempt),
    promptVersion: SWIPE_READER_PROMPT_VERSION, ...(await buildPictureRequest(input.image, input.note)),
  });
  if (out.kind !== "succeeded") return out;
  return { kind: "read", generationId: out.generationId, reading: out.value, replayed: out.replayed };
}
