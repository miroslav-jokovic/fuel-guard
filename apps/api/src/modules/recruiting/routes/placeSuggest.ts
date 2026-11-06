import { Router } from "express";
import type { PlaceSuggestion } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { geocodeSuggest } from "../../routing/index.js";

/**
 * Place search for an opening's area (Q-AD44 (a), ruled by the orchestrator 2026-11-06).
 *
 * An opening's area is a POINT (`adAreaSchema`: latitude, longitude, 15–500 miles and a reason), and a
 * recruiter types a yard or a town, not coordinates. The app's only geocoder door was
 * `/api/fueling/geocode-suggest`, gated `dispatch: view` (S7) — a recruiter and a safety manager hold
 * none, so the Openings editor would have had no way to turn "Joliet, IL" into a point. Widening that
 * door (Q-AD44 (b)) would make a fueling route answer a second section; this is recruiting's own door
 * under recruiting's own gate, over the SAME `geocodeSuggest` through routing's index (the
 * `recruiting -> routing` arrow in `check-feature-boundaries.mjs`). One HERE client, one Nominatim
 * fallback, one key kept server-side; the general `/api` limiter is the only rate limit either door has,
 * so the quota is spent on the same path.
 *
 * `view`, not `manage`, for S7's reason: reading a suggestion is not saving an opening. Nothing here
 * touches a table, so there is no org filter to write; `requireOrg` still refuses a caller with no
 * carrier, as the fueling door does.
 */
export function recruitmentPlaceSuggestRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.get(
    "/place-suggest",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req, res) => {
      const suggestions: PlaceSuggestion[] = await geocodeSuggest(getAppLocals(req).env, String(req.query.q ?? ""));
      res.json({ suggestions });
    }),
  );
  return router;
}
