import { Router } from "express";
import { z } from "zod";
import {
  savedViewSaveSchema,
  savedViewTableSchema,
  savedViewNameSchema,
} from "@silvicom/shared";
import { requireAuth, requireOrg } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";

/**
 * Saved views — a name and a query string, per reader per table (D-ROS14, R3c-2).
 *
 * ── NO ROLE GATE, AND THAT IS NOT AN OVERSIGHT ──────────────────────────────────────────────────
 * Every other route in this module asks `requireRole("admin")`, because it changes something about
 * the organisation. This one changes a bookmark belonging to the caller. Gating it on a section
 * would be inventing a capability nobody needs: a recruiter who may read the roster may name a view
 * of it, and a view names nothing they could not already see. What protects the rows is that they
 * are addressed to one user, which the WHERE clauses below and the RLS policy both say.
 *
 * ── EVERY QUERY FILTERS BY BOTH org_id AND user_id ──────────────────────────────────────────────
 * The API reads with the service role, which BYPASSES RLS (root CLAUDE.md). The policy on this table
 * is not a second line of defence for these handlers — it is the defence for PostgREST, and these
 * handlers have to carry their own. `expectOrgScoped` in the test recorder asserts it.
 */
export function savedViewsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.use(requireOrg);

  const listQuerySchema = z.object({ table: savedViewTableSchema });
  const deleteQuerySchema = z.object({ table: savedViewTableSchema, name: savedViewNameSchema });

  // The caller's own views for one table, most recently saved first.
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_table", "Unknown table"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { data, error } = await admin
        .from("saved_views")
        .select("table_id, name, query, updated_at")
        .eq("org_id", req.auth!.orgId!)
        .eq("user_id", req.auth!.userId!)
        .eq("table_id", parsed.data.table)
        .order("updated_at", { ascending: false });

      if (error) {
        res.status(500).json(apiError("db_error", "Could not load your saved views"));
        return;
      }
      res.json({ views: data ?? [] });
    }),
  );

  /**
   * Save, which is also replace.
   *
   * `upsert` with a COMPLETE payload — every not-null column without a default is present. Postgres
   * checks NOT NULL before conflict arbitration, which is why a partial upsert is banned repo-wide
   * (`lint:upserts`); this one carries the whole row, so the conflict path is reached with nothing
   * missing. `created_at` is deliberately absent so that re-saving a view does not reset the day it
   * was first made.
   */
  router.put(
    "/",
    validateBody(savedViewSaveSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as z.infer<typeof savedViewSaveSchema>;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { error } = await admin.from("saved_views").upsert(
        {
          user_id: req.auth!.userId!,
          org_id: req.auth!.orgId!,
          table_id: body.table_id,
          name: body.name,
          query: body.query,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,table_id,name" },
      );

      if (error) {
        res.status(500).json(apiError("db_error", "Could not save the view"));
        return;
      }
      res.status(204).end();
    }),
  );

  // Delete takes the key in the query string: the name is the key, and a name is not a path segment.
  router.delete(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = deleteQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_view", "Unknown view"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { error } = await admin
        .from("saved_views")
        .delete()
        .eq("org_id", req.auth!.orgId!)
        .eq("user_id", req.auth!.userId!)
        .eq("table_id", parsed.data.table)
        .eq("name", parsed.data.name);

      if (error) {
        res.status(500).json(apiError("db_error", "Could not delete the view"));
        return;
      }
      res.status(204).end();
    }),
  );

  return router;
}
