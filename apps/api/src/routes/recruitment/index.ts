import { Router } from "express";
import { recruitmentEmploymentRouter } from "./employment.js";
import { recruitmentAuthorizationsRouter } from "./authorizations.js";
import { recruitmentPspRouter } from "./psp.js";
import { recruitmentHireRouter } from "./hire.js";

/**
 * Everything mounted at `/api/recruitment`, composed in one place.
 *
 * The section grew a router per subject as the 500-line file budget split it — applicants and their
 * employment list, the signed disclosures, the PSP records, and the hire that hands the file to DQF.
 * They stay separate files because they are separate subjects with separate guards; they are
 * composed here so `createApp` mounts a section rather than a list of its parts, which is also what
 * kept that function inside its own budget.
 */
export function recruitmentRouter(): Router {
  const router = Router();
  router.use(recruitmentEmploymentRouter()); // applicant pipeline + §391.21(b)(10)-(11) history
  router.use(recruitmentAuthorizationsRouter()); // the signed disclosures a screening pull needs
  router.use(recruitmentPspRouter()); // PSP records already bought on the portal (P14)
  router.use(recruitmentHireRouter()); // applicant -> driver, and the evidence handoff (H8)
  return router;
}
