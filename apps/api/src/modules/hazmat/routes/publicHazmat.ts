import { Router, type Request, type Response } from "express";
import {
  hazmatCalcRequestSchema,
  type HazmatCalcRequest,
  hazmatProductsQuerySchema,
  type HazmatProductsResponse,
} from "@silvicom/shared";
import { loadDataset } from "@hazmat/data";
import { searchProducts } from "../hazmatProducts.js";
import { computeCalc } from "../hazmatCalc.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";

/**
 * Public HazmatGuard placard calculator (M7). Unauthenticated + rate-limited (app.ts `calcLimiter`) —
 * a free, indexable marketing/SEO surface over the deterministic engine that answers with CFR citations,
 * no login. Pure + stateless: no org context, no PII, nothing persisted. It exposes ONLY the calculator
 * and the HMT product lookup that feeds its picker; every write/read of real data stays behind auth on
 * `/api/hazmat/*`. Returned placards are SPECIMENS (art provisional until M10) — the web page labels them.
 */
export function publicHazmatRouter(): Router {
  const router = Router();

  router.post(
    "/calc",
    validateBody(hazmatCalcRequestSchema),
    asyncHandler(async (_req: Request, res: Response) => {
      const body = res.locals.body as HazmatCalcRequest;
      const result = computeCalc(body);
      if ("code" in result) {
        res.status(400).json(apiError(result.code, result.message));
        return;
      }
      res.json(result);
    }),
  );

  router.get(
    "/products",
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = hazmatProductsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_query", parsed.error.issues[0]?.message ?? "Invalid query"));
        return;
      }
      const dataset = loadDataset();
      const products = searchProducts(dataset.entries, { q: parsed.data.q, limit: parsed.data.limit });
      const response: HazmatProductsResponse = { datasetVersion: dataset.version, products };
      res.json(response);
    }),
  );

  return router;
}
