import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TRAINING_RENDITION_HEIGHTS } from "@silvicom/shared";
import { posterPath, renditionPath, TRAINING_BUCKET } from "./media.js";

/**
 * Turning an uploaded film into what a phone plays (§8.2, D-TR4): three MP4s — 360p, 540p, 720p —
 * and a poster, made once on upload by the `training_transcode` job.
 *
 * ── THE NUMBERS ARE MEASURED, NOT CHOSEN ───────────────────────────────────────────────────────
 * Film 01 (3:24) at these settings, 2026-11-24: 360p 2.1 MB (84 kbps), 540p 3.0 MB (115 kbps), 720p
 * 4.4 MB (170 kbps), and the board text stays readable at 360p. The films are flat drawn boards, so a
 * constant-quality encode lands far below a fixed bitrate's size. Mono audio: the films are one voice.
 * `+faststart` puts the index first, so a phone starts playing before the file has arrived.
 *
 * ── IT RUNS ON THE API'S HOST ──────────────────────────────────────────────────────────────────
 * The image carries Debian's ffmpeg with libx264 and AAC (infra/image/Dockerfile, put there for motion
 * ads). Two threads and `-preset medium`: a 3½-minute film takes about a minute per rendition and the
 * server keeps its other cores for requests. A missing ffmpeg is a named failure on the version
 * ("ffmpeg is not installed on this server"), never a crash.
 */

const TIMEOUT_MS = 15 * 60_000;
const QUALITY: Record<number, { crf: number; audioKbps: number }> = { 360: { crf: 26, audioKbps: 48 }, 540: { crf: 26, audioKbps: 64 }, 720: { crf: 25, audioKbps: 96 } };

/** ffmpeg's arguments for one rendition. Pure, so the encode is read and tested without running it. */
export function renditionArgs(input: string, output: string, height: number): string[] {
  const q = QUALITY[height] ?? { crf: 26, audioKbps: 64 };
  return [
    "-hide_banner", "-loglevel", "error", "-y", "-i", input,
    "-vf", `scale=-2:${height}`, "-c:v", "libx264", "-preset", "medium", "-crf", String(q.crf),
    "-profile:v", "main", "-pix_fmt", "yuv420p", "-threads", "2",
    "-c:a", "aac", "-b:a", `${q.audioKbps}k`, "-ac", "1", "-movflags", "+faststart", output,
  ];
}

/** The poster: one frame a quarter of the way in (past the title card), at most 30 s in, 480 wide. */
export function posterArgs(input: string, output: string, durationMs: number): string[] {
  const at = Math.min(30, (durationMs / 1000) * 0.25).toFixed(2);
  return ["-hide_banner", "-loglevel", "error", "-y", "-ss", at, "-i", input, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "6", output];
}

/** The heights to make: every standard height not above the source's own (an upscale only costs bytes). */
export const heightsFor = (sourceHeight: number): number[] => {
  const hs = TRAINING_RENDITION_HEIGHTS.filter((h) => h <= sourceHeight);
  return hs.length ? [...hs] : [TRAINING_RENDITION_HEIGHTS[0]];
};

export interface Probe {
  durationMs: number;
  height: number;
}

/** Read ffprobe's JSON: the first video stream's height and the container's duration, or null. */
export function parseProbe(json: string): Probe | null {
  try {
    const p = JSON.parse(json) as { streams?: Array<{ codec_type?: string; height?: number }>; format?: { duration?: string } };
    const video = p.streams?.find((s) => s.codec_type === "video");
    const durationMs = Math.round(Number(p.format?.duration) * 1000);
    if (!video?.height || !Number.isFinite(durationMs) || durationMs < 1000) return null;
    return { durationMs, height: video.height };
  } catch {
    return null;
  }
}

type Run = (bin: string, args: string[]) => Promise<{ ok: true; stdout: string } | { ok: false; detail: string }>;

export const runTool: Run = (bin, args) =>
  new Promise((resolve) => {
    execFile(bin, args, { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve({ ok: true, stdout: String(stdout) });
      const e = error as NodeJS.ErrnoException & { killed?: boolean };
      if (e.code === "ENOENT") return resolve({ ok: false, detail: `${bin} is not installed on this server` });
      if (e.killed) return resolve({ ok: false, detail: `${bin} took longer than ${TIMEOUT_MS / 60_000} minutes` });
      // ffmpeg's last words name our temporary files and nothing of a carrier's.
      resolve({ ok: false, detail: String(stderr).trim().split("\n").slice(-2).join(" | ").slice(0, 300) || `${bin} failed` });
    });
  });

interface VersionRow {
  id: string;
  lesson_id: string;
  state: string;
  source_path: string | null;
  source_bytes: number | string | null;
  source_sha256: string | null;
}

export type TranscodeOutcome = { outcome: "ready" | "failed" | "skipped"; detail: string };

/**
 * The job's body: make the renditions and the poster for one uploaded version, then mark it `ready`,
 * or `failed` with the reason in the office's words. IDEMPOTENT (queue Q9): a version no longer
 * `processing` is skipped, uploads overwrite, and the final UPDATE is conditional on `processing`.
 */
export async function transcodeVersion(admin: SupabaseClient, orgId: string, versionId: string, run: Run = runTool): Promise<TranscodeOutcome> {
  const { data, error } = await admin
    .from("training_versions")
    .select("id, lesson_id, state, source_path, source_bytes, source_sha256")
    .eq("org_id", orgId)
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw new Error(`[training] version not read: ${error.message}`);
  const v = data as VersionRow | null;
  if (!v || v.state !== "processing" || !v.source_path) return { outcome: "skipped", detail: v ? `state is ${v.state}` : "no such version" };

  const fail = async (detail: string): Promise<TranscodeOutcome> => {
    const { error: e } = await admin
      .from("training_versions")
      .update({ state: "failed", process_error: detail.slice(0, 500) })
      .eq("org_id", orgId)
      .eq("id", versionId)
      .eq("state", "processing");
    if (e) throw new Error(`[training] failure not recorded: ${e.message}`);
    return { outcome: "failed", detail };
  };

  const dir = await mkdtemp(join(tmpdir(), "training-"));
  try {
    const { data: blob, error: dl } = await admin.storage.from(TRAINING_BUCKET).download(v.source_path);
    if (dl || !blob) return await fail("The uploaded file did not arrive. Upload it again.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length !== Number(v.source_bytes) || createHash("sha256").update(bytes).digest("hex") !== v.source_sha256) {
      return await fail("The file arrived different from the one that was picked. Upload it again.");
    }
    const src = join(dir, "source.mp4");
    await writeFile(src, bytes);

    const probed = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", src]);
    if (!probed.ok) return await fail(`The video could not be read: ${probed.detail}`);
    const probe = parseProbe(probed.stdout);
    if (!probe) return await fail("That file is not a video, or it is shorter than a second.");

    const renditions: Array<{ height: number; path: string; bytes: number }> = [];
    for (const h of heightsFor(probe.height)) {
      const out = join(dir, `${h}.mp4`);
      const r = await run("ffmpeg", renditionArgs(src, out, h));
      if (!r.ok) return await fail(`The ${h}p version could not be made: ${r.detail}`);
      const path = renditionPath(orgId, v.lesson_id, versionId, h);
      await put(admin, path, await readFile(out), "video/mp4");
      renditions.push({ height: h, path, bytes: (await stat(out)).size });
    }
    const poster = join(dir, "poster.jpg");
    const pr = await run("ffmpeg", posterArgs(src, poster, probe.durationMs));
    if (!pr.ok) return await fail(`The picture for the list could not be made: ${pr.detail}`);
    const pPath = posterPath(orgId, v.lesson_id, versionId);
    await put(admin, pPath, await readFile(poster), "image/jpeg");

    const { error: up } = await admin
      .from("training_versions")
      .update({ state: "ready", duration_ms: probe.durationMs, renditions, poster_path: pPath, process_error: null })
      .eq("org_id", orgId)
      .eq("id", versionId)
      .eq("state", "processing");
    if (up) throw new Error(`[training] version not marked ready: ${up.message}`);
    return { outcome: "ready", detail: `${renditions.map((r) => `${r.height}p ${(r.bytes / 1048576).toFixed(1)} MB`).join(", ")}` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function put(admin: SupabaseClient, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await admin.storage.from(TRAINING_BUCKET).upload(path, bytes, { contentType, upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(`[training] ${path} not stored: ${error.message}`);
}
