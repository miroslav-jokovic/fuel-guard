/**
 * The page-view count — `POST /api/page-views`, table `surface_page_views` (0435). Product readiness
 * X1, ruled Q-PR4 2026-10-06 (`docs/plans/product-readiness/FEATURE-INVENTORY.md` §5).
 *
 * ── WHAT IS COUNTED, AND WHAT NEVER LEAVES THE BROWSER ──────────────────────────────────────────
 * A view is the KEY of the screen opened, from `SURFACES`, and nothing else. The browser does not send
 * the path (`/drivers/abc` names a person), the query string (`?card=…` can carry a card number), its
 * user id or its role. The API adds the role from the verified token and the day from the org's clock,
 * so the only thing a caller controls is which catalogue keys it reports — and a key the catalogue
 * does not know is dropped server-side (`acceptedPageViewKeys`).
 *
 * ── WHY THE KEY COMES FROM THE DECLARED PATH ───────────────────────────────────────────────────
 * `surfaceForPath` is keyed on the route as DECLARED (`/drivers/:id`), which is what the router's
 * guard already asks with (`to.matched[0].path`). A detail route has its own catalogue entry whose
 * `parent` is the list, so `/fuel-cards/:id` counts as the card detail screen, not as the list. An
 * uncatalogued route (login, the applicant's page) has no key and is not counted.
 */
import { z } from "zod";
import { SURFACES, surfaceForPath } from "./surfaceCatalogue.js";

/** Enough for a long session between flushes; a bigger batch is a client defect, not a busy user. */
export const PAGE_VIEW_BATCH_MAX = 200;

/** Same shape the 0435 CHECK enforces, so the API refuses here what the database would refuse later. */
const surfaceKeySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);

export const pageViewsRecordSchema = z.object({
  keys: z.array(surfaceKeySchema).min(1).max(PAGE_VIEW_BATCH_MAX),
});
export type PageViewsRecordRequest = z.infer<typeof pageViewsRecordSchema>;

/** The catalogue key a declared route path counts as, or null when the route is not a screen. */
export function pageViewKeyFor(declaredPath: string): string | null {
  return surfaceForPath(declaredPath)?.key ?? null;
}

const CATALOGUE_KEYS = new Set(SURFACES.map((s) => s.key));

/**
 * The keys of a batch the catalogue still knows, repeats kept (each one is a view).
 *
 * ⚠ Dropped, not refused, and the asymmetry with the dashboard layout's write path is deliberate. A
 * stored layout is state somebody must later explain; a count is not. A tab left open across a deploy
 * that renamed one screen would otherwise lose every other view in its batch.
 */
export function acceptedPageViewKeys(keys: readonly string[]): string[] {
  return keys.filter((k) => CATALOGUE_KEYS.has(k));
}
