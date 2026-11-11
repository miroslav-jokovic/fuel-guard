import { drawPresets, type PresetCandidate } from "./presetDraw.js";

/**
 * A retired ad's replacement on a live campaign (ADS-CREATIVE-QUALITY-PLAN Q-AD68, ruled 2026-11-11; D-AD23). Pure:
 * which concept enters, how many attempts there may be, and which creatives are replacements. The API's
 * `compose/refreshCampaign.ts` acts on these answers; the review screen reads `isReplacement` to know which ads of a
 * running campaign a person may decide on.
 *
 * ── WHAT ENTERS ──────────────────────────────────────────────────────────────────────────────────
 * D-AD23 said "the next preset in the stored draw". Since CQ1 every drawn preset gets a creative before review, so on
 * a live campaign that preset usually does not exist (five starters, five concepts running). The ruled order:
 *   1. `unrun` — an enabled preset whose key this campaign has never had approved, and that no other launching or
 *      live campaign for the brief runs; several are ordered by a draw seeded with the campaign and the retired
 *      creative, so the choice is reproducible and two retirements do not pick the same order by accident;
 *   2. `fresh` — none left: the retired ad's own preset, at its current version, made again (new copy, new picture).
 *      R6's "refresh every 2–4 weeks" is this; the retired ad is paused, so the two are never shown side by side.
 *
 * ── HOW MANY ─────────────────────────────────────────────────────────────────────────────────────
 * `REFRESH_ATTEMPTS` per retired ad, never more: a replacement that fails its checks or that a person rejects is
 * followed by ONE more, from the next option not yet tried. Each attempt is model and render money; a loop here would
 * spend it every minute.
 */

export const REFRESH_ATTEMPTS = 2;

export interface RefreshOption {
  kind: "unrun" | "fresh";
  key: string;
  version_id: string;
}

export interface RefreshInput {
  /** The campaign and the retired creative: the draw's seed. */
  campaign_id: string;
  retired_creative_id: string;
  /** The org's presets: each preset's CURRENT version, its key, and whether it is enabled. */
  presets: readonly PresetCandidate[];
  /** Keys this campaign has had approved — every concept it ran or runs. */
  approved_keys: readonly string[];
  /** Keys another launching or live campaign for the same brief runs. */
  live_keys_for_brief: readonly string[];
  /** The retired creative's preset key. */
  retired_key: string;
}

/** Every option in the order it is tried: the unrun presets (seeded order), then the retired preset made fresh. */
export function refreshOptions(input: RefreshInput): RefreshOption[] {
  const approved = new Set(input.approved_keys);
  const keyOf = new Map(input.presets.map((p) => [p.version_id, p.key]));
  const draw = drawPresets(`${input.campaign_id}:refresh:${input.retired_creative_id}`, input.presets.filter((p) => !approved.has(p.key)), input.live_keys_for_brief);
  const unrun: RefreshOption[] = draw.order.map((version_id) => ({ kind: "unrun", key: keyOf.get(version_id)!, version_id }));
  const own = input.presets.find((p) => p.key === input.retired_key && p.enabled);
  return own ? [...unrun, { kind: "fresh", key: own.key, version_id: own.version_id }] : unrun;
}

/**
 * The option for the next attempt, or why there is none. `tried` are the preset versions earlier attempts used. A
 * `fresh` option may follow a `fresh` attempt (a second, different execution of the same concept); an `unrun` preset
 * is tried once.
 */
export function nextRefreshOption(options: readonly RefreshOption[], tried: readonly string[]): { ok: true; option: RefreshOption } | { ok: false; why: "attempts_spent" | "nothing_to_enter" } {
  if (tried.length >= REFRESH_ATTEMPTS) return { ok: false, why: "attempts_spent" };
  const used = new Set(tried);
  const option = options.find((o) => o.kind === "fresh" || !used.has(o.version_id));
  return option ? { ok: true, option } : { ok: false, why: "nothing_to_enter" };
}

/**
 * Whether a creative is a retired ad's replacement: it names, in `supersedes_id`, a creative of the same campaign
 * that the monitor retired. Regenerate also uses `supersedes_id`, but only for a creative that ended badly in review
 * (`check_failed`, `rejected`) — never for a retired one, which was approved and ran.
 */
export function isReplacement(
  creative: { supersedes_id: string | null },
  campaignCreatives: ReadonlyArray<{ id: string; platform_status?: string | null }>,
): boolean {
  if (!creative.supersedes_id) return false;
  return campaignCreatives.some((c) => c.id === creative.supersedes_id && c.platform_status === "retired");
}
