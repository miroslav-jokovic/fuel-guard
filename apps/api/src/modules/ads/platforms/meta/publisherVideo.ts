import type { AdNameLanguage } from "@silvicom/shared";
import { completeAction, startAction, type ActionRow } from "../../actions/actionLedger.js";
import type { GraphFailure } from "./graphClient.js";
import { failureBody, PUBLISHER, type PublishInput, type PublisherDeps } from "./publisher.js";

/**
 * A motion ad's video onto the ad account (V4, ADS-PLATFORM-V2-PLAN step V4): the MP4 compose joined and
 * stored (`ads_creatives.motion.files`), one per language, sent the way Meta's "FB Video Ads" guide says —
 * `act_<id>/video_ads` start, the file to the answered `upload_url`, `video_ads` finish — and then waited
 * for until Meta has encoded it. Read 2026-11-17:
 * https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/videoads/fbvideoads
 *
 * ── RESUME, NEVER A SECOND VIDEO ─────────────────────────────────────────────────────────────────
 * A video has no name to be found by (the account's list answers an id and a time), and Meta gives no
 * hash for one as it does for an image. So what makes a retry safe is the video's own STATUS, asked of the
 * video id our ledger kept:
 *
 *   · the ledger row `video:<creative>:<lang>` is completed the moment `start` answers, holding the video id
 *     and its upload URL. A later stint (or the same step delivered twice) finds the newest such row for this
 *     campaign, this connection and THIS FILE (its SHA-256), and asks Meta where that video stands;
 *   · not uploaded → the file is sent again from offset 0, the guide's own way "to restart";
 *   · uploaded, session not ended → `finish`;
 *   · encoding, or ready → nothing is sent; it is waited for;
 *   · failed, expired, or gone → a new session. That is the one case that leaves a second entry behind, and
 *     the first one is by then a video Meta itself has given up on.
 *
 * `finish` is the one call here that cannot be told apart from its own repeat on any page, so its failure
 * is not believed: the status is read once more, and a video that is past its upload is taken as ended.
 * A `start` whose answer was lost is simply sent again: the guide says a video reaches the account "when
 * you end the upload session", so a session never ended is not a video in anyone's library.
 *
 * ── WAITING ──────────────────────────────────────────────────────────────────────────────────────
 * No page says a creative may name a video Meta is still encoding. This publisher waits for `ready` before
 * it makes the creative (FakeMeta refuses otherwise — both OUR reading until L4). The wait is bounded: a
 * video still encoding after it fails the step as `video_not_ready`, the video stays where it is, and the
 * next stint adopts it and waits again. How long Meta takes for a seven-second file has not been measured;
 * the two numbers below are ours.
 *
 * ── THE STATUS IS READ FOR ITS ERRORS, NOT ONLY ITS WORDS ────────────────────────────────────────
 * The guide's samples and the Reels guide's disagree: a finished phase is `complete` in one and `completed`
 * in the other, and a failed encoding is shown with `video_status` still `processing` and only an `error`
 * object to say so. `readVideoStatus` therefore calls a video failed on either word OR on any phase that
 * carries an error, and never calls one ready on anything but `video_status: "ready"`.
 */

export const VIDEO_READY_POLLS = 12;
export const VIDEO_READY_WAIT_MS = 5_000;

/** The file of one language's motion ad, as `ads_creatives.motion.files` names it. */
export interface PublishVideoFile { language: AdNameLanguage; sha256: string; byte_size: number }

export interface VideoReading {
  state: "ready" | "failed" | "pending";
  /** The whole file is at Meta. */
  uploaded: boolean;
  /** The upload session was ended: Meta has begun (or finished) encoding. */
  ended: boolean;
  /** Why it failed, in Meta's words when it gave any. */
  reason: string | null;
}

const DONE = new Set(["complete", "completed"]);
const PHASES = ["uploading_phase", "processing_phase", "publishing_phase"] as const;

/** What `GET <video_id>?fields=status` says, read for its errors as well as its words (header). */
export function readVideoStatus(body: unknown): VideoReading {
  const status = ((body as { status?: unknown } | null)?.status ?? {}) as Record<string, unknown>;
  const phase = (name: (typeof PHASES)[number]) => (status[name] ?? {}) as { status?: unknown; error?: unknown; errors?: unknown };
  const word = typeof status.video_status === "string" ? status.video_status : "";
  const broken = PHASES.map(phase).find((p) => p.status === "error" || p.error != null || (Array.isArray(p.errors) && p.errors.length > 0));
  const uploaded = DONE.has(String(phase("uploading_phase").status));
  const started = (s: unknown) => typeof s === "string" && s !== "not_started";
  const ended = word === "ready" || started(phase("processing_phase").status) || started(phase("publishing_phase").status);
  if (broken || word === "error" || word === "expired") {
    const said = (broken?.error as { message?: unknown } | undefined)?.message;
    return { state: "failed", uploaded, ended, reason: typeof said === "string" && said ? said : word || "error" };
  }
  return { state: word === "ready" ? "ready" : "pending", uploaded: uploaded || ended, ended, reason: null };
}

type Fail = { ok: false; error_code: string; response?: unknown };
export type VideoOutcome = { ok: true; video_id: string } | Fail;
interface Session { video_id: string; upload_url: string }

const fail = (error: GraphFailure, step: string): Fail => ({ ok: false, error_code: error.error_code, response: { step, ...failureBody(error) } });

/** The video of one creative in one language, on the ad account and encoded; `short` is the ad's `<creative>:<lang>`. */
export async function ensureVideo(deps: PublisherDeps, input: PublishInput, creativeId: string, short: string, file: PublishVideoFile): Promise<VideoOutcome> {
  const at = () => deps.now().toISOString();
  const row = (level: string): ActionRow => ({
    org_id: input.orgId, campaign_id: input.campaignId, creative_id: creativeId, connection_id: input.connectionId, kind: "create_paused",
    ...PUBLISHER, idempotency_key: `create_paused:${input.key}:${level}`, request: { level, sha256: file.sha256, byte_size: file.byte_size },
  });
  const status = (id: string) => deps.graph.get<unknown>(id, { fields: "status" });

  // ── the session: the one our ledger kept, if Meta still holds it; else a new one ──────────────
  const level = `video:${short}`;
  let session = await keptSession(deps, input, level, file.sha256);
  let reading: VideoReading | null = null;
  if (session) {
    const r = await status(session.video_id);
    // An id Meta no longer knows answers 100 (`invalid_request`); anything else is ours to stop on.
    if (!r.ok && r.error.kind !== "invalid_request") return fail(r.error, "video_status");
    reading = r.ok ? readVideoStatus(r.data) : null;
    if (!reading || reading.state === "failed") session = null;
  }
  const opened = await startAction(deps.admin, row(level), at());
  if (opened !== "duplicate" && "refusedBy" in opened) return { ok: false, error_code: opened.refusedBy };
  // This step was delivered before in this stint and its session is not in the ledger yet: the other delivery
  // may be opening one right now. As at every level (`ensure`), a second create is never sent on a guess.
  if (opened === "duplicate" && !session) return { ok: false, error_code: "create_outcome_unknown" };
  const close = (outcome: Parameters<typeof completeAction>[3]) => (opened === "duplicate" ? Promise.resolve() : completeAction(deps.admin, input.orgId, opened.id, outcome));
  if (session) {
    await close({ status: "succeeded", response: { adopted: true, upload_url: session.upload_url }, platform_refs: { meta_video_id: session.video_id }, at: at() });
  } else {
    const started = await deps.graph.post<{ video_id?: unknown; upload_url?: unknown }>(`act_${input.accountId}/video_ads`, { upload_phase: "start" }, { idempotent: true });
    if (!started.ok) {
      await close({ status: "failed", error_code: started.error.error_code, response: failureBody(started.error), at: at() });
      return fail(started.error, "video_start");
    }
    const { video_id, upload_url } = started.data;
    if (typeof video_id !== "string" || !video_id || typeof upload_url !== "string" || !upload_url) {
      await close({ status: "failed", error_code: "video_session_missing", at: at() });
      return { ok: false, error_code: "video_session_missing" };
    }
    session = { video_id, upload_url };
    reading = { state: "pending", uploaded: false, ended: false, reason: null };
    await close({ status: "succeeded", response: { upload_url }, platform_refs: { meta_video_id: video_id }, at: at() });
  }

  // ── the file: sent, the session ended, the encoding waited for — one row for how that went ────
  const sent = await startAction(deps.admin, row(`videofile:${short}`), at());
  if (sent !== "duplicate" && "refusedBy" in sent) return { ok: false, error_code: sent.refusedBy };
  const refs = { meta_video_id: session.video_id };
  const done = async (out: VideoOutcome): Promise<VideoOutcome> => {
    if (sent !== "duplicate") {
      await completeAction(deps.admin, input.orgId, sent.id, out.ok ? { status: "succeeded", platform_refs: refs, at: at() }
        : { status: "failed", error_code: out.error_code, response: out.response, platform_refs: refs, at: at() });
    }
    return out;
  };

  if (!reading!.uploaded) {
    const bytes = await deps.readClip(input.orgId, { sha256: file.sha256 });
    const up = await deps.graph.upload<unknown>(session.upload_url, bytes);
    if (!up.ok) return done(fail(up.error, "video_upload"));
  }
  if (!reading!.ended) {
    const ended = await deps.graph.post<unknown>(`act_${input.accountId}/video_ads`, { upload_phase: "finish", video_id: session.video_id }, { idempotent: false });
    if (!ended.ok) {
      // Its answer is not believed either way (header): the video itself says whether the session ended.
      const after = await status(session.video_id);
      if (!after.ok || !readVideoStatus(after.data).ended) return done(fail(ended.error, "video_finish"));
    }
  }
  for (let poll = 1; ; poll += 1) {
    const r = await status(session.video_id);
    if (!r.ok) return done(fail(r.error, "video_status"));
    const now = readVideoStatus(r.data);
    if (now.state === "ready") return done({ ok: true, video_id: session.video_id });
    if (now.state === "failed") return done({ ok: false, error_code: "video_processing_failed", response: { video_id: session.video_id, reason: now.reason } });
    if (poll >= VIDEO_READY_POLLS) return done({ ok: false, error_code: "video_not_ready", response: { video_id: session.video_id, polls: poll } });
    await (deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(VIDEO_READY_WAIT_MS);
  }
}

/**
 * The newest upload session the ledger holds for this file on this campaign and connection, from any stint.
 * Org-scoped (the service role bypasses RLS). The level and the file are matched here, not in the query:
 * they live inside `request`, and a campaign's `create_paused` rows are a few dozen.
 */
async function keptSession(deps: PublisherDeps, input: PublishInput, level: string, sha256: string): Promise<Session | null> {
  const { data, error } = await deps.admin.from("ads_actions").select("request, response, platform_refs, started_at")
    .eq("org_id", input.orgId).eq("campaign_id", input.campaignId).eq("connection_id", input.connectionId).eq("kind", "create_paused").eq("status", "succeeded")
    .order("started_at", { ascending: false }).limit(500);
  if (error) throw new Error(`ads_actions: ${error.message}`);
  for (const r of (data ?? []) as Array<{ request: { level?: unknown; sha256?: unknown } | null; response: { upload_url?: unknown } | null; platform_refs: { meta_video_id?: unknown } | null }>) {
    if (r.request?.level !== level || r.request.sha256 !== sha256) continue;
    const video_id = r.platform_refs?.meta_video_id;
    const upload_url = r.response?.upload_url;
    if (typeof video_id === "string" && typeof upload_url === "string") return { video_id, upload_url };
  }
  return null;
}
