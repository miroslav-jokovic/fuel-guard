import { createHash } from "node:crypto";
import { META_GRAPH_VERSION } from "../meta/graphClient.js";
import { graphError, pick } from "./fakeMetaShapes.js";

/**
 * FakeMeta's ad-account video library (V4, the publisher's video road), apart from `fakeMeta.ts` for the
 * file budget.
 *
 * ── WHERE EACH SHAPE IS FROM (Meta's "FB Video Ads" guide, read 2026-11-17) ──────────────────────
 *   POST /{v}/act_{id}/video_ads        `upload_phase=start` → `{ video_id, upload_url }`, the URL on
 *                                        `rupload.facebook.com/video-ads-upload/{v}/{video_id}`;
 *                                        `upload_phase=finish` + `video_id` → `{ success: true }` — "When you
 *                                        end the upload session, the video is encoded and published to the ad
 *                                        account."
 *   POST {upload_url}                    the file, raw, with `Authorization: OAuth <token>` and the headers
 *                                        `offset` (0, "to restart") and `file_size` → `{ success: true }`.
 *   GET  /{v}/{video_id}?fields=status   `{ status: { video_status, uploading_phase { status,
 *                                        bytes_transferred }, processing_phase { status }, publishing_phase
 *                                        { status, publish_status, publish_time } } }`; `video_status` is one
 *                                        of ready, processing, expired, error; a phase's status one of
 *                                        not_started, in_progress, complete, error.
 *   GET  /{v}/act_{id}/video_ads         `{ data: [{ id, updated_time }] }`.
 *   https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/videoads/fbvideoads
 *
 * ⚠ OUR reading, not Meta's word — L4 re-runs the contract suite on the sandbox to settle each:
 *   · a video whose upload session was never ended is not in the account (the guide's sentence above, read
 *     backwards), so the list and a creative do not see it;
 *   · ending a session twice is refused (100). The guide shows one finish and says nothing of a second;
 *   · a file that is not an MP4, or whose length is not its `file_size`, is refused at the upload. The guide
 *     names MP4 as "recommended" and lists the other errors nowhere;
 *   · the answer's `upload_url` names Meta's real upload host, as the guide's does. The client decides where
 *     the bytes go (`MetaGraph`'s `uploadBase`), which on a simulator connection is this fake;
 *   · the guide's samples do not agree with each other or with the Reels guide's on small things, and a
 *     reader must survive each: `fate` below plays them — a phase spelt `completed`, an error said only by an
 *     `error` object while `video_status` still reads `processing`, and the two failing words.
 *   · the guide's table asks a width of 1,200 pixels at least. Since Q-APX17 (a) our video is 1440 × 1800, so
 *     either reading of that row — a refusal or advice — is met. This fake still does not measure the file: what
 *     Meta does below 1,200 is not on its page, and a guess here would be our reading posing as Meta's.
 */

type Answer = { status: number; body: unknown };

/** How a finished video's encoding ends; `ready` unless a test says otherwise. */
export type VideoFate = "ready" | "error" | "error_object_only" | "expired";

export interface FakeVideo {
  id: string;
  account_id: string;
  /** Bytes received, and their SHA-256 — a test's proof that the file sent is the file stored. */
  received: number;
  sha256: string | null;
  file_size: number | null;
  finished: boolean;
  /** Status reads answered since the session was ended. */
  reads: number;
  fate: VideoFate;
  updated_time: number;
}

export class FakeVideos {
  readonly videos = new Map<string, FakeVideo>();
  /** How many status reads after `finish` answer `processing` before the video's fate shows. */
  processingReads = 1;
  /** The fate of every video ended from now on. */
  fate: VideoFate = "ready";
  /** `complete` is the guide's word for a finished phase; the Reels guide's samples say `completed`. */
  doneWord: "complete" | "completed" = "complete";

  constructor(private readonly ids: () => string, private readonly trace: () => string, private readonly now: () => Date) {}

  /** The Graph routes this file answers; null for any other path (the caller routes on). */
  route(method: string, path: string, b: Record<string, string>): Answer | null {
    const edge = /^act_(\d+)\/video_ads$/.exec(path);
    if (edge && method === "POST") return b.upload_phase === "start" ? this.start(edge[1]!) : b.upload_phase === "finish" ? this.finish(edge[1]!, b.video_id ?? "") : this.bad("upload_phase must be start or finish");
    if (edge && method === "GET") {
      const rows = [...this.videos.values()].filter((v) => v.account_id === edge[1] && v.finished);
      return { status: 200, body: { data: rows.map((v) => ({ id: v.id, updated_time: v.updated_time })) } };
    }
    const one = /^(\d+)$/.exec(path);
    const video = one && method === "GET" ? this.videos.get(one[1]!) : undefined;
    if (!video) return null;
    return { status: 200, body: pick({ id: video.id, status: this.status(video) }, b.fields, ["id"]) };
  }

  /** A finished, encoded video of this account — what a creative's `video_data.video_id` must name. */
  usable(id: string, accountId: string): "ok" | "not_found" | "not_ready" {
    const v = this.videos.get(id);
    if (!v || v.account_id !== accountId || !v.finished) return "not_found";
    return this.phase(v) === "ready" ? "ok" : "not_ready";
  }

  /** `POST {upload_url}`: the path after the host, the two headers the guide names, and the file. */
  upload(path: string, headers: { offset?: string; file_size?: string }, bytes: Buffer): Answer {
    const m = new RegExp(`^video-ads-upload/${META_GRAPH_VERSION}/(\\d+)$`).exec(path);
    const video = m ? this.videos.get(m[1]!) : undefined;
    if (!video) return this.bad("Upload session not found");
    if (video.finished) return this.bad("The upload session has ended");
    if (headers.offset !== "0") return this.bad(`offset must be 0 to restart, got ${String(headers.offset)}`);
    if (Number(headers.file_size) !== bytes.length) return this.bad(`file_size ${String(headers.file_size)} is not the ${bytes.length} bytes received`);
    // An ISO base media file opens with a box of type `ftyp` (ISO/IEC 14496-12 §4.3).
    if (bytes.length < 12 || bytes.subarray(4, 8).toString("latin1") !== "ftyp") return this.bad("The file is in a format we don't support", 352);
    Object.assign(video, { received: bytes.length, file_size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), updated_time: this.unix() });
    return { status: 200, body: { success: true } };
  }

  private start(accountId: string): Answer {
    const id = this.ids();
    this.videos.set(id, { id, account_id: accountId, received: 0, sha256: null, file_size: null, finished: false, reads: 0, fate: this.fate, updated_time: this.unix() });
    return { status: 200, body: { video_id: id, upload_url: `https://rupload.facebook.com/video-ads-upload/${META_GRAPH_VERSION}/${id}` } };
  }

  private finish(accountId: string, id: string): Answer {
    const video = this.videos.get(id);
    if (!video || video.account_id !== accountId) return this.bad("video_id must be an upload session of this ad account");
    if (video.finished) return this.bad("The upload session has already ended");
    if (video.sha256 === null) return this.bad("No file was uploaded in this session");
    Object.assign(video, { finished: true, fate: this.fate, updated_time: this.unix() });
    return { status: 200, body: { success: true } };
  }

  /** Where a video stands: reading it is what moves an ended one through its encoding. */
  private phase(v: FakeVideo): "open" | "uploaded" | "processing" | VideoFate {
    if (!v.finished) return v.sha256 === null ? "open" : "uploaded";
    return v.reads > this.processingReads ? v.fate : "processing";
  }

  private status(v: FakeVideo): Record<string, unknown> {
    if (v.finished) v.reads += 1;
    const at = this.phase(v);
    const done = this.doneWord;
    const uploading = at === "open" ? { status: "not_started", bytes_transferred: 0 } : { status: done, bytes_transferred: v.received };
    const failure = { message: "The video could not be processed." };
    const processing = at === "open" || at === "uploaded" ? { status: "not_started" }
      : at === "processing" ? { status: "in_progress" }
      : at === "error" ? { status: "error", error: failure }
      : at === "error_object_only" ? { status: "in_progress", error: failure }
      : { status: done };
    const publishing = at === "ready" ? { status: done, publish_status: "publish", publish_time: v.updated_time } : { status: "not_started" };
    const word = at === "ready" ? "ready" : at === "error" ? "error" : at === "expired" ? "expired" : "processing";
    return { video_status: word, uploading_phase: uploading, processing_phase: processing, publishing_phase: publishing };
  }

  private unix(): number {
    return Math.floor(this.now().getTime() / 1000);
  }

  private bad(message: string, code = 100): Answer {
    return graphError(400, code, "OAuthException", `(#${code}) ${message}`, this.trace());
  }
}
