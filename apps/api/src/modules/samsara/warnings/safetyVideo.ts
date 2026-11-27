/**
 * One safety event's video, fetched fresh on the click (WARNING-DESK-PLAN D-WD7). Never stored: each
 * `media[].url` is a signed link on `us4-safetymediadelivery.samsara.com` that lives about 8 hours
 * (measured 2026-11-26 from its `exp` parameter), and `GET /safety-events?safetyEventIds=<id>` mints a
 * new one each time it is asked. Zero bytes kept, one Samsara call per click.
 *
 * Read-only, through `samsaraFetch` with the org's own token, like every warning read. The CALLER checks
 * that the event belongs to the follow-up and the org (`routes` in modules/followups) before this is
 * asked — this function only fetches what it is told to.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { samsaraFetch } from "../lib/samsaraHttp.js";
import { NoSamsaraTokenError } from "../samsaraVehicleSync.js";

export interface SafetyEventMedia {
  /** Camera the clip is from (`dashcamForwardFacing`, `dashcamDriverFacing`, …) when Samsara says. */
  input: string | null;
  url: string;
}

export async function fetchSafetyEventVideo(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  eventId: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<SafetyEventMedia[]> {
  const token = await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();
  const url = new URL("/safety-events", env.SAMSARA_API_URL);
  url.searchParams.set("safetyEventIds", eventId);
  const res = await samsaraFetch(env, token, url, { priority: "live", fetchImpl: opts.fetchImpl });
  if (!res.ok) throw new Error(`Samsara /safety-events answered ${res.status}`);
  const json = (await res.json()) as { data?: Array<{ id?: unknown; media?: unknown }> };
  const event = (json.data ?? []).find((e) => e.id === eventId);
  const media = Array.isArray(event?.media) ? event.media : [];
  const out: SafetyEventMedia[] = [];
  for (const m of media as Array<{ url?: unknown; input?: unknown }>) {
    if (typeof m.url !== "string" || !m.url.startsWith("https://")) continue;
    out.push({ url: m.url, input: typeof m.input === "string" ? m.input : null });
  }
  return out;
}
