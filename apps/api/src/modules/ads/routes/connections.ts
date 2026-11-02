import type { Request, Response, Router } from "express";
import { adsMetaConnectSchema, isRecordId, type AppSection } from "@silvicom/shared";
import { requireAdminOnly, requireSection } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { SecretBoxError } from "../../../lib/secretBox.js";
import { connectMeta, connectSimulator, disconnect, listConnections, testConnection, type ConnectOutcome, type ConnectionActor, type ConnectionDeps } from "../connections/connections.js";

/**
 * `/api/ads/connections` (B1b; workflow §1.2-10, plan "Company accounts").
 *   read          anyone who can VIEW the brief's section — the same readers as the ads settings
 *   test          `ads.connection` (admin only by name): it reads the stored token and costs Meta calls
 *   connect, connect the simulator, disconnect — `ads.connection` + a fresh sign-in: each hands the
 *                 carrier's ad account to us or takes it back
 * Mounted on `adsRouter` (routes/guard.ts), so `requireAuth` + `requireOrg` are already in force.
 *
 * No response carries a token: the service selects the view's columns by name, and the Connect answer
 * is the stored view and the test report — neither of which holds one.
 */
export function mountConnectionRoutes(router: Router, deps: { section: AppSection; actorOf: (req: Request) => Promise<ConnectionActor> }): void {
  const connection = [requireAdminOnly("ads.connection"), requireFreshAuth()] as const;
  const depsOf = (req: Request): ConnectionDeps => {
    const env = getAppLocals(req).env;
    return { admin: getSupabaseAdmin(env), env, now: () => new Date() };
  };

  router.get(
    "/connections",
    requireSection(deps.section, "view"),
    asyncHandler(async (req, res) => {
      res.json({ connections: await listConnections(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!) });
    }),
  );

  router.post(
    "/connections/meta",
    ...connection,
    asyncHandler(async (req, res) => {
      const parsed = adsMetaConnectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", parsed.error.issues[0]?.message ?? "Invalid connection"));
        return;
      }
      await answer(res, (actor) => connectMeta(depsOf(req), req.auth!.orgId!, actor, parsed.data), deps.actorOf(req));
    }),
  );

  router.post(
    "/connections/simulator",
    ...connection,
    asyncHandler(async (req, res) => {
      await answer(res, (actor) => connectSimulator(depsOf(req), req.auth!.orgId!, actor), deps.actorOf(req));
    }),
  );

  router.post(
    "/connections/:connectionId/test",
    requireAdminOnly("ads.connection"),
    asyncHandler(async (req, res) => {
      const id = String(req.params.connectionId);
      if (!isRecordId(id)) return void res.status(400).json(apiError("bad_request", "Invalid connection"));
      const actor = await deps.actorOf(req);
      const out = await testConnection(depsOf(req), req.auth!.orgId!, actor, id);
      if (out.kind === "not_found") return void res.status(404).json(apiError("not_found", "Connection not found"));
      send(res, out);
    }),
  );

  router.post(
    "/connections/:connectionId/disconnect",
    ...connection,
    asyncHandler(async (req, res) => {
      const id = String(req.params.connectionId);
      if (!isRecordId(id)) return void res.status(400).json(apiError("bad_request", "Invalid connection"));
      const out = await disconnect(depsOf(req), req.auth!.orgId!, await deps.actorOf(req), id);
      if (out.kind === "not_found") return void res.status(404).json(apiError("not_found", "Connection not found"));
      if (out.kind === "refused") return void res.status(409).json(apiError(out.error_code, out.reason));
      res.json({ connection: out.connection });
    }),
  );
}

/** Run a connect, turning an unconfigured sealing key into a clear refusal rather than a 500 with a stack. */
async function answer(res: Response, run: (actor: ConnectionActor) => Promise<ConnectOutcome>, actor: Promise<ConnectionActor>): Promise<void> {
  try {
    send(res, await run(await actor));
  } catch (e) {
    if (e instanceof SecretBoxError && e.code === "not_configured") {
      res.status(503).json(apiError("secrets_not_configured", "This server cannot store a platform token yet (SECRETS_ENCRYPTION_KEY is not set)."));
      return;
    }
    throw e;
  }
}

function send(res: Response, out: ConnectOutcome): void {
  if (out.kind === "token_refused") {
    res.status(422).json({ ...apiError("token_refused", "Meta does not accept this token. Nothing was saved."), report: out.report });
    return;
  }
  if (out.kind === "refused") {
    res.status(409).json(apiError(out.error_code, out.reason));
    return;
  }
  res.json({ connection: out.connection, report: out.report });
}
