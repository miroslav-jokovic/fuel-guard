/**
 * Which deployment this process is (ADS-AGENT-BUILD-WORKFLOW.md §1.2-8). ONE definition: the scheduler
 * lease's holder row and the ads simulator's gate both read it, so the two cannot disagree about where
 * they are.
 *
 * ── WHERE THE NAME COMES FROM (measured 2026-11-02) ─────────────────────────────────────────────────
 *   · Railway sets `RAILWAY_ENVIRONMENT_NAME`: `production` and `uat` (`railway environment list`).
 *   · AWS sets `DEPLOY_ENVIRONMENT` from `infra/server/<env>.env`'s `ENV_NAME`, which `deploy.sh`
 *     restricts to `staging` or `production` (compose.yml passes it to every service).
 *   · A laptop and CI set neither.
 * Railway first, until AWS12 removes Railway — the order `schedulerLease.ts` already used.
 *
 * ⚠ `NODE_ENV` is NOT the environment. Every deployed host runs `NODE_ENV=production`, staging
 * included: `GET /api/version`'s `env` field (which `verify:live` prints) says `production` on staging,
 * and reading that as "this is production" was a wrong call made on 2026-11-02. `NODE_ENV` answers
 * only whether this is a built server or a development process.
 */

export type ProcessEnv = Record<string, string | undefined>;

export function deployEnvironmentName(env: ProcessEnv = process.env): string | null {
  const name = env.RAILWAY_ENVIRONMENT_NAME ?? env.DEPLOY_ENVIRONMENT;
  return name && name.trim() !== "" ? name.trim() : null;
}

/** The deployments we know to be NOT production. A name not on this list is treated as production. */
export const NON_PRODUCTION_ENVIRONMENTS: readonly string[] = ["uat", "staging"];

/**
 * True only where we are POSITIVELY not in production: a named non-production deployment, or no
 * deployment name at all on a process that is not a built server (a laptop, CI, a test). Everything
 * else is false — `production`, a name nobody listed, a typo, and a built server with no name, which
 * is what a production host looks like after someone forgets a variable.
 *
 * Fail-closed by construction: the simulator platform and anything else that must never run against
 * real money or real people asks this, and every unknown answers "no".
 */
export function isPositivelyNonProduction(env: ProcessEnv = process.env): boolean {
  const name = deployEnvironmentName(env);
  if (name !== null) return NON_PRODUCTION_ENVIRONMENTS.includes(name);
  return env.NODE_ENV !== "production";
}
