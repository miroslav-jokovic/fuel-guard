import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  AI_MODELS, FINISHED_AD_CRITERIA, finishedAdScoresSchema,
  type AdBrandKit, type AdFormat, type FinishedAdCheck, type FinishedAdScores,
} from "@silvicom/shared";
import type { ForcedTool, UserPart } from "../../../../lib/anthropic.js";
import { generateWithClaude, type ClaudeGenerationDeps } from "../../generations/claudeGeneration.js";
import { fitForVision, type VisionImage } from "../checker/checker.js";

/**
 * The finished-ad judge (ADS-CREATIVE-QUALITY-PLAN §7, P1-7; Q-AD76; audit AG5). One vision call per published
 * format, on the ENGLISH ad as composed — the picture with our words on it — scoring `FINISHED_AD_CRITERIA` 1–5,
 * each with one line. The contract and why it is never a gate are in `shared/ads/finishedAd.ts`.
 *
 * ── WHY ENGLISH ONLY ───────────────────────────────────────────────────────────────────────────────
 * The Spanish ad is the same picture, the same layout and the same plate with words of about the same length (the
 * overlay refuses a language that does not fit), so a second call per format would score the same four things and
 * double the cost. The Spanish WORDS are the craft judge's (`spanish`), which reads them.
 *
 * ── WHAT IT IS TOLD ────────────────────────────────────────────────────────────────────────────────
 * The words drawn (read from the copy, not from the pixels — a model reading 40-pixel letters back would be a
 * second, worse copy check), the subject the art director chose, the carrier's name and colours, and its logo as
 * its own image. Not the brief: whether a figure is true or good is not this judge's question.
 *
 * Through the A4 rail as every worker: its own switch (`finished_ad_judge`), budget, ledger, replay.
 * `buildFinishedAdRequest` is exported so `pnpm ads:eval finishedAdJudge` asks exactly as the worker does.
 */

export const FINISHED_AD_JUDGE_PROMPT_VERSION = "finishedAdJudge@1";
const PROMPT = readFileSync(new URL("./prompt.v1.md", import.meta.url), "utf8");
const MAX_TOKENS = 1200;

export interface FinishedAdAnswer { scores: FinishedAdScores }

export const finishedAdTool: ForcedTool<FinishedAdAnswer> = {
  name: "judge_finished_ad",
  description: "Score the finished ad in image 1 on the four criteria: for each, one sentence of reason first, then a whole number from 1 to 5.",
  schema: z.object({ scores: finishedAdScoresSchema }).strict() as unknown as z.ZodType<FinishedAdAnswer>,
};

export interface FinishedAdSubject {
  /** The English ad, as composed for this format. */
  image: VisionImage;
  headline: string;
  button: string;
  /** What the picture was directed to be of (`focal_subject`), or null when nobody said. */
  subject: string | null;
  kit: Pick<AdBrandKit, "company_name" | "colors">;
  logo: VisionImage | null;
}

export function finishedAdUserParts(s: FinishedAdSubject): UserPart[] {
  const parts: UserPart[] = [{ type: "text", text: "Image 1 — the finished ad:" }, { type: "image", ...s.image }];
  if (s.logo) parts.push({ type: "text", text: "Image 2 — the carrier's logo:" }, { type: "image", ...s.logo });
  parts.push({
    type: "text",
    text: JSON.stringify({ headline: s.headline, button: s.button, subject: s.subject, company: s.kit.company_name, colors: s.kit.colors }, null, 2),
  });
  return parts;
}

export async function buildFinishedAdRequest(s: FinishedAdSubject) {
  const fitted = { ...s, image: await fitForVision(s.image), logo: s.logo ? await fitForVision(s.logo) : null };
  return { model: AI_MODELS.deep, system: PROMPT, user: finishedAdUserParts(fitted), tool: finishedAdTool, maxTokens: MAX_TOKENS };
}

export interface JudgeFinishedAdsInput {
  orgId: string;
  campaignId: string;
  creativeId: string;
  /** The visual attempt that produced these ads: a regenerated picture is a new ad, judged under a new key. */
  attempt: number;
  /** One English ad per published format, best first. */
  ads: Array<{ format: AdFormat; png: Buffer }>;
  headline: string;
  button: string;
  subject: string | null;
  kit: Pick<AdBrandKit, "company_name" | "colors">;
  logo: VisionImage | null;
}

export type JudgeFinishedAdsOutcome = { kind: "pending"; why: string } | { kind: "judged"; check: FinishedAdCheck };

/**
 * Every published format judged, or why not. A call still in flight is `pending` (compose returns and comes back;
 * the formats already answered replay from their ledger rows). Anything else that is not an answer — switched off,
 * a budget refusal, a failed or off-schema call — is `{ ran: false, not_run }`: the creative goes on to review
 * saying so (Q-AD76). Formats answered before such a refusal are kept, so a reviewer sees what was judged.
 */
export async function judgeFinishedAds(deps: ClaudeGenerationDeps, input: JudgeFinishedAdsInput): Promise<JudgeFinishedAdsOutcome> {
  const byFormat: Record<string, FinishedAdScores> = {};
  for (const ad of input.ads) {
    const req = await buildFinishedAdRequest({
      image: { format: "png", bytes: new Uint8Array(ad.png) }, headline: input.headline, button: input.button,
      subject: input.subject, kit: input.kit, logo: input.logo,
    });
    const out = await generateWithClaude(deps, {
      orgId: input.orgId, agent: "finished_ad_judge", campaignId: input.campaignId, creativeId: input.creativeId,
      idempotencyKey: `finished:${input.creativeId}:${ad.format}:${input.attempt}`, promptVersion: FINISHED_AD_JUDGE_PROMPT_VERSION,
      ...req,
    });
    if (out.kind === "in_flight") return { kind: "pending", why: `finished-ad judge ${ad.format} in flight` };
    if (out.kind !== "succeeded") {
      const notRun = out.kind === "agent_off" ? "agent_off" : out.kind === "budget_exhausted" ? `budget_exhausted (${out.refusal})` : `failed (${out.errorCode})`;
      return { kind: "judged", check: { ran: false, prompt_version: FINISHED_AD_JUDGE_PROMPT_VERSION, not_run: notRun, ...(Object.keys(byFormat).length > 0 ? { by_format: byFormat } : {}) } };
    }
    byFormat[ad.format] = out.value.scores;
  }
  return { kind: "judged", check: { ran: true, prompt_version: FINISHED_AD_JUDGE_PROMPT_VERSION, by_format: byFormat } };
}

/** The scores as "criterion:score" in criteria order — what the eval compares; never stored. */
export const scoreLine = (s: FinishedAdScores): string[] => FINISHED_AD_CRITERIA.map((c) => `${c}:${s[c].score}`);
