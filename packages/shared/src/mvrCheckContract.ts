import { z } from "zod";
import { recordId } from "./recordId.js";
import type { MvrReport } from "./mvrReportContract.js";
import type { MvrFinding } from "./mvrReportFindings.js";

/**
 * The AI check of a driving record on the applicant's drawer (HIRING-WORKFLOW-AUDIT §14, OF6b) — the API's
 * `/applicants/:driverId/mvr-check` and the web's poll read these, so they are written once, here.
 */

/** `POST …/mvr-check` — read the MVR scan just registered and uploaded through the hiring-evidence door. */
export const mvrCheckStartSchema = z.object({ document_id: recordId() });
export type MvrCheckStart = z.infer<typeof mvrCheckStartSchema>;

/** `GET …/mvr-check/:documentId` — still reading, could not read, or what it read and what to check. */
export type MvrCheckState =
  | { status: "reading" }
  | { status: "failed"; reason: string }
  | { status: "done"; report: MvrReport; findings: MvrFinding[] };

/**
 * How long the drawer waits before it says the reader did not answer. A read of a few pages takes well under
 * a minute (TWO-CLICK-READER-PLAN's measurements); a file intake refused (more than ten pages, a password)
 * leaves no read to wait for, so the wait must end on its own and hand the recruiter back the form.
 */
export const MVR_CHECK_WAIT_MS = 180_000;
