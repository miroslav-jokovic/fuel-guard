import { fnv1a32 } from "../ai.js";

/**
 * D-AD11: which concept presets a campaign uses, in which order — random, fair and reproducible.
 *
 * Pure: the seed is an argument. The orchestrator makes one (the campaign id is enough — unique, and
 * already stored) and writes the whole result to `ads_campaigns.preset_draw`, so "why this preset?"
 * is answered by re-running this function on the stored inputs, never by trusting a log line.
 *
 * ── FAIR ───────────────────────────────────────────────────────────────────────────────────────────
 * A Fisher–Yates shuffle driven by mulberry32 seeded from the seed's FNV-1a hash: every order of the
 * eligible presets is (to the PRNG's quality) equally likely, so no preset is favoured by its position
 * in a list or its id. The test draws 6,000 fixed seeds and holds each preset's share of first place
 * near uniform. Reweighting toward winners is a recommendation until D-RA10's data exists (plan v4),
 * so there is deliberately no weight parameter here yet.
 *
 * ── NEVER A PRESET ALREADY LIVE FOR THE SAME BRIEF ─────────────────────────────────────────────────
 * Andromeda rewards concept diversity (plan §2b.2): two live campaigns for one opening running the same
 * concept compete with each other. A preset live for this brief is excluded before the shuffle, and a
 * disabled preset is never eligible. When nothing is left the draw says so (`exhausted`) rather than
 * falling back to a repeat.
 */

export interface PresetCandidate {
  /** The preset version id (`ad_concept_preset_versions.id`) — what a creative records. */
  version_id: string;
  /** The stable preset key ("P1" … "P5") — what "already live" is judged by, across versions. */
  key: string;
  enabled: boolean;
}

export interface PresetDraw {
  seed: string;
  /** Eligible version ids, sorted — the draw's input, stored so the order can be re-derived. */
  eligible: string[];
  /** Keys excluded because a campaign for the same brief runs them now. */
  excluded_live: string[];
  /** The order creatives enter, version ids. Empty when `exhausted`. */
  order: string[];
  exhausted: boolean;
}

/** mulberry32: a small, well-mixed 32-bit PRNG. Deterministic for a given state. */
function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawPresets(seed: string, candidates: readonly PresetCandidate[], liveKeysForBrief: readonly string[]): PresetDraw {
  if (seed.length === 0) throw new Error("drawPresets: a seed is required — the draw must be reproducible");
  const live = new Set(liveKeysForBrief);
  const eligible = candidates
    .filter((c) => c.enabled && !live.has(c.key))
    .map((c) => c.version_id)
    .sort();
  const excluded_live = [...new Set(candidates.filter((c) => c.enabled && live.has(c.key)).map((c) => c.key))].sort();
  const order = [...eligible];
  const next = mulberry32(fnv1a32(seed));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return { seed, eligible, excluded_live, order, exhausted: order.length === 0 };
}

/**
 * The next creatives to start: new creatives enter `size` at a time in the drawn order (plan v4),
 * skipping any already started. The orchestrator calls this after each batch reaches review.
 */
export function nextPresetBatch(draw: Pick<PresetDraw, "order">, started: readonly string[], size = 2): string[] {
  if (!Number.isInteger(size) || size < 1) throw new Error("nextPresetBatch: size must be a positive integer");
  const done = new Set(started);
  return draw.order.filter((id) => !done.has(id)).slice(0, size);
}
