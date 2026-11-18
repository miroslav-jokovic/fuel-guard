import { z } from "zod";
import type { AdsTokenExpiry } from "@silvicom/shared";
import type { Env } from "../../../../env.js";
import type { MetaGraph } from "./graphClient.js";

/**
 * When a connection's token expires, from Meta's `debug_token` (audit 2026-11-18 A-8; the contract and what was
 * read are on `AdsTokenExpiry` in the shared package). Read at every connection test and once a day by the
 * reconcile job, so a token issued with an expiry is seen coming, not met as a dead ad account.
 */

/** Our app's access token, `{app id}|{app secret}` (Meta's documented form), or null while either is unset. */
export function appAccessToken(env: Pick<Env, "META_APP_ID" | "META_APP_SECRET">): string | null {
  return env.META_APP_ID && env.META_APP_SECRET ? `${env.META_APP_ID}|${env.META_APP_SECRET}` : null;
}

const answer = z.object({
  data: z.object({
    is_valid: z.boolean(),
    expires_at: z.number().int().nonnegative().optional(),
    data_access_expires_at: z.number().int().nonnegative().optional(),
  }),
});

const iso = (unix: number | undefined): string | null => (unix && unix > 0 ? new Date(unix * 1000).toISOString() : null);

export async function readTokenExpiry(graph: MetaGraph, appToken: string | null, now: Date): Promise<AdsTokenExpiry> {
  const checked_at = now.toISOString();
  if (!appToken) return { read: false, why: "no_app_id", error_code: null, checked_at };
  const r = await graph.inspectOwnToken<unknown>(appToken);
  if (!r.ok) return { read: false, why: "graph_error", error_code: r.error.error_code, checked_at };
  const parsed = answer.safeParse(r.data);
  if (!parsed.success) return { read: false, why: "graph_error", error_code: "debug_token_shape", checked_at };
  const d = parsed.data.data;
  return {
    read: true, valid: d.is_valid, checked_at,
    expires_at: iso(d.expires_at),
    // OUR reading (the page is silent, see `AdsTokenExpiry`): 0 on a valid token = a token issued never to expire.
    never_expires: d.is_valid && d.expires_at === 0,
    data_access_expires_at: iso(d.data_access_expires_at),
  };
}

/** The `token_expires_on` column: the UTC calendar day of a known expiry, or null. */
export const expiresOn = (e: AdsTokenExpiry | undefined): string | null => (e?.read && e.expires_at ? e.expires_at.slice(0, 10) : null);
