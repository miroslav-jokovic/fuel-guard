import { randomBytes } from "node:crypto";
import type { Env } from "../../../../../env.js";
import { testEnv } from "../../../../../testing/testEnv.js";
import { seal, secretAad } from "../../../../../lib/secretBox.js";
import { metaPageTokenPurpose, metaTokenPurpose } from "../../registry.js";
import type { MetaTarget } from "./metaTarget.js";

/**
 * The target as one carrier's Meta connection row (stage2-kit-2c): the target's tokens SEALED, the way Connect
 * stores them, so the monitor and lead intake open them through `registry.ts` exactly as they do in production,
 * and `metaGraphBase` points that client at the target's fault proxy. A sandbox connection, as on staging.
 */
export function targetConnection(t: MetaTarget, env: Env, ids: { org: string; connection: string }) {
  return {
    id: ids.connection, org_id: ids.org, provider: "meta", is_sandbox: true, status: "connected", last_error: null,
    token_sealed: seal(env, t.token(), secretAad(ids.org, metaTokenPurpose(true))),
    page_token_sealed: seal(env, t.pageToken(), secretAad(ids.org, metaPageTokenPurpose(true))),
    account_ref: t.accountId, page_ref: t.pageId,
  };
}

/** The suites' server settings: a fresh sealing key per run, so a sealed sandbox token never outlives the process. */
export const contractEnv = (): Env => testEnv({ SECRETS_ENCRYPTION_KEY: randomBytes(32).toString("base64") });
