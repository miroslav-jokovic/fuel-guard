import { z } from "zod";
import { ADS_CAMPAIGN_WORKERS, ADS_WORKER_LEVELS } from "./launchReadiness.generated.js";

/**
 * The launch gate's refusal (G-launch-gate, #2078) as the campaign screen shows it (E3b-2).
 *
 * `POST /api/ads/campaigns/:id/launch` answers a real-platform campaign whose workers are not all certified with
 * 409 `not_certified` and a `missing` list (`apps/api/src/modules/ads/campaigns/launchCertification.ts`
 * `MissingWorker`: worker, platform, level, needs). The door's own sentence names each worker by its registry name
 * and level ("Renderer / Higgsfield client at L3"), which is the engineers' scorecard. A person deciding whether to
 * launch needs the same list in the office's words, so this file words it: the list itself is the door's, never
 * re-derived here.
 */
export const adsLaunchMissingSchema = z.array(z.object({
  worker: z.string(),
  platform: z.string().nullable(),
  level: z.string(),
  needs: z.string(),
}));
export type AdsLaunchMissing = z.infer<typeof adsLaunchMissingSchema>;

/**
 * Every worker the readiness registry names, in office words: what that part of the agent does for the carrier.
 * Keyed by the registry's own names; a test holds this to `ADS_WORKER_LEVELS` and `ADS_CAMPAIGN_WORKERS`, so a
 * worker added there without words here fails CI rather than reaching a person as its registry name.
 */
export const AD_WORKER_OFFICE_LABEL: Readonly<Record<string, string>> = {
  "Orchestrator": "Running the campaign's steps in order",
  "Budget guard": "Holding spend to the limits you set",
  "Publisher (per adapter)": "Putting the ads on the platform",
  "Monitor": "Watching spend and results every hour",
  "Lead intake": "Receiving the people who apply",
  "Copywriter": "Writing the ad text",
  "Art director": "Choosing what each picture shows",
  "Checker": "Checking each ad before anyone sees it",
  "Renderer / Higgsfield client": "Making the pictures",
  "Security (all)": "Keeping logins and data safe",
  "Analyst": "The morning report",
  "Outcome feed": "Telling the platform which applicants were hired",
};

const PLATFORM_LABEL: Readonly<Record<string, string>> = { meta: "Meta (Facebook, Instagram)", tiktok: "TikTok", x: "X", simulator: "the simulator" };

/** Every worker name the registry knows: the keys of its levels, `worker|platform` folded to the worker. */
export const adsRegistryWorkers = (): string[] => [...new Set([
  ...Object.keys(ADS_WORKER_LEVELS).map((k) => k.split("|")[0]!),
  ...Object.values(ADS_CAMPAIGN_WORKERS).flatMap((ws) => ws.map((w) => w.worker)),
])];

/** One line per missing part: what it does, and on which platform it still needs its test run. */
export function launchMissingLines(missing: AdsLaunchMissing): string[] {
  return missing.map((m) => {
    const what = AD_WORKER_OFFICE_LABEL[m.worker] ?? m.worker;
    return m.platform ? `${what}, on ${PLATFORM_LABEL[m.platform] ?? m.platform}` : what;
  });
}

/**
 * The refusal as ONE sentence, for the campaign's `last_error` (g-tidy, Track G, 2026-11-06). Built from
 * `launchMissingLines`, the lines the Launch form lists, so the stored error and the screen say the same office words
 * from one source. Before, the door wrote its own sentence in registry names and levels ("Renderer / Higgsfield
 * client at L3"), and the campaign drawer showed that to the person deciding whether to spend.
 */
export function launchRefusalSentence(missing: AdsLaunchMissing): string {
  return `Not launched. These parts of the ads agent have not passed a test run against the real platform yet: ${launchMissingLines(missing).join("; ")}. Nothing was spent.`;
}
