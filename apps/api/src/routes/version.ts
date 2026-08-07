import { Router } from "express";
import { APP_NAME } from "@fuelguard/shared";
import { asyncHandler } from "../lib/http.js";
import { getAppLocals } from "../lib/appLocals.js";
import { getBuildInfo } from "../lib/buildInfo.js";
import { getSchemaStatus } from "../lib/schemaVersion.js";

/**
 * `GET /api/version` — what is actually running (ship-pipeline plan D0.3).
 *
 * PUBLIC ON PURPOSE. A version endpoint you need a token for is a version endpoint nobody checks,
 * and it is the first thing you want when a driver says the app looks wrong. It publishes only what
 * is already inferable from the outside — a commit SHA, a branch name, a migration number — and
 * nothing tenant-scoped: no counts, no org ids, no configuration. Registered in the auth fitness
 * test's PUBLIC_PREFIXES with that reasoning; it still sits behind the /api rate limiter.
 *
 * `ok` is false whenever the schema drifts from the code, so a monitor can watch one boolean.
 */
export function versionRouter(): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const build = getBuildInfo();
      const schema = await getSchemaStatus(env);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        service: `${APP_NAME} API`,
        env: env.NODE_ENV,
        commit: build.commit,
        commitShort: build.commitShort,
        branch: build.branch,
        deploymentId: build.deploymentId,
        startedAt: build.startedAt,
        schema,
        ok: !schema.drift,
      });
    }),
  );

  return router;
}
