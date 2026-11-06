import {
  ADS_CAMPAIGN_WORKERS, ADS_WORKER_LEVELS, launchRefusalSentence,
  type AdsCampaignWorker, type AdsLaunchMissing, type AdsReadinessLevel,
} from "@silvicom/shared";
import { simulatorGate } from "../platforms/simulatorGate.js";

/**
 * Launch refuses a real-platform campaign unless every worker it uses is certified L4 (ADS-AGENT-BUILD-WORKFLOW
 * §4R: "Production launch is refused in code unless the scorecard shows L4 for every worker the campaign uses";
 * G-launch-gate, 2026-11-05).
 *
 * ── WHERE THE ANSWER COMES FROM ────────────────────────────────────────────────────────────────────
 * `launchReadiness.generated.ts`, baked from the readiness registry and `scripts/ads-certifications.json` and
 * checked byte for byte by `lint:ads-readiness`. So the levels are the ones committed at the deployed sha; the
 * server reads no file and runs no command. L4 there means a passing sandbox RUN is on record (date, sha,
 * evidence), never that a test file exists.
 *
 * ── WHICH WORKERS ──────────────────────────────────────────────────────────────────────────────────
 * The registry's `CAMPAIGN_WORKERS`, keyed by the connection's provider and the creative kind. Every creative
 * compose makes today is a still (`compose/`, `creative/higgsfield/` render stills only), so the kind is
 * `still`; the day a video kind exists it becomes a column the campaign carries, and this reads it. A provider
 * or kind with no row is refused: an adapter nobody listed cannot spend.
 *
 * ── THE SIMULATOR ──────────────────────────────────────────────────────────────────────────────────
 * Exempt — it spends nothing and reaches no vendor — but ONLY where `simulatorGate` allows the simulator at all
 * (a positively non-production host). On production, or a built server with no deployment name, a simulator
 * campaign is refused here too, rather than moving to `launching` and failing at the adapter. A Meta SANDBOX
 * connection is NOT exempt: it reaches Meta. L4 is earned by the contract suite run with `ADS_TARGET=sandbox`,
 * not through this door, so the rule is not circular.
 */

export const LAUNCH_LEVEL: AdsReadinessLevel = "L4";
/** The only creative kind compose makes (header). */
export const CAMPAIGN_CREATIVE_KIND = "still";

const RANK: Record<AdsReadinessLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };

/** One part below L4: the shared `AdsLaunchMissing` shape the screen parses (g-tidy; never restated here). */
export type MissingWorker = AdsLaunchMissing[number];

export interface LaunchReadiness {
  workers: Readonly<Record<string, readonly AdsCampaignWorker[]>>;
  levels: Readonly<Record<string, AdsReadinessLevel>>;
}

export const BAKED_READINESS: LaunchReadiness = { workers: ADS_CAMPAIGN_WORKERS, levels: ADS_WORKER_LEVELS };

export type LaunchCertification =
  | { ok: true; exempt: "simulator" | null }
  | { ok: false; refusal: "not_certified"; missing: MissingWorker[]; message: string }
  | { ok: false; refusal: "simulator_not_allowed" | "platform_not_listed"; missing: []; message: string };

export function launchCertification(
  connection: { provider: string },
  readiness: LaunchReadiness = BAKED_READINESS,
  processEnv: NodeJS.ProcessEnv = process.env,
  kind: string = CAMPAIGN_CREATIVE_KIND,
): LaunchCertification {
  if (connection.provider === "simulator") {
    const gate = simulatorGate(processEnv);
    return gate.allowed
      ? { ok: true, exempt: "simulator" }
      : { ok: false, refusal: "simulator_not_allowed", missing: [], message: `A simulator campaign cannot launch on this server: ${gate.reason}.` };
  }
  const key = `${connection.provider}:${kind}`;
  const uses = readiness.workers[key];
  if (!uses || uses.length === 0) {
    return { ok: false, refusal: "platform_not_listed", missing: [], message: `No workers are listed for ${key} campaigns, so none can launch. The readiness registry's CAMPAIGN_WORKERS must name them first.` };
  }
  const missing: MissingWorker[] = [];
  for (const u of uses) {
    const level = readiness.levels[u.platform ? `${u.worker}|${u.platform}` : u.worker] ?? "L0";
    if (RANK[level] < RANK[LAUNCH_LEVEL]) missing.push({ worker: u.worker, platform: u.platform, level, needs: LAUNCH_LEVEL });
  }
  if (missing.length === 0) return { ok: true, exempt: null };
  // The office's words, from the same lines the Launch form lists (g-tidy): `last_error` and the screen agree.
  return { ok: false, refusal: "not_certified", missing, message: launchRefusalSentence(missing) };
}
