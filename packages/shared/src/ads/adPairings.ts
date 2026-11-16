import { z } from "zod";
import { AD_CAMERA_DISTANCES, AD_FOCAL_SUBJECTS } from "./artDirection.js";
import { FINISHED_AD_CRITERIA, finishedAdScoresSchema, type FinishedAdScores } from "./finishedAd.js";
import { AD_FORMATS } from "./renderGeometry.js";

/**
 * The pictures and words one ad was chosen from (ADS-PLATFORM-V2-PLAN V3 "make many, show few"; Q-APX7, Q-APX9;
 * column 0619 `ads_creatives.pairings`). A creative now makes several pictures; each is paired with the words that
 * fit the image (`candidates.ranked`, D-AD26); the finished-ad judge scores every pairing in the frame the picture
 * was composed for; the best becomes the ad and the rest stay beside it, so a reviewer can see what the winner was
 * chosen over and pick another.
 *
 * ── A RANKING, NEVER A GATE (Q-AD76 stands) ────────────────────────────────────────────────────────
 * The judge's scores choose what a person sees FIRST. They refuse nothing: a pairing that scored low is still
 * listed, and a judge that did not run (switched off, out of budget, an answer off its schema) leaves the pairings
 * unjudged and in the order they were made — first picture, best-ranked words — which is the ad every creative was
 * before V3.
 *
 * ── WHY ONE POINT IS NOT A DIFFERENCE (measured 2026-11-16; Q-APX7) ────────────────────────────────
 * The same finished ad asked four times (16 ads, 64 calls) never moved its total by more than ONE point of 20:
 * eight ads moved by one, eight did not move. Sound ads sat between 16 and 18.25, ads with a planted weakness
 * between 10 and 15. So a two-point gap between two sound ads was never chance, and a one-point gap is the judge's
 * own movement. `PAIRING_TIE_MARGIN` is that measurement: every pairing within it of the best total is "as good",
 * and among those the craft judge's rank of the WORDS decides, then the order the pictures were made in. A reviewer
 * is never shown a one-point gap as "better".
 */
export const PAIRING_TIE_MARGIN = 1;

export const FINISHED_AD_MAX_TOTAL = FINISHED_AD_CRITERIA.length * 5;
export const finishedAdTotal = (s: FinishedAdScores): number => FINISHED_AD_CRITERIA.reduce((n, c) => n + s[c].score, 0);

/**
 * What a ledger key gains for a creative's later pictures: nothing for the first, so every key written before V3
 * (`art:<creative>:<attempt>`, `render:…`, `visual:…`) still names its row and a creative already composing replays
 * it; `p2:`, `p3:` … for the others. One definition for the art, the render and the visual check.
 */
export const pictureKeyPart = (picture: number): string => (picture <= 1 ? "" : `p${picture}:`);

/** The most pictures one creative makes (`budgets.pictures_per_creative`); `ads_copy_choices.picture` holds the same bound (0619). */
export const MAX_PICTURES_PER_CREATIVE = 5;
const pictureNumber = z.number().int().min(1).max(MAX_PICTURES_PER_CREATIVE);

/** One picture the workers made for the creative, whether or not it reached a pairing. */
export const adPictureSchema = z.object({
  /** 1 = the first made; the number its ledger rows are keyed by. */
  picture: pictureNumber,
  /** The visual attempt that produced it (1 = the first try; a regeneration after a failed check is the next). */
  attempt: z.number().int().min(1).max(6),
  /** The kit photo it started from; null for a text-only scene, and for a picture whose direction never came. */
  reference: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  /** What it was directed to be of and how near; null when its direction never came (refused, or the agent off). */
  focal_subject: z.enum(AD_FOCAL_SUBJECTS).nullable(),
  camera_distance: z.enum(AD_CAMERA_DISTANCES).nullable(),
  /** Null when it passed its checks; otherwise why no pairing uses it, in compose's own words. */
  dropped: z.string().min(1).max(300).nullable(),
  /**
   * The words the overlay could not draw on THIS picture (contrast is the picture's), by their index in
   * `candidates.ranked`, with the overlay's own word. Absent when it carries every set of words offered to it.
   */
  undrawable: z.array(z.object({ words: z.number().int().min(0).max(4), reason: z.string().min(1).max(300) }).strict()).max(5).optional(),
}).strict();
export type AdPicture = z.infer<typeof adPictureSchema>;

/** The one image kept of a pairing: the English ad in the judged frame, as the judge saw it (Q-APX9). */
export const adPairingPreviewSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/), path: z.string().min(1).max(300),
  width: z.number().int().positive(), height: z.number().int().positive(),
}).strict();

export const adPairingSchema = z.object({
  picture: pictureNumber,
  /** The words, by their index in `candidates.ranked` (0 = the craft judge's first). */
  words: z.number().int().min(0).max(4),
  /** The judge's four scores with their reasons, or null when it did not score this pairing. */
  judged: finishedAdScoresSchema.nullable(),
  /** The four scores added, or null unjudged; kept so a reader needs no arithmetic. */
  total: z.number().int().min(FINISHED_AD_CRITERIA.length).max(FINISHED_AD_MAX_TOTAL).nullable(),
  preview: adPairingPreviewSchema.nullable(),
}).strict();
export type AdPairing = z.infer<typeof adPairingSchema>;

/** `ads_creatives.pairings` (0619): the pictures made, the pairings ranked, which became the ad, and who ranked them. */
export const adPairingsSchema = z.object({
  /** The frame every pairing was judged in: the first published format, the one the picture was composed for. */
  format: z.enum(AD_FORMATS),
  pictures: z.array(adPictureSchema).min(1).max(MAX_PICTURES_PER_CREATIVE),
  ranked: z.array(adPairingSchema).min(1).max(MAX_PICTURES_PER_CREATIVE * 5),
  /** The index in `ranked` of the pairing that became the ad: 0, the ranking's first. */
  chosen: z.number().int().min(0),
  /** The finished-ad judge's prompt version, or null when nothing was judged. */
  judge: z.string().nullable(),
}).strict()
  .refine((p) => p.chosen < p.ranked.length, "chosen names a pairing that is not in the list")
  .refine((p) => p.ranked.every((r) => p.pictures.some((x) => x.picture === r.picture && x.dropped === null)), "a pairing names a picture that was not made, or one that was dropped")
  .refine((p) => new Set(p.ranked.map((r) => `${r.picture}:${r.words}`)).size === p.ranked.length, "a pairing is listed twice");
export type AdPairings = z.infer<typeof adPairingsSchema>;

export interface PairingToRank { picture: number; words: number; total: number | null }

/** Words first, then the order the pictures were made in: the order of every tie, and of everything unjudged. */
const made = (a: PairingToRank, b: PairingToRank): number => a.words - b.words || a.picture - b.picture;

/**
 * The pairings in the order a person sees them. Pure and total-ordered.
 *   1. Every judged pairing within `PAIRING_TIE_MARGIN` of the best total — "as good as the best" — by the craft
 *      judge's rank of its words, then by picture.
 *   2. The other judged pairings by total, high first; ties as above.
 *   3. The pairings the judge did not score, as above.
 * With nothing judged the first is the first picture under the best-ranked words: the ad made before V3.
 */
export function rankPairings<P extends PairingToRank>(pairs: readonly P[]): P[] {
  const judged = pairs.filter((p) => p.total !== null);
  const best = judged.length > 0 ? Math.max(...judged.map((p) => p.total!)) : null;
  const band = (p: P): number => (p.total === null ? 2 : p.total >= best! - PAIRING_TIE_MARGIN ? 0 : 1);
  return [...pairs].sort((a, b) => band(a) - band(b) || (band(a) === 1 ? b.total! - a.total! : 0) || made(a, b));
}

/**
 * How many pairings at the head of a RANKED list are "as good as the best": judged, and within the margin of the
 * HIGHEST total — which is not always the first's, since inside the margin the words decide the order. 0 when
 * nothing was judged — an unjudged order is nobody's opinion and is not shown as one.
 */
export function asGoodCount(ranked: ReadonlyArray<Pick<PairingToRank, "total">>): number {
  const totals = ranked.flatMap((p) => (p.total === null ? [] : [p.total]));
  if (totals.length === 0) return 0;
  const best = Math.max(...totals);
  const end = ranked.findIndex((p) => p.total === null || p.total < best - PAIRING_TIE_MARGIN);
  return end < 0 ? ranked.length : end;
}
