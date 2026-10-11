import { DOCUMENT_PROFILE_IDS, type DocumentProfileId } from "@silvicom/shared";
import { readDispatcher, runIntake } from "../../modules/document-reading/index.js";
import type { JobHandler } from "../types.js";

/**
 * `document_intake` — render one uploaded file into a source and its pages, then (when asked) queue
 * its read (DOCUMENT-READER-PLAN Step 1.6b). Payload `{ sourceId, sha256, profile, requestedBy }`,
 * written by `POST /api/documents/sources/:id/complete`.
 *
 * IDEMPOTENT (plan Q9): `runIntake` finds its own earlier source row by id, writes page objects with
 * upsert, inserts only missing pages, and reuses a read it already queued. A refusal is a RESULT (the
 * job ends `done` with it in its stats, which `GET /api/documents/sources/:id` reads), never a throw:
 * retrying a file that cannot be read would read nothing five times.
 */
export const documentIntakeHandler: JobHandler = async (ctx, job) => {
  const p = job.payload;
  const sourceId = typeof p.sourceId === "string" ? p.sourceId : "";
  const sha256 = typeof p.sha256 === "string" ? p.sha256 : "";
  if (!sourceId || !sha256) throw new Error("document_intake job has no sourceId or sha256");
  const profile = (DOCUMENT_PROFILE_IDS as readonly string[]).includes(String(p.profile)) ? (p.profile as DocumentProfileId) : null;
  const requestedBy = typeof p.requestedBy === "string" ? p.requestedBy : null;
  const dispatchRead = readDispatcher(ctx.admin, ctx.env, job.org_id, requestedBy);
  return { ...(await runIntake(ctx.admin, job.org_id, { sourceId, sha256, profile, requestedBy }, { dispatchRead })) };
};
