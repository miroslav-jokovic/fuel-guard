import { Router } from "express";
import { APP_NAME } from "@silvicom/shared";
import { asyncHandler } from "../lib/http.js";
import { getAppLocals } from "../lib/appLocals.js";
import { getBuildInfo } from "../lib/buildInfo.js";
import { getSchemaStatus } from "../lib/schemaVersion.js";
import { getMaintenanceHealth, maintenanceHealthy } from "../lib/maintenanceHealth.js";
import { getReleaseVersion } from "../lib/releaseVersion.js";
import { getSchedulerHealth, laneHealthy } from "../lib/schedulerHealth.js";
import { getStorageBackupHealth, storageBackupHealthy } from "../modules/org/index.js";
import { getPushHealth, getRealtimeHealth, pushHealthy, realtimeHealthy } from "../modules/messaging/index.js";
import { stepUpReadiness } from "../envAuth.js";

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
 * And whenever the nightly off-provider copy of the org's files is more than a night and a half old
 * (`storageBackup`, modules/org/storageBackupHealth.ts) — Supabase's own backups do not include them.
 * And since CHA4 (0515), whenever Supabase Realtime has stopped delivering: the quarter-hourly probe's
 * broadcast did not reach its subscriber, or the probe itself stopped (`realtime`,
 * modules/messaging/realtimeHealth.ts) — office chat's "instant" falls back to its poll without a word.
 * And since CHAT-WEB-PUSH-PLAN WP4, whenever push services are refusing the server's key pair for more devices than
 * still receive (`webPush`, modules/messaging/pushHealth.ts) — every phone silent, and only a person can fix it.
 * And since Q-AD41 (b) (2026-11-06), whenever "Confirm it's you" cannot work (`stepUp`: "ready", or "missing:" and the
 * setting NAMES from `stepUpMissing` in envAuth.ts). The one piece of configuration this route publishes, and only as
 * names: which settings are absent is not a secret, their values never appear. Staging ran two weeks without one of
 * them, and every admin act behind a fresh sign-in failed while the prompt blamed the password.
 *
 * `GET /api/version/ready` is the same verdict as an HTTP STATUS — 200 when `ok`, 503 when not — for
 * an external uptime monitor that can only read a status code (D-RLY5). `/healthz` cannot be that:
 * Railway's healthcheck reads it, and a 503 there would roll back the very deploy that is waiting on
 * its migration.
 */
export function versionRouter(): Router {
  const router = Router();

  const read = async (env: Parameters<typeof getSchemaStatus>[0] & Parameters<typeof stepUpReadiness>[0]) => {
    const [schema, maintenance, schedulers, storageBackup, realtime, webPush, version] = await Promise.all([
      getSchemaStatus(env),
      getMaintenanceHealth(env),
      getSchedulerHealth(env),
      getStorageBackupHealth(env),
      getRealtimeHealth(env),
      getPushHealth(env),
      getReleaseVersion(),
    ]);
    const stepUp = stepUpReadiness(env);
    const ok =
      !schema.drift &&
      maintenanceHealthy(maintenance.state) &&
      schedulers.every((l) => laneHealthy(l.state)) &&
      storageBackupHealthy(storageBackup.state) &&
      realtimeHealthy(realtime.state) &&
      pushHealthy(webPush.state) &&
      stepUp === "ready";
    return { schema, maintenance, schedulers, storageBackup, realtime, webPush, version, stepUp, ok };
  };

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const build = getBuildInfo();
      const { schema, maintenance, schedulers, storageBackup, realtime, webPush, version, stepUp, ok } = await read(env);
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
        storageBackup,
        realtime,
        webPush,
        stepUp,
        ok,
      });
    }),
  );

  router.get(
    "/ready",
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const { schema, maintenance, schedulers, storageBackup, realtime, webPush, stepUp, ok } = await read(env);
      res.setHeader("Cache-Control", "no-store");
      // The body names what failed, for the person who opens the alert; the status is the verdict.
      res.status(ok ? 200 : 503).json({
        ok,
        commit: getBuildInfo().commitShort,
        schema: schema.state,
        maintenance: maintenance.state,
        schedulers: Object.fromEntries(schedulers.map((l) => [l.lane, l.state])),
        storageBackup: storageBackup.state,
        realtime: realtime.state,
        webPush: webPush.state,
        stepUp,
      });
    }),
  );

  return router;
}
