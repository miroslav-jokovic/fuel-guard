import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import { AD_FORMATS, AD_PEOPLE_POLICIES, AD_VISUAL_CHECKS, FINISHED_AD_CRITERIA, adBrandKitSchema, briefFacts, briefFoldSchema, adBriefSchema, adPresetRecipeSchema, judgeArt, type ArtAnswer, type AdVisualCheck } from "@silvicom/shared";
import type { ForcedToolRequest } from "../../../lib/anthropic.js";
import { COPYWRITER_PROMPT_VERSION, buildCopyRequest, buildFitRequest, fittable, judgeSet, type CopySet } from "./copywriter/copywriter.js";
import { CRAFT_JUDGE_PROMPT_VERSION, buildJudgeRequest, judgeAnswer, presentationOrder, type JudgeAnswer } from "./craftJudge/craftJudge.js";
import { rankCandidates } from "@silvicom/shared";
import { ART_DIRECTOR_PROMPT_VERSION, buildArtRequest } from "./artDirector/artDirector.js";
import { ANALYST_PROMPT_VERSION, briefTool, buildBriefRequest, judgeBrief, type BriefAnswer } from "./analyst/analyst.js";
import { FINISHED_AD_JUDGE_PROMPT_VERSION, buildFinishedAdRequest, finishedAdTool, scoreLine, type FinishedAdAnswer } from "./finishedAdJudge/finishedAdJudge.js";
import { CHECKER_PROMPT_VERSION, applicableChecks, buildVisualRequest, judgeVisual, prepareSubject, visualTool, type VisualAnswer, type VisualSubject } from "./checker/checker.js";

/**
 * The model workers' fixtures (workflow C2; §4R "Claude replay + live eval"). One JSON file per case in
 * `workers/<worker>/fixtures/`, read by two things that must agree on what a case is:
 *   · the replay test (CI, every PR): the RECORDED output goes through the worker, through the real rail,
 *     with a client that answers the recording — deterministic and free — and must reach `expect`;
 *   · `pnpm ads:eval <worker>`: asks the real model the same request and judges its answer the same way,
 *     reporting how often the live model is right; `--record` stores its answers as the new recordings.
 * `lint:agent-fixtures` holds the files to this shape without running TypeScript (see that script).
 *
 * ── TWO KINDS OF RECORDING, LABELLED ───────────────────────────────────────────────────────────────
 * `source: "model"` — what the model answered for `input`, recorded by `ads:eval --record` under the
 * prompt version in force; the gate refuses one recorded under an older prompt, so a prompt change is a
 * re-record in the same PR. `source: "planted"` — an answer written by a person to plant a defect (an
 * invented figure, a promise the brief does not make) and prove the judge refuses it. A planted answer
 * is never presented as the model's, and `ads:eval` skips it: it says nothing about the model.
 */

export const recordingSchema = z.object({
  source: z.enum(["model", "planted"]),
  prompt_version: z.string(),
  model: z.string(),
  recorded_at: z.iso.datetime({ offset: true }),
  output: z.unknown(),
});

export const copywriterFixtureSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
  about: z.string().min(10),
  input: z.object({
    brief: adBriefSchema, recipe: adPresetRecipeSchema, company_name: z.string().trim().min(1).max(120).nullable().default(null),
    /** How many copies the fixture asks for (CQ4). A planted answer may hold one. */
    candidates: z.number().int().min(1).max(5).default(3),
  }),
  /** What the worker must answer for the RECORDED output: `ready` = at least one candidate passed every check. */
  expect: z.enum(["ready", "refused", "off_schema"]),
  /** For `refused`: the finding kinds, sorted, exactly. */
  expect_findings: z.array(z.string()).optional(),
  recorded: recordingSchema,
}).strict();
export type CopywriterFixture = z.infer<typeof copywriterFixtureSchema>;

/** What `ads:eval` needs to ask and judge one worker, so it cannot ask differently from the worker. */
export interface EvalWorker<F, T> {
  promptVersion: string;
  dir: URL;
  parse: (raw: unknown) => F;
  name: (f: F) => string;
  source: (f: F) => "model" | "planted";
  /** May be async: the checker cuts its text band out of the image first. */
  request: (f: F) => ForcedToolRequest<T> | Promise<ForcedToolRequest<T>>;
  /** The verdict the worker would reach on `output`, in the fixture's `expect` vocabulary. */
  judge: (f: F, output: unknown) => { verdict: string; findings: string[] };
  /**
   * The worker's one second ask after a refusal of `output`, or null when the worker would stop (the Copywriter's
   * fit pass, CQ2). `ads:eval` asks it too, so the baseline measures the worker's whole behaviour, and records the
   * FINAL answer.
   */
  refine?: (f: F, output: unknown) => ForcedToolRequest<T> | null;
  withRecording: (f: F, recording: z.infer<typeof recordingSchema>) => F;
  /**
   * Whether a live verdict is the RIGHT one. Absent = it must be `ready` (a generator: every brief
   * deserves usable copy). A judge (the checker) is right when it refuses what was planted and passes
   * what was clean, so it supplies its own.
   */
  agrees?: (f: F, verdict: string, findings: string[]) => boolean;
}

export const COPYWRITER_EVAL: EvalWorker<CopywriterFixture, CopySet> = {
  promptVersion: COPYWRITER_PROMPT_VERSION,
  dir: new URL("./copywriter/fixtures/", import.meta.url),
  parse: (raw) => copywriterFixtureSchema.parse(raw),
  name: (f) => f.name,
  source: (f) => f.recorded.source,
  request: (f) => buildCopyRequest(f.input.brief, f.input.recipe, ctxOf(f)),
  // A set is `ready` when at least one candidate passed; `refused` names every kind found across the refused ones.
  judge: (f, output) => {
    const parsed = buildCopyRequest(f.input.brief, f.input.recipe, ctxOf(f)).tool.schema.safeParse(output);
    if (!parsed.success) return { verdict: "off_schema", findings: [] };
    const v = judgeSet(parsed.data, f.input.brief, f.input.recipe, ctxOf(f));
    return v.passed.length > 0 ? { verdict: "ready", findings: [] } : { verdict: "refused", findings: [...new Set(v.refused.flatMap((r) => r.findings.map((x) => x.kind)))].sort() };
  },
  refine: (f, output) => {
    const parsed = buildCopyRequest(f.input.brief, f.input.recipe, ctxOf(f)).tool.schema.safeParse(output);
    if (!parsed.success) return null;
    const toFix = fittable(judgeSet(parsed.data, f.input.brief, f.input.recipe, ctxOf(f)));
    return toFix.length > 0 ? buildFitRequest(f.input.brief, f.input.recipe, ctxOf(f), parsed.data, toFix) : null;
  },
  withRecording: (f, recorded) => ({ ...f, recorded }),
};

const ctxOf = (f: CopywriterFixture) => ({ company_name: f.input.company_name, candidates: f.input.candidates });

/**
 * The craft judge's fixtures (CQ4): a set of candidates that all passed the claim check, one of them PLANTED — written
 * as any carrier's ad, or as the one that names the job — and what a right ranking does with it. `expect` is the
 * planted candidate's index and which end it belongs at. The baseline is the share of fixtures where the live
 * ranking puts it there; the owner's ratings (Q-AD57) are the bar this grows into.
 */
export const craftJudgeFixtureSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
  about: z.string().min(10),
  input: z.object({
    brief: adBriefSchema, recipe: adPresetRecipeSchema, company_name: z.string().trim().min(1).max(120).nullable().default(null),
    candidates: z.array(z.object({ en: z.record(z.string(), z.string()), es: z.record(z.string(), z.string()) })).min(2).max(5),
    /** A fixed seed for the presentation order, so the fixture is the same case every run. */
    seed: z.string().min(1),
  }),
  expect: z.enum(["ready", "off_schema"]),
  /** For `ready`: the planted candidate's index and where a right ranking puts it. */
  expect_rank: z.object({ candidate: z.number().int().min(0), at: z.enum(["first", "last"]) }).optional(),
  recorded: recordingSchema,
}).strict();
export type CraftJudgeFixture = z.infer<typeof craftJudgeFixtureSchema>;

export const CRAFT_JUDGE_EVAL: EvalWorker<CraftJudgeFixture, JudgeAnswer> = {
  promptVersion: CRAFT_JUDGE_PROMPT_VERSION,
  dir: new URL("./craftJudge/fixtures/", import.meta.url),
  parse: (raw) => craftJudgeFixtureSchema.parse(raw),
  name: (f) => f.name,
  source: (f) => f.recorded.source,
  request: (f) => buildJudgeRequest(f.input.brief, f.input.recipe, f.input.candidates, { company_name: f.input.company_name }, presentationOrder(f.input.seed, f.input.candidates.length)),
  // The verdict carries the ranking (candidate indexes, best first) as its "findings", so `agrees` can read it.
  judge: (f, output) => {
    const presented = presentationOrder(f.input.seed, f.input.candidates.length);
    const parsed = buildJudgeRequest(f.input.brief, f.input.recipe, f.input.candidates, { company_name: f.input.company_name }, presented).tool.schema.safeParse(output);
    if (!parsed.success) return { verdict: "off_schema", findings: [] };
    const scores = judgeAnswer(parsed.data, presented);
    const ranked = rankCandidates(f.input.candidates.map((copy, i) => ({ copy, judged: scores[i]!, offered_as: i })));
    return { verdict: "ready", findings: ranked.map((r) => String(r.offered_as)) };
  },
  agrees: (f, verdict, ranking) => {
    if (verdict !== "ready" || !f.expect_rank) return verdict === f.expect;
    const where = f.expect_rank.at === "first" ? ranking[0] : ranking[ranking.length - 1];
    return where === String(f.expect_rank.candidate);
  },
  withRecording: (f, recorded) => ({ ...f, recorded }),
};

export const artDirectorFixtureSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
  about: z.string().min(10),
  input: z.object({
    recipe: adPresetRecipeSchema, kit: adBrandKitSchema, context: z.array(z.string().min(2).max(120)).max(12).default([]),
    /** The headline the overlay will draw (AG3); null = a caller with none. */
    headline: z.string().trim().min(1).max(120).nullable().default(null),
  }),
  expect: z.enum(["ready", "refused", "off_schema"]),
  expect_findings: z.array(z.string()).optional(),
  recorded: recordingSchema,
}).strict();
export type ArtDirectorFixture = z.infer<typeof artDirectorFixtureSchema>;

export const ART_DIRECTOR_EVAL: EvalWorker<ArtDirectorFixture, ArtAnswer> = {
  promptVersion: ART_DIRECTOR_PROMPT_VERSION,
  dir: new URL("./artDirector/fixtures/", import.meta.url),
  parse: (raw) => artDirectorFixtureSchema.parse(raw),
  name: (f) => f.name,
  source: (f) => f.recorded.source,
  request: (f) => buildArtRequest(f.input.recipe, f.input.kit, f.input.context, f.input.headline),
  judge: (f, output) => {
    const parsed = buildArtRequest(f.input.recipe, f.input.kit).tool.schema.safeParse(output);
    if (!parsed.success) return { verdict: "off_schema", findings: [] };
    const found = judgeArt(parsed.data, f.input.recipe, f.input.kit);
    return found.length === 0 ? { verdict: "ready", findings: [] } : { verdict: "refused", findings: [...new Set(found.map((x) => x.kind))].sort() };
  },
  withRecording: (f, recorded) => ({ ...f, recorded }),
};

/**
 * The checker's cases are IMAGES (§4R's planted-defect corpus): `fixtures/images/*.jpg`, generated with the
 * developer's Higgsfield login on 2026-11-04 (gpt_image_2_5, medium, 1k; downscaled to 768 px, JPEG q72),
 * each made to carry at most one defect, which `truth` names. `truth` is what the image IS; `expect` is
 * what the recorded answer reached — they differ exactly where the model was wrong, and `ads:eval`
 * counts the cases where they agree.
 */
const fraction = z.number().min(0).max(1);
export const checkerFixtureSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
  about: z.string().min(10),
  input: z.object({
    image: z.string().regex(/^[a-z0-9-]+\.jpg$/),
    reference: z.object({ image: z.string().regex(/^[a-z0-9-]+\.jpg$/), label: z.string().min(2) }).nullable(),
    scene: z.object({ shows_equipment: z.boolean(), shows_people: z.boolean() }).strict(),
    kit: z.object({ people_policy: z.enum(AD_PEOPLE_POLICIES), forbidden_marks: z.array(z.string()) }).strict(),
    text_band: z.object({ x: fraction, y: fraction, width: fraction, height: fraction }).strict(),
  }).strict(),
  truth: z.object({ planted: z.enum(AD_VISUAL_CHECKS).nullable(), how: z.string().min(10) }).strict(),
  expect: z.enum(["ready", "refused", "off_schema"]),
  expect_findings: z.array(z.string()).optional(),
  recorded: recordingSchema,
}).strict();
export type CheckerFixture = z.infer<typeof checkerFixtureSchema>;

const CHECKER_DIR = new URL("./checker/fixtures/", import.meta.url);
/** The fixture's images, read from the corpus. */
export function checkerSubject(f: CheckerFixture): VisualSubject {
  const read = (file: string) => ({ format: "jpeg" as const, bytes: new Uint8Array(readFileSync(new URL(`images/${file}`, CHECKER_DIR))) });
  const { image, reference, ...rest } = f.input;
  return { ...rest, image: read(image), reference: reference ? { label: reference.label, image: read(reference.image) } : null };
}

export const CHECKER_EVAL: EvalWorker<CheckerFixture, VisualAnswer> = {
  promptVersion: CHECKER_PROMPT_VERSION,
  dir: CHECKER_DIR,
  parse: (raw) => checkerFixtureSchema.parse(raw),
  name: (f) => f.name,
  source: (f) => f.recorded.source,
  request: async (f) => buildVisualRequest(await prepareSubject(checkerSubject(f))),
  judge: (f, output) => {
    const parsed = visualTool(applicableChecks(f.input.scene)).schema.safeParse(output);
    if (!parsed.success) return { verdict: "off_schema", findings: [] };
    const v = judgeVisual(parsed.data, f.input.scene);
    return v.ok ? { verdict: "ready", findings: [] } : { verdict: "refused", findings: v.results.filter((r) => r.verdict === "fail").map((r) => r.check).sort() };
  },
  withRecording: (f, recorded) => ({ ...f, recorded }),
  agrees: (f, verdict, findings) => (f.truth.planted === null ? verdict === "ready" : verdict === "refused" && findings.includes(f.truth.planted as AdVisualCheck)),
};

/**
 * The analyst's cases are FOLDS (F1): what `adsReport.ts` produced for a day, named. A planted answer is a
 * narration a person wrote with one figure the fold did not produce; a model answer is the live model's
 * brief over the same fold, and it agrees only when it states nothing but the sheet (`ready`).
 */
export const analystFixtureSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
  about: z.string().min(10),
  input: z.object({ fold: briefFoldSchema }).strict(),
  expect: z.enum(["ready", "refused", "off_schema"]),
  expect_findings: z.array(z.string()).optional(),
  recorded: recordingSchema,
}).strict();
export type AnalystFixture = z.infer<typeof analystFixtureSchema>;

export const ANALYST_EVAL: EvalWorker<AnalystFixture, BriefAnswer> = {
  promptVersion: ANALYST_PROMPT_VERSION,
  dir: new URL("./analyst/fixtures/", import.meta.url),
  parse: (raw) => analystFixtureSchema.parse(raw),
  name: (f) => f.name,
  source: (f) => f.recorded.source,
  request: (f) => buildBriefRequest(f.input.fold),
  judge: (f, output) => {
    const parsed = briefTool.schema.safeParse(output);
    if (!parsed.success) return { verdict: "off_schema", findings: [] };
    const found = judgeBrief(parsed.data, briefFacts(f.input.fold));
    return found.length === 0 ? { verdict: "ready", findings: [] } : { verdict: "refused", findings: [...new Set(found.map((x) => x.kind))].sort() };
  },
  withRecording: (f, recorded) => ({ ...f, recorded }),
};

/**
 * The finished-ad judge's cases (P1-7) are FINISHED ADS: `fixtures/images/*.jpg`, drawn 2026-11-10 by our own
 * overlay over the checker's corpus photos (one, `weak-hierarchy`, by hand: our overlay cannot plant that defect),
 * each with at most one weakness, which `truth.weak` names. `clean-*` and `weak-*` are the OLD overlay (the flat
 * plate); `rail-*` and `ribbon-*` are the same photos, words and kit redrawn 2026-11-11 in the two looks
 * (ADS-AD-LOOK-PLAN D-ADL12, D-ADL13), so one recording scores the look before and after. A judge with no floor (Q-AD76) has no verdict to
 * agree on, so agreement is about the SCORES: a sound ad scores 3 or more everywhere; a planted weakness scores 2 or
 * less on its criterion, and no criterion lower. The owner's approve/reject on 30 real ads is the bar this grows into.
 */
export const finishedAdJudgeFixtureSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
  about: z.string().min(10),
  input: z.object({
    image: z.string().regex(/^[a-z0-9-]+\.jpg$/),
    format: z.enum(AD_FORMATS),
    headline: z.string().min(1).max(120),
    button: z.string().min(1).max(60),
    subject: z.string().nullable(),
    kit: z.object({ company_name: z.string().min(1).max(120), colors: z.array(z.object({ name: z.string().min(1), hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/) })).min(1) }).strict(),
  }).strict(),
  truth: z.object({ weak: z.enum(FINISHED_AD_CRITERIA).nullable(), how: z.string().min(10) }).strict(),
  expect: z.enum(["ready", "off_schema"]),
  recorded: recordingSchema,
}).strict();
export type FinishedAdJudgeFixture = z.infer<typeof finishedAdJudgeFixtureSchema>;

const FINISHED_DIR = new URL("./finishedAdJudge/fixtures/", import.meta.url);
const finishedRequest = (f: FinishedAdJudgeFixture) => buildFinishedAdRequest({
  image: { format: "jpeg", bytes: new Uint8Array(readFileSync(new URL(`images/${f.input.image}`, FINISHED_DIR))) },
  headline: f.input.headline, button: f.input.button, subject: f.input.subject, kit: f.input.kit, logo: null,
});

export const FINISHED_AD_JUDGE_EVAL: EvalWorker<FinishedAdJudgeFixture, FinishedAdAnswer> = {
  promptVersion: FINISHED_AD_JUDGE_PROMPT_VERSION,
  dir: FINISHED_DIR,
  parse: (raw) => finishedAdJudgeFixtureSchema.parse(raw),
  name: (f) => f.name,
  source: (f) => f.recorded.source,
  request: finishedRequest,
  // The verdict carries the scores ("criterion:score", criteria order) as its "findings", so `agrees` can read them.
  judge: (_f, output) => {
    const parsed = finishedAdTool.schema.safeParse(output);
    return parsed.success ? { verdict: "ready", findings: scoreLine(parsed.data.scores) } : { verdict: "off_schema", findings: [] };
  },
  agrees: (f, verdict, line) => {
    if (verdict !== "ready") return verdict === f.expect;
    const score = Object.fromEntries(line.map((x) => [x.split(":")[0]!, Number(x.split(":")[1])]));
    if (f.truth.weak === null) return FINISHED_AD_CRITERIA.every((c) => score[c]! >= 3);
    const weak = score[f.truth.weak]!;
    return weak <= 2 && FINISHED_AD_CRITERIA.every((c) => score[c]! >= weak);
  },
  withRecording: (f, recorded) => ({ ...f, recorded }),
};

export const EVAL_WORKERS = { copywriter: COPYWRITER_EVAL, artDirector: ART_DIRECTOR_EVAL, checker: CHECKER_EVAL, analyst: ANALYST_EVAL, craftJudge: CRAFT_JUDGE_EVAL, finishedAdJudge: FINISHED_AD_JUDGE_EVAL } as const;

/** Every fixture of a worker, parsed, in file-name order; a file whose `name` is not its file name throws. */
export function loadFixtures<F, T>(w: EvalWorker<F, T>): Array<{ file: URL; fixture: F }> {
  return readdirSync(w.dir).filter((n) => n.endsWith(".json")).sort().map((n) => {
    const file = new URL(n, w.dir);
    const fixture = w.parse(JSON.parse(readFileSync(file, "utf8")));
    if (`${w.name(fixture)}.json` !== n) throw new Error(`${n}: its name is "${w.name(fixture)}"`);
    return { file, fixture };
  });
}
