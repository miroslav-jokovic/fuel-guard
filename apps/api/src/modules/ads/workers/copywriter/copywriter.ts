import { readFileSync } from "node:fs";
import { z } from "zod";
import { AI_MODELS, checkClaims, type AdBrief, type AdPresetRecipe, type ClaimFinding } from "@silvicom/shared";
import type { ForcedTool } from "../../../../lib/anthropic.js";
import { generateWithClaude, type ClaudeGenerationDeps, type ClaudeGenerationOutcome } from "../../generations/claudeGeneration.js";

/**
 * The Copywriter (ADS-AGENT-BUILD-WORKFLOW C2; plan D-AD1, D-AD11, D-AD12 §1): fills a preset's copy
 * slots, in English and Spanish, from the brief — and nothing else.
 *
 * ── THE PROMPT ASKS; THE CLAIM CHECK DECIDES ───────────────────────────────────────────────────────
 * The prompt (`prompt.v1.md`) tells the model to state only the brief's facts, but a model's obedience
 * is measured, never assumed. Every string it returns, in both languages, goes through `checkClaims`
 * (pure, `adClaims.ts`) before it is a value; one finding anywhere and the copy is `refused` with the
 * findings, so the §4R bar "0 claims outside the brief reach review" holds whatever the model writes.
 * The schema requires every slot in both languages; the check also holds each to its `max_chars` — an
 * answer that runs over is refused (`too_long`), never trimmed into a sentence nobody wrote.
 *
 * ── WHAT THE MODEL SEES ────────────────────────────────────────────────────────────────────────────
 * The brief's subject and claims and the recipe's hook formula and slots, as JSON, and nothing else:
 * not the area (targeting is not copy), not the landing URL, not the campaign. The prompt calls all of
 * it data, so an instruction typed into a brief field is text, not a command (the §4R L2 fault).
 *
 * The call goes through the A4 rail (`generateWithClaude`): the switch, the budget, the ledger and the
 * replay are its, and this file holds no client. `buildCopyRequest` and `judgeCopy` are exported so
 * `pnpm ads:eval` asks and judges exactly as the worker does.
 */

export const COPYWRITER_PROMPT_VERSION = "copywriter@1";
const PROMPT = readFileSync(new URL("./prompt.v1.md", import.meta.url), "utf8");
export const COPY_LANGUAGES = ["en", "es"] as const;
const MAX_TOKENS = 1200;

export type CopySlots = Record<string, string>;
export interface AdCopy { en: CopySlots; es: CopySlots }

/**
 * The tool for this recipe: an object per language, one non-empty string per slot, nothing else. The
 * length is NOT in the schema: it is the copy check's (D-AD12 §1, "the length fits each placement"), so an
 * answer that runs over is recorded as the model's answer and refused as `too_long`, with the slot named.
 */
export function copyTool(recipe: Pick<AdPresetRecipe, "copy_slots">): ForcedTool<AdCopy> {
  const slots = z.object(Object.fromEntries(recipe.copy_slots.map((s) => [s.name, z.string().trim().min(1)]))).strict();
  return {
    name: "write_copy",
    description: "Fill every copy slot of the concept in English (en) and Spanish (es), stating only the facts given.",
    schema: z.object({ en: slots, es: slots }).strict() as unknown as z.ZodType<AdCopy>,
  };
}

/**
 * The share of a slot's limit the model is TOLD it has. Measured 2026-11-03 (`pnpm ads:eval copywriter`,
 * 10 briefs): told the real limit, the model ran over it by 1–11 characters in 3 of 10 answers, mostly in
 * Spanish — a model does not count characters exactly. The schema still enforces the real limit; the
 * margin only makes an honest answer fit it.
 */
export const TOLD_LIMIT_SHARE = 0.85;

/** The user message: the brief's facts and the concept, as data. */
export function copyUserMessage(brief: Pick<AdBrief, "subject" | "claims">, recipe: AdPresetRecipe): string {
  return JSON.stringify({
    subject: brief.subject,
    facts: brief.claims,
    concept: {
      name: recipe.name,
      hook_formula: recipe.hook_formula,
      slots: recipe.copy_slots.map((s) => ({ name: s.name, max_chars: Math.floor(s.max_chars * TOLD_LIMIT_SHARE) })),
    },
  }, null, 2);
}

export function buildCopyRequest(brief: Pick<AdBrief, "subject" | "claims">, recipe: AdPresetRecipe) {
  return { model: AI_MODELS.deep, system: PROMPT, user: copyUserMessage(brief, recipe), tool: copyTool(recipe), maxTokens: MAX_TOKENS };
}

type Located = { language: (typeof COPY_LANGUAGES)[number]; slot: string };
export type SlotFinding =
  | (ClaimFinding & Located)
  | ({ kind: "too_long"; text: string; index: number; length: number; max_chars: number } & Located);
export type CopyVerdict = { ok: true } | { ok: false; findings: SlotFinding[] };

/** Every string of every language against the brief and its slot's limit. Pure. */
export function judgeCopy(copy: AdCopy, brief: Pick<AdBrief, "claims">, recipe: Pick<AdPresetRecipe, "copy_slots">): CopyVerdict {
  const findings: SlotFinding[] = [];
  const limit = new Map(recipe.copy_slots.map((s) => [s.name, s.max_chars]));
  for (const language of COPY_LANGUAGES) {
    for (const [slot, text] of Object.entries(copy[language])) {
      const max = limit.get(slot)!;
      if (text.length > max) findings.push({ kind: "too_long", text, index: max, length: text.length, max_chars: max, language, slot });
      for (const f of checkClaims(text, brief).findings) findings.push({ ...f, language, slot });
    }
  }
  return findings.length === 0 ? { ok: true } : { ok: false, findings };
}

export interface WriteCopyInput {
  orgId: string;
  campaignId: string;
  creativeId: string;
  /** 1 for the first try; the checker's one regeneration (C5) is attempt 2, a new key. */
  attempt: number;
  brief: AdBrief;
  recipe: AdPresetRecipe;
}

export type WriteCopyOutcome =
  | { kind: "ready"; generationId: string; copy: AdCopy; replayed: boolean }
  | { kind: "refused"; generationId: string; findings: SlotFinding[]; replayed: boolean }
  | Exclude<ClaudeGenerationOutcome<AdCopy>, { kind: "succeeded" }>;

export async function writeCopy(deps: ClaudeGenerationDeps, input: WriteCopyInput): Promise<WriteCopyOutcome> {
  const req = buildCopyRequest(input.brief, input.recipe);
  const out = await generateWithClaude(deps, {
    orgId: input.orgId,
    agent: "copywriter",
    campaignId: input.campaignId,
    creativeId: input.creativeId,
    idempotencyKey: `copy:${input.creativeId}:${input.attempt}`,
    promptVersion: COPYWRITER_PROMPT_VERSION,
    ...req,
  });
  if (out.kind !== "succeeded") return out;
  const verdict = judgeCopy(out.value, input.brief, input.recipe);
  return verdict.ok
    ? { kind: "ready", generationId: out.generationId, copy: out.value, replayed: out.replayed }
    : { kind: "refused", generationId: out.generationId, findings: verdict.findings, replayed: out.replayed };
}
