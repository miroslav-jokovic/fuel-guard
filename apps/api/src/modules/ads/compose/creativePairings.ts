import {
  finishedAdTotal, publishedFormats, rankPairings,
  type AdBrandKit, type AdFormat, type AdPresetRecipe, type FinishedAdCheck, type FinishedAdScores,
} from "@silvicom/shared";
import type { ClaudeGenerationDeps } from "../generations/claudeGeneration.js";
import type { VisionImage } from "../workers/checker/checker.js";
import { FINISHED_AD_JUDGE_PROMPT_VERSION, judgeOneAd, type JudgeOneAdOutcome } from "../workers/finishedAdJudge/finishedAdJudge.js";
import type { DrawnWords } from "./creativePictures.js";

/**
 * Which picture under which words becomes the ad (ADS-PLATFORM-V2-PLAN V3 "make many, show few"; Q-APX7 (b)).
 * Every picture that passed its checks is paired with every set of words it can carry; the finished-ad judge scores
 * each pairing's ENGLISH ad in the frame the picture was composed for (the first published format); `rankPairings`
 * (shared, pure) orders them, and the first is the ad.
 *
 * ── ONE FRAME FOR THE RANKING, EVERY FRAME FOR THE WINNER ──────────────────────────────────────────
 * A shorter format is the same picture cut down with the same words, so judging nine pairings in two frames would
 * cost over 40 % more for an answer the first frame gave (the plan's table, measured 2026-11-16). The winner alone
 * is then judged in each other format it is shown in, so `checks.finished_ad` says what it always said: the
 * finished ad's scores per published format.
 *
 * ── THE JUDGE NOT RUNNING IS NOT A STOP (Q-AD76) ───────────────────────────────────────────────────
 * A pairing it did not score is unjudged; unjudged pairings rank after the judged ones in the order they were made,
 * and with none judged the first is the first picture under the best-ranked words — the ad a creative was before
 * V3. Two kinds of "did not score", told apart by the judge itself (`standing`): switched off or out of budget, the
 * rest are not asked, because the same switch and the same budget would refuse each of them; one call that failed
 * or answered off its schema leaves that one pairing unjudged and the others are still asked — found by a planted
 * fault, 2026-11-16: until then one unreadable answer left eight pairings unranked.
 *
 * Each call is keyed by creative, picture, words (their place in the WRITER's order, which no ranking moves),
 * format and the picture's attempt, so a re-run asks nobody twice.
 */

export interface PassedPicture {
  picture: number;
  attempt: number;
  drawn: DrawnWords[];
  logo: VisionImage | null;
  subject: string;
}

export interface JudgedPairing {
  picture: number;
  /** The words' index in `candidates.ranked`. */
  words: number;
  judged: FinishedAdScores | null;
  total: number | null;
  /** The English ad in the judged frame, as the judge saw it: what is kept of a pairing that did not win (Q-APX9). */
  png: Buffer;
  from: PassedPicture;
  drawn: DrawnWords;
}

export interface RankInput {
  ids: { orgId: string; campaignId: string; creativeId: string };
  recipe: AdPresetRecipe;
  kit: AdBrandKit;
  pictures: readonly PassedPicture[];
}

export type RankOutcome =
  | { kind: "pending"; why: string }
  | { kind: "ranked"; format: AdFormat; ranked: JudgedPairing[]; /** The judge's prompt version, or null when it scored nothing. */ judge: string | null; finishedAd: FinishedAdCheck };

const english = (d: DrawnWords, format: AdFormat): Buffer => d.images.find((i) => i.format === format && i.language === "en")!.png;

export async function rankPictures(deps: ClaudeGenerationDeps, input: RankInput): Promise<RankOutcome> {
  const { ids, recipe, kit } = input;
  const [format, ...otherFormats] = publishedFormats(recipe.formats) as [AdFormat, ...AdFormat[]];
  const slots = recipe.overlay_slots!;
  const ask = (p: PassedPicture, d: DrawnWords, f: AdFormat) => judgeOneAd(deps, {
    ...ids, attempt: p.attempt, format: f, png: english(d, f), pairing: { picture: p.picture, words: d.words.offeredAs },
    headline: d.words.copy.en[slots.headline]!, button: d.words.copy.en[slots.cta]!, subject: p.subject, kit, logo: p.logo,
  });

  /** Why the judge will not be asked again (a standing refusal), and why the last unscored pairing was not scored. */
  let notRun: string | null = null;
  let lastWhy: string | null = null;
  const pairs: JudgedPairing[] = [];
  for (const from of input.pictures) {
    for (const drawn of from.drawn) {
      const out: JudgeOneAdOutcome | null = notRun === null ? await ask(from, drawn, format) : null;
      if (out?.kind === "pending") return out;
      if (out?.kind === "not_run") { lastWhy = out.why; if (out.standing) notRun = out.why; }
      const judged = out?.kind === "scored" ? out.scores : null;
      pairs.push({ picture: from.picture, words: drawn.words.index, judged, total: judged ? finishedAdTotal(judged) : null, png: english(drawn, format), from, drawn });
    }
  }
  const ranked = rankPairings(pairs);
  const winner = ranked[0]!;
  const anyJudged = pairs.some((p) => p.judged !== null);

  // The winner in every other format it is shown in — only when it was itself judged, and nothing has refused since.
  const byFormat: Record<string, FinishedAdScores> = winner.judged ? { [format]: winner.judged } : {};
  for (const f of winner.judged ? otherFormats : []) {
    if (notRun !== null) break;
    const out: JudgeOneAdOutcome = await ask(winner.from, winner.drawn, f);
    if (out.kind === "pending") return out;
    if (out.kind === "not_run") { if (out.standing) notRun = out.why; } else byFormat[f] = out.scores;
  }
  const finishedAd: FinishedAdCheck = winner.judged
    ? { ran: true, prompt_version: FINISHED_AD_JUDGE_PROMPT_VERSION, by_format: byFormat }
    : { ran: false, prompt_version: FINISHED_AD_JUDGE_PROMPT_VERSION, not_run: notRun ?? lastWhy ?? "not asked" };
  return { kind: "ranked", format, ranked, judge: anyJudged ? FINISHED_AD_JUDGE_PROMPT_VERSION : null, finishedAd };
}
