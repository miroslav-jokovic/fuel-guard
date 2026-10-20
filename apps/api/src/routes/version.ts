import { Router } from "express";
import { APP_NAME } from "@silvicom/shared";
import { asyncHandler } from "../lib/http.js";
import { getAppLocals } from "../lib/appLocals.js";
import { getBuildInfo } from "../lib/buildInfo.js";
import { getSchemaStatus } from "../lib/schemaVersion.js";
import { getMaintenanceHealth, maintenanceHealthy } from "../lib/maintenanceHealth.js";
import { getReleaseVersion } from "../lib/releaseVersion.js";
import { getSchedulerHealth, laneHealthy } from "../lib/schedulerHealth.js";

/**
 * `GET /api/version` — what is actually running (ship-pipeline plan D0.3).
 *
 * PUBLIC ON PURPOSE. A version endpoint you need a token for is a version endpoint nobody checks,
 * and it is the first thing you want when a driver says the app looks wrong. It publishes only what
 * is already inferable from the outside — a commit SHA, a branch name, a migration number — and
 * nothing tenant-scoped: no counts, no org ids, no configuration. Registered in the auth fitness
 * test's PUBLIC_PREFIXES with that reasoning; it still sits behind the /api rate limiter.
 *
 * `ok` is false whenever the schema drifts from the code, so a monitor can watch one boolean — and,
 * since L6 (0360), whenever the database's own partition maintenance job is not healthy. That job
 * runs inside Postgres where nothing else can see it; `maintenance` says which state it is in, and
 * nothing about it is tenant-scoped (lib/maintenanceHealth.ts). And since D-RLY3, whenever a scheduler
 * lane has had no live holder for two minutes — the background work has stopped (lib/schedulerHealth.ts).
 *
 * `GET /api/version/ready` is the same verdict as an HTTP STATUS — 200 when `ok`, 503 when not — for
 * an external uptime monitor that can only read a status code (D-RLY5). `/healthz` cannot be that:
 * Railway's healthcheck reads it, and a 503 there would roll back the very deploy that is waiting on
 * its migration.
 */
export function versionRouter(): Router {
  const router = Router();

  const read = async (env: Parameters<typeof getSchemaStatus>[0]) => {
    const [schema, maintenance, schedulers, version] = await Promise.all([
      getSchemaStatus(env),
      getMaintenanceHealth(env),
      getSchedulerHealth(env),
      getReleaseVersion(),
    ]);
    const ok = !schema.drift && maintenanceHealthy(maintenance.state) && schedulers.every((l) => laneHealthy(l.state));
    return { schema, maintenance, schedulers, version, ok };
  };

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const build = getBuildInfo();
      const { schema, maintenance, schedulers, version, ok } = await read(env);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        service: `${APP_NAME} API`,
        env: env.NODE_ENV,
        // The release tag (D-REL10), or null off production and in the minutes before release.yml
        // tags what it shipped. Callers show `commitShort` when it is null.
        version,
        commit: build.commit,
        commitShort: build.commitShort,
        branch: build.branch,
        deploymentId: build.deploymentId,
        startedAt: build.startedAt,
        schema,
        maintenance,
        schedulers,
        ok,
      });
    }),
  );

  router.get(
    "/ready",
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const { schema, maintenance, schedulers, ok } = await read(env);
      res.setHeader("Cache-Control", "no-store");
      // The body names what failed, for the person who opens the alert; the status is the verdict.
      res.status(ok ? 200 : 503).json({
        ok,
        commit: getBuildInfo().commitShort,
        schema: schema.state,
        maintenance: maintenance.state,
        schedulers: Object.fromEntries(schedulers.map((l) => [l.lane, l.state])),
      });
    }),
  );

  return router;
}
