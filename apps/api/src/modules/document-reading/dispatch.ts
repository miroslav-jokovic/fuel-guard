import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { dispatchJob } from "../../queue/dispatch.js";
import { readDedupKey, type DispatchRead } from "./read/requests.js";

/**
 * The one way a read is put on the queue — the route (`POST /api/documents/reads`) and the intake job
 * (a `complete` that named a profile) both call this, so the dedupe key and the payload are written once.
 * `dispatchJob` runs it on the queue or in-process by `JOB_EXECUTION_MODE`, like every other kind.
 */
export function readDispatcher(admin: SupabaseClient, env: Env, orgId: string, requestedBy: string | null): DispatchRead {
  return (readId) => dispatchJob(admin, env, "document_read", { orgId, payload: { readId }, dedupKey: readDedupKey(readId), requestedBy });
}
