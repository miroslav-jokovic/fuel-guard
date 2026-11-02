import { deployEnvironmentName, isPositivelyNonProduction, type ProcessEnv } from "../../../lib/deployEnvironment.js";

/**
 * May this process use the SIMULATOR platform — the adapter backed by FakeMeta that lets the whole ads
 * product run end to end with no platform credential (ADS-AGENT-BUILD-WORKFLOW.md §4R, "Simulator
 * platform")? Only where we are positively not in production (`lib/deployEnvironment.ts`): staging,
 * Railway's `uat`, a laptop, CI. Production, an unknown name and a nameless built server all say no.
 *
 * Why it must fail closed: a simulated campaign that ran in production would show the office ads
 * "live" that nobody sees, spend "recorded" that nobody paid, and leads that do not exist — a wrong
 * picture of the one thing the ads screens exist to show truthfully. The adapter registry (B1) asks
 * this before it hands out the simulator, and refuses with the reason when it says no.
 */
export type SimulatorGate = { allowed: true; environment: string | null } | { allowed: false; environment: string | null; reason: string };

export function simulatorGate(env: ProcessEnv = process.env): SimulatorGate {
  const environment = deployEnvironmentName(env);
  if (isPositivelyNonProduction(env)) return { allowed: true, environment };
  return {
    allowed: false,
    environment,
    reason: environment === null
      ? "a built server with no deployment name is treated as production"
      : `"${environment}" is not a known non-production environment`,
  };
}
