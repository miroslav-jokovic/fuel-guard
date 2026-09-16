import { Router } from "express";
import {
  DASHBOARD_WIDGETS,
  dashboardLayoutSetSchema,
  type DashboardLayoutSetRequest,
  type StoredDashboardLayout,
} from "@silvicom/shared";
import { requireAuth, requireOrg } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";

/**
 * One person's Dashboard arrangement — `user_dashboard_layout` (0343), D-DW3, LM10.
 *
 * ── NO ROLE GATE, AND NO AUDIT ROW, AND BOTH ARE DELIBERATE ─────────────────────────────────────
 * Every other route in this module asks `requireRole("admin")` and writes an audit row, because
 * every other route changes something about the ORGANISATION — most of them change what somebody may
 * reach. This one changes which of the widgets a caller was ALREADY allowed they would rather look
 * at. It is the `savedViews.ts` shape, not the `surfaceAccess.ts` shape, and the distinction is the
 * one this repo keeps making: a preference is not a permission.
 *
 * The proof that it cannot become one is in `resolveDashboardLayout`, which never sees the
 * catalogue — only the widgets the caller's gates already admitted. A row full of keys naming
 * widgets they may not see renders nothing.
 *
 * ── EVERY QUERY FILTERS BY BOTH org_id AND user_id ──────────────────────────────────────────────
 * The API reads with the service role, which BYPASSES RLS (root CLAUDE.md). 0343's own-row policy
 * defends PostgREST, not these handlers; these carry their own scoping and `expectOrgScoped` in the
 * test recorder asserts it.
 */

const ROW_COLS = "widget_keys, hidden_keys";

/** The keys the catalogue currently answers to. See `rejectUnknownKeys` for why this is checked. */
const CATALOGUE_KEYS = new Set(DASHBOARD_WIDGETS.map((w) => w.key));

/**
 * ⚠ A key the catalogue does not know is REFUSED here, and dropped in silence on the way out.
 *
 * The asymmetry is the point. On the read path a stale key must be inert, because a widget removed
 * from the catalogue would otherwise leave somebody's layout permanently broken. On the write path
 * there is nothing to be tolerant of: the only client is a page that just rendered the catalogue, so
 * a key it does not contain means the request did not come from that page, or came from a tab open
 * across a deploy that removed a widget. Storing it would fill the row with things no reader can
 * explain — 0343 leaves `widget_keys` unconstrained in SQL precisely because this check exists.
 */
function unknownKeys(body: DashboardLayoutSetRequest): string[] {
  return [...body.widgetKeys, ...body.hiddenKeys].filter((k) => !CATALOGUE_KEYS.has(k));
}

export function dashboardLayoutRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.use(requireOrg);

  /**
   * The caller's own layout, or `null` when they have never arranged one.
   *
   * ⚠ `null` is an ANSWER, not an absence, and the client must not turn it into an empty layout —
   * that is D-DW3's whole third state. `maybeSingle()` rather than `single()` so no row is a 200
   * with `null` rather than a PostgREST error the handler would have to decode.
   */
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { data, error } = await admin
        .from("user_dashboard_layout")
        .select(ROW_COLS)
        .eq("org_id", req.auth!.orgId!)
        .eq("user_id", req.auth!.userId!)
        .maybeSingle();

      if (error) {
        res.status(500).json(apiError("db_error", "Could not load your dashboard layout"));
        return;
      }
      const layout: StoredDashboardLayout | null = data
        ? { widgetKeys: data.widget_keys ?? [], hiddenKeys: data.hidden_keys ?? [] }
        : null;
      res.json({ layout });
    }),
  );

  /**
   * Save, which is also replace — a layout has no history worth keeping.
   *
   * `upsert` with a COMPLETE payload: every not-null column without a default is present. Postgres
   * checks NOT NULL before conflict arbitration, which is why a partial upsert is banned repo-wide
   * (`lint:upserts`); this one carries the whole row.
   */
  router.put(
    "/",
    validateBody(dashboardLayoutSetSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as DashboardLayoutSetRequest;
      const unknown = unknownKeys(body);
      if (unknown.length > 0) {
        res.status(400).json(apiError("unknown_widget", `Not a widget: ${unknown.join(", ")}`));
        return;
      }

      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { error } = await admin.from("user_dashboard_layout").upsert(
        {
          org_id: req.auth!.orgId!,
          user_id: req.auth!.userId!,
          widget_keys: body.widgetKeys,
          hidden_keys: body.hiddenKeys,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "org_id,user_id" },
      );

      if (error) {
        res.status(500).json(apiError("db_error", "Could not save your dashboard layout"));
        return;
      }
      res.status(204).end();
    }),
  );

  /**
   * Restore the role default, which is spelled "delete the row" — see D-DW3. Deleting nothing is a
   * success: the caller asked to be back on the default and they are.
   */
  router.delete(
    "/",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { error } = await admin
        .from("user_dashboard_layout")
        .delete()
        .eq("org_id", req.auth!.orgId!)
        .eq("user_id", req.auth!.userId!);

      if (error) {
        res.status(500).json(apiError("db_error", "Could not restore the default layout"));
        return;
      }
      res.status(204).end();
    }),
  );

  return router;
}
