import { readFileSync } from "node:fs";
import { z } from "zod";
import { AI_MODELS, checkClaims, overlaySlotList, type AdBrief, type AdClaim, type AdPresetRecipe, type ClaimFinding } from "@silvicom/shared";
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
 * The brief's subject, claims and SUBJECT MATTER (CQ2, D-AD20: the equipment, the lanes, the schedule, the
 * carrier's own line — what the job is like, claiming nothing), the carrier's name from the kit, and the
 * recipe's hook formula and slots, as JSON, and nothing else: not the area (targeting is not copy), not the
 * landing URL, not the campaign. The prompt calls all of it data, so an instruction typed into a brief
 * field is text, not a command (the §4R L2 fault). Before CQ2 the model saw three to five facts and
 * nothing of the job, which is where the generic ad came from (ADS-CREATIVE-QUALITY-PLAN G-CQ4).
 *
 * The company's name is the one phrase the claim check takes as written (`exempt_phrases`): "360 Logistics"
 * holds a digit that is not a figure. Nothing else is exempt.
 *
 * The call goes through the A4 rail (`generateWithClaude`): the switch, the budget, the ledger and the
 * replay are its, and this file holds no client. `buildCopyRequest` and `judgeCopy` are exported so
 * `pnpm ads:eval` asks and judges exactly as the worker does.
 */

export const COPYWRITER_PROMPT_VERSION = "copywriter@4";
const PROMPT = readFileSync(new URL("./prompt.v4.md", import.meta.url), "utf8");
export const COPY_LANGUAGES = ["en", "es"] as const;
/** Five candidates of eight slots in two languages is ~5,000 tokens of text; the ceiling leaves room. */
const MAX_TOKENS = 6000;
/** How many copies a creative asks for when its settings say nothing (the contract's own default). */
export const DEFAULT_CANDIDATES = 3;

export type CopySlots = Record<string, string>;
export interface AdCopy { en: CopySlots; es: CopySlots }
/** What the tool returns (CQ4, D-AD19): `k` candidates, each a whole copy in both languages. */
export interface CopySet { candidates: AdCopy[] }

/**
 * The tool for this recipe: exactly `k` candidates, each an object per language with one non-empty string per
 * slot, nothing else. The length is NOT in the schema: it is the copy check's (D-AD12 §1, "the length fits each
 * placement"), so an answer that runs over is recorded as the model's answer and refused as `too_long`, with the
 * slot named. `k` is `settings.budgets.candidates_per_creative` (1–5); a planted fixture may ask for one.
 */
export function copyTool(recipe: Pick<AdPresetRecipe, "copy_slots">, k: number = DEFAULT_CANDIDATES): ForcedTool<CopySet> {
  const slots = z.object(Object.fromEntries(recipe.copy_slots.map((s) => [s.name, z.string().trim().min(1)]))).strict();
  const copy = z.object({ en: slots, es: slots }).strict();
  return {
    name: "write_copy",
    description: `Write ${k} different candidates for the advertisement's words, each filling every copy slot of the concept in English (en) and Spanish (es), stating only the facts given.`,
    schema: z.object({ candidates: z.array(copy).length(k) }).strict() as unknown as z.ZodType<CopySet>,
  };
}

/**
 * The share of a slot's limit the model is TOLD it has. Measured 2026-11-03 (`pnpm ads:eval copywriter`,
 * 10 briefs): told the real limit, the model ran over it by 1–11 characters in 3 of 10 answers, mostly in
 * Spanish — a model does not count characters exactly. The schema still enforces the real limit; the
 * margin only makes an honest answer fit it.
 *
 * A SHORT slot gets a wider margin. Measured 2026-11-05 over P1–P5's slots (40 briefs): at 85 %, 7 of 40
 * answers still ran over, every one in a slot of 30–42 characters (an overlay line, Meta's 40-character
 * headline), by up to 13 characters past what the model was told — mostly the Spanish, a translation of
 * an English answer that itself only just fit. An overrun is a whole creative lost, so the short slots,
 * where a few characters are a large share, are told 70 %.
 */
export const TOLD_LIMIT_SHARE = 0.85;
export const SHORT_SLOT_CHARS = 60;
export const TOLD_SHORT_SHARE = 0.7;
export const toldLimit = (maxChars: number): number =>
  Math.floor(maxChars * (maxChars <= SHORT_SLOT_CHARS ? TOLD_SHORT_SHARE : TOLD_LIMIT_SHARE));

/** What the copywriter is told about the carrier (CQ2): its name as the ad should print it, or null; and how many copies to offer (CQ4). */
export interface CopyContext { company_name: string | null; candidates?: number }
const NO_CONTEXT: CopyContext = { company_name: null };
const kOf = (ctx: CopyContext): number => ctx.candidates ?? DEFAULT_CANDIDATES;

/**
 * A fact written out as an ad would print it, beside its structured form: "$12,000 per week", "$0.65 per mile",
 * "23 years of age", "home weekly". Measured 2026-11-09 (first v2 run): told `cents: 1200000`, the model wrote
 * "$1,200" — a cents-to-dollars slip the claim check caught. Showing the figure written out takes that arithmetic
 * off the model; the check still holds whatever it writes.
 */
export function shownFact(c: AdClaim): string {
  if (c.kind === "term") return c.term;
  if (c.kind === "quantity") return c.unit === "age" ? `${c.value} years of age` : `${c.value} ${c.unit}${c.value === 1 ? "" : "s"}`;
  const dollars = c.cents % 100 === 0 ? (c.cents / 100).toLocaleString("en-US") : (c.cents / 100).toFixed(2);
  return `$${dollars}${c.per ? ` per ${c.per}` : ""}`;
}

/**
 * How a slot the overlay draws is named to the model (prompt v4; ADS-AD-LOOK-PLAN D-ADL4). Until v4 the model was
 * handed every slot alike, so the line drawn across the picture in display type was written like the paragraph
 * beside it: a two-sentence hook near its limit, which the look's ladder then drew at its smallest rung. The
 * roles are the contract's (`overlaySlotList`), worded for a reader: the model is told a `second_line` and a
 * `button`, not our field names.
 */
const ON_IMAGE = { kicker: "kicker", headline: "headline", subline: "second_line", cta: "button" } as const;

/** The user message: the brief's facts (each also written out), what the job is like, the carrier, and the concept, as data. */
export function copyUserMessage(brief: Pick<AdBrief, "subject" | "claims" | "subject_matter">, recipe: AdPresetRecipe, ctx: CopyContext = NO_CONTEXT): string {
  const drawn = new Map(recipe.overlay_slots ? overlaySlotList(recipe.overlay_slots).map(([role, slot]) => [slot, role] as const) : []);
  return JSON.stringify({
    subject: brief.subject,
    facts: brief.claims.map((c) => ({ ...c, shown: shownFact(c) })),
    about_the_job: brief.subject_matter.details,
    in_our_words: brief.subject_matter.in_our_words,
    company: ctx.company_name,
    candidates: kOf(ctx),
    concept: {
      name: recipe.name,
      hook_formula: recipe.hook_formula,
      slots: recipe.copy_slots.map((s) => ({ name: s.name, max_chars: toldLimit(s.max_chars), ...(drawn.has(s.name) ? { on_image: ON_IMAGE[drawn.get(s.name)!] } : {}) })),
    },
  }, null, 2);
}

export function buildCopyRequest(brief: Pick<AdBrief, "subject" | "claims" | "subject_matter">, recipe: AdPresetRecipe, ctx: CopyContext = NO_CONTEXT) {
  return { model: AI_MODELS.deep, system: PROMPT, user: copyUserMessage(brief, recipe, ctx), tool: copyTool(recipe, kOf(ctx)), maxTokens: MAX_TOKENS };
}

type Located = { language: (typeof COPY_LANGUAGES)[number]; slot: string };
export type SlotFinding =
  | (ClaimFinding & Located)
  | ({ kind: "too_long"; text: string; index: number; length: number; max_chars: number } & Located);
export type CopyVerdict = { ok: true } | { ok: false; findings: SlotFinding[] };

/** One candidate the claim and length checks let through, with its place in the model's own order. */
export interface PassedCopy { copy: AdCopy; offered_as: number }
/** Every candidate judged: the survivors in the model's order, and each refused one's findings by index. */
export interface SetVerdict { passed: PassedCopy[]; refused: Array<{ offered_as: number; findings: SlotFinding[] }> }

export function judgeSet(set: CopySet, brief: Pick<AdBrief, "claims" | "subject_matter">, recipe: Pick<AdPresetRecipe, "copy_slots">, ctx: CopyContext = NO_CONTEXT): SetVerdict {
  const out: SetVerdict = { passed: [], refused: [] };
  set.candidates.forEach((copy, offered_as) => {
    const v = judgeCopy(copy, brief, recipe, ctx);
    if (v.ok) out.passed.push({ copy, offered_as });
    else out.refused.push({ offered_as, findings: v.findings });
  });
  return out;
}

/**
 * ── ONE FIT PASS, FOR WORDING ONLY (CQ2, measured 2026-11-09) ──────────────────────────────────────
 * On the first live run under v2 with the wider briefs, 8 of 60 answers were refused, and 6 of those for
 * wording a copy desk would hand back: a slot over its limit, "kilómetros" beside a per-mile rate. Those are not
 * inventions — the facts were right — and a second ask that names the exact findings fixes them. So a refusal
 * whose EVERY finding is one of these kinds gets exactly one more call (`buildFitRequest`): the first answer,
 * the findings, and the order to change nothing else. A refusal with any other finding — a figure or a promise
 * not in the brief, forbidden wording — stops at once: a model that invented a number is not coaxed, and
 * D-AD12's "stops and shows the reason" holds. The pass is ledgered under its own key (`…:fit`) and replayed
 * like every other call, and `ads:eval` runs the same pass, so the baseline measures what production does.
 */
export const FIT_FINDINGS: ReadonlySet<SlotFinding["kind"]> = new Set(["too_long", "foreign_unit"]);
export const canFit = (findings: readonly SlotFinding[]): boolean => findings.length > 0 && findings.every((f) => FIT_FINDINGS.has(f.kind));

/**
 * The candidates whose every finding is wording — the ones a fit pass can mend. A candidate with any other finding
 * (a figure or promise not in the brief) is left out: it is dropped from the set, never coaxed.
 */
export function fittable(verdict: SetVerdict): Array<{ offered_as: number; findings: SlotFinding[] }> {
  return verdict.refused.filter((r) => canFit(r.findings));
}

/** The second ask: the same data, plus the first answer and what must change in it, candidate by candidate. */
export function buildFitRequest(brief: Pick<AdBrief, "subject" | "claims" | "subject_matter">, recipe: AdPresetRecipe, ctx: CopyContext, previous: CopySet, toFix: ReadonlyArray<{ offered_as: number; findings: readonly SlotFinding[] }>) {
  const must_fix = toFix.flatMap(({ offered_as, findings }) => findings.map((f) => f.kind === "too_long"
    ? { candidate: offered_as, language: f.language, slot: f.slot, problem: `${f.length} characters; the most allowed is ${toldLimit(f.max_chars)} — cut words, keep the facts` }
    : { candidate: offered_as, language: f.language, slot: f.slot, problem: `"${f.text}" is not a unit a US driver uses; say it in miles or leave the distance out` }));
  const user = JSON.stringify({ ...JSON.parse(copyUserMessage(brief, recipe, ctx)), previous_answer: previous, must_fix, instruction: "Return all the candidates again, in the same order, with ONLY the slots in must_fix changed (candidate is the 0-based index), each fixed as its problem says. Every other slot of every candidate is returned exactly as it was." }, null, 2);
  return { model: AI_MODELS.deep, system: PROMPT, user, tool: copyTool(recipe, kOf(ctx)), maxTokens: MAX_TOKENS };
}

/**
 * Every string of every language against the brief and its slot's limit. Taken as written, whole: the company's
 * name, each subject-matter detail a person typed on the opening, and the carrier's own line — a figure inside one
 * of them is allowed only inside that whole phrase (`checkClaims` 0.). Pure.
 */
export function judgeCopy(copy: AdCopy, brief: Pick<AdBrief, "claims" | "subject_matter">, recipe: Pick<AdPresetRecipe, "copy_slots">, ctx: CopyContext = NO_CONTEXT): CopyVerdict {
  const findings: SlotFinding[] = [];
  const limit = new Map(recipe.copy_slots.map((s) => [s.name, s.max_chars]));
  const vouched = [...(ctx.company_name ? [ctx.company_name] : []), ...brief.subject_matter.details, ...(brief.subject_matter.in_our_words ? [brief.subject_matter.in_our_words] : [])];
  const held = { claims: brief.claims, exempt_phrases: vouched };
  for (const language of COPY_LANGUAGES) {
    for (const [slot, text] of Object.entries(copy[language])) {
      const max = limit.get(slot)!;
      if (text.length > max) findings.push({ kind: "too_long", text, index: max, length: text.length, max_chars: max, language, slot });
      for (const f of checkClaims(text, held).findings) findings.push({ ...f, language, slot });
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
  /** The kit's `company_name` (CQ2); null when compose has no kit name to give. */
  company_name?: string | null;
  /** How many copies to offer (CQ4, `settings.budgets.candidates_per_creative`); absent = the default. */
  candidates?: number;
}

export type WriteCopyOutcome =
  /** At least one candidate passed every check: the survivors in the model's order, and how many were offered. */
  | { kind: "ready"; generationId: string; passed: PassedCopy[]; offered: number; replayed: boolean }
  /** No candidate passed: every candidate's findings, by its index. */
  | { kind: "refused"; generationId: string; findings: SlotFinding[]; byCandidate: SetVerdict["refused"]; replayed: boolean }
  | Exclude<ClaudeGenerationOutcome<CopySet>, { kind: "succeeded" }>;

/**
 * The Copywriter's whole turn (CQ4): `k` candidates asked once; every one judged; when some are refused for wording
 * only, ONE fit pass over those (its own key, so a re-run replays it); the survivors returned in the model's order
 * for the craft judge to rank. A candidate refused for an invented figure or promise is dropped, never coaxed. The
 * fit pass is asked even when other candidates already passed: a slot that only ran long is a copy worth having.
 */
export async function writeCopy(deps: ClaudeGenerationDeps, input: WriteCopyInput): Promise<WriteCopyOutcome> {
  const ctx: CopyContext = { company_name: input.company_name ?? null, candidates: input.candidates ?? DEFAULT_CANDIDATES };
  const ids = { orgId: input.orgId, agent: "copywriter" as const, campaignId: input.campaignId, creativeId: input.creativeId, promptVersion: COPYWRITER_PROMPT_VERSION };
  const first = await generateWithClaude(deps, { ...ids, idempotencyKey: `copy:${input.creativeId}:${input.attempt}`, ...buildCopyRequest(input.brief, input.recipe, ctx) });
  if (first.kind !== "succeeded") return first;
  let set = first.value;
  let verdict = judgeSet(set, input.brief, input.recipe, ctx);
  let generationId = first.generationId;
  let replayed = first.replayed;
  const toFix = fittable(verdict);
  if (toFix.length > 0) {
    const fit = await generateWithClaude(deps, { ...ids, idempotencyKey: `copy:${input.creativeId}:${input.attempt}:fit`, ...buildFitRequest(input.brief, input.recipe, ctx, set, toFix) });
    if (fit.kind !== "succeeded") return fit;
    // The fitted set is judged whole again: a "fixed" candidate that now invents a figure is refused like any other.
    set = fit.value;
    verdict = judgeSet(set, input.brief, input.recipe, ctx);
    generationId = fit.generationId;
    replayed = fit.replayed;
  }
  if (verdict.passed.length > 0) return { kind: "ready", generationId, passed: verdict.passed, offered: set.candidates.length, replayed };
  return { kind: "refused", generationId, findings: verdict.refused.flatMap((r) => r.findings), byCandidate: verdict.refused, replayed };
}
