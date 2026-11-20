import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SMS_APPLY_PAGE_CONSENT,
  applyAnswersProblem,
  applyQuestions,
  applySubmitSchema,
  composeSmsConsent,
  openingFormQuestions,
  type ApplyJobView,
  type CareersListView,
} from "@silvicom/shared";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { carrierName } from "../applicationMail.js";
import type { ConfiguredRecipients } from "../leads/leadNotify.js";
import { careersPageUrl } from "../careers/careersPage.js";
import { issueFormToken, turnstileKeys, type FetchLike } from "../careers/applyChecks.js";
import { findCareersPage, openingRequirements, publishedOpening, publishedOpenings } from "../careers/publicCareers.js";
import { submitApplication } from "../careers/applySubmit.js";

/**
 * `/api/public/careers` (APPLY-PAGE-PLAN AP2) — the public careers page's three doors. Public by design, like the
 * applicant's link: nobody here has an account. Under `/api/public`'s 60-a-minute-per-address limiter and the general
 * `/api` ceiling, which are the only refusals besides a body that does not parse (D-AP5).
 *
 *  · `GET  /:handle` — the carrier's published openings.
 *  · `GET  /:handle/jobs/:openingId` — one opening, its questions, the texting box's words, and a fresh form token.
 *  · `POST /:handle/jobs/:openingId/apply` — the application. 201 when it is a new lead, 200 when it is the same
 *    form sent again. The answer never says whether a check flagged it: that would teach a bot what to fix.
 *
 * A handle whose page is off, an opening that is not published, and another carrier's opening all answer the same
 * 404, so the surface says nothing about what exists behind it.
 */

export interface PublicCareersDeps {
  /** Who hears a new lead — an ads setting, crossing in at the composition root as it does for Meta's and Tenstreet's. */
  recipientsFor: (admin: SupabaseClient) => ConfiguredRecipients;
  fetchImpl?: FetchLike;
}

/** `apiError`'s shape plus the field the page puts the sentence under. */
const fieldError = (message: string, field: string) => ({ error: { ...apiError("bad_request", message).error, field } });

const notFound = (res: import("express").Response) =>
  res.status(404).json(apiError("not_found", "This careers page or job is not available."));

export function publicCareersRouter(deps: PublicCareersDeps): Router {
  const router = Router();

  router.get(
    "/:handle",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const page = await findCareersPage(admin, String(req.params.handle ?? ""));
      if (!page) return void notFound(res);
      const [carrier, openings] = await Promise.all([carrierName(admin, page.orgId), publishedOpenings(admin, page.orgId)]);
      const view: CareersListView = {
        carrier,
        handle: page.handle,
        accommodation: page.accommodation,
        openings: openings.map((o) => ({ id: o.id, title: o.title, pay: o.facts.pay, areaLabel: o.areaLabel, equipment: o.facts.equipment, schedule: o.facts.schedule })),
      };
      res.set("Cache-Control", "no-store");
      res.json(view);
    }),
  );

  router.get(
    "/:handle/jobs/:openingId",
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const page = await findCareersPage(admin, String(req.params.handle ?? ""));
      const opening = page && (await publishedOpening(admin, page.orgId, String(req.params.openingId ?? "")));
      if (!page || !opening) return void notFound(res);
      const [carrier, req2] = await Promise.all([carrierName(admin, page.orgId), openingRequirements(admin, page.orgId, opening.profileVersionId)]);
      const consent = composeSmsConsent(SMS_APPLY_PAGE_CONSENT, carrier);
      const view: ApplyJobView = {
        carrier,
        handle: page.handle,
        opening: { id: opening.id, title: opening.title, facts: opening.facts, areaLabel: opening.areaLabel },
        requirements: { minAge: req2.min_age.years, minClassAYears: req2.min_class_a_years.years, hazmat: req2.hazmat.mode },
        questions: applyQuestions(openingFormQuestions(req2)),
        consent: { version: consent.version, title: consent.title, body: consent.body },
        accommodation: page.accommodation,
        formToken: issueFormToken(env, page.orgId, opening.id, new Date()),
        turnstileSiteKey: turnstileKeys(env)?.siteKey ?? null,
      };
      // The token is this request's own; a shared cache handing it to the next visitor would merge two people.
      res.set("Cache-Control", "no-store");
      res.json(view);
    }),
  );

  router.post(
    "/:handle/jobs/:openingId/apply",
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const page = await findCareersPage(admin, String(req.params.handle ?? ""));
      const opening = page && (await publishedOpening(admin, page.orgId, String(req.params.openingId ?? "")));
      if (!page || !opening) return void notFound(res);
      const parsed = applySubmitSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        res.status(400).json(fieldError(issue?.message ?? "Check the form.", String(issue?.path[0] ?? "")));
        return;
      }
      const requirements = await openingRequirements(admin, page.orgId, opening.profileVersionId);
      const problem = applyAnswersProblem(applyQuestions(openingFormQuestions(requirements)), parsed.data.answers);
      if (problem) {
        res.status(400).json(fieldError(problem, "answers"));
        return;
      }
      const now = new Date();
      const result = await submitApplication(
        {
          admin, env, now,
          configured: deps.recipientsFor(admin),
          carrier: await carrierName(admin, page.orgId),
          client: { ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null },
          pageUrl: `${careersPageUrl(env, page.handle)}/jobs/${opening.id}`,
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        },
        page, opening, parsed.data,
      );
      res.set("Cache-Control", "no-store");
      res.status(result.stored === "new" ? 201 : 200).json({ ok: true });
    }),
  );

  return router;
}
