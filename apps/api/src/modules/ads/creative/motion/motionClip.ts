import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AD_ASSET_MAX_BYTES, type AdClipRef } from "@silvicom/shared";

/**
 * A model's clip, read before it is kept (ADS-PLATFORM-V2-PLAN V4e). The twin of `prepareAsset` for a moving
 * picture, and under the same rule: THE BYTES DECIDE. A URL that ends in `.mp4` and a `content_type` of
 * `video/mp4` are what Higgsfield says the file is; what it is, is read here with ffprobe — the same program
 * family that will join it (`motionJoin.ts`), so a file this accepts is a file the join can open.
 *
 * ── WHAT IS READ, AND WHY IT IS KEPT ──────────────────────────────────────────────────────────────
 * The frame, the length, and whether there is a sound track. None of the three candidate models can be asked
 * for 4:5 and no page says what frame comes back (`videoModels.ts`); each is told to make no sound, in its own
 * field. So the stored ref is the first evidence of what a model did with both asks, written on the ledger row
 * where the sitting (Q-APX12) and anyone after it can read it. Nothing is REFUSED for either: the join covers
 * any frame to ours and never maps the clip's audio.
 *
 * ── THE SIZE LIMIT IS THE BUCKET'S ────────────────────────────────────────────────────────────────
 * `ad-assets` takes 15 MB an object (migration 0562, `AD_ASSET_MAX_BYTES`). A clip over it is refused here by
 * name rather than by Storage with a 413. Whether five seconds from a real model fits is NOT measured — no clip
 * from a real model has been seen; it is one of the things the sitting reads off the files, and the limit moves
 * by a migration if they do not.
 *
 * ── FFPROBE MISSING IS NOT THE CLIP'S FAULT ───────────────────────────────────────────────────────
 * It answers `unavailable`, not a refusal: the clip was paid for, and a server without ffmpeg must leave the
 * render pending for one that has it, not write "unreadable" on a good file.
 */

const TIMEOUT_MS = 30_000;

export type ClipRefusal = { kind: "refused"; code: "unsupported_format" | "unreadable" | "too_large"; reason: string };
export type PreparedClip = { kind: "ready"; bytes: Buffer; ref: AdClipRef } | ClipRefusal | { kind: "unavailable"; detail: string };

export const clipKey = (orgId: string, c: Pick<AdClipRef, "sha256">) => `${orgId}/${c.sha256}.mp4`;

const refuse = (code: ClipRefusal["code"], reason: string): ClipRefusal => ({ kind: "refused", code, reason });

/** An ISO base media file: a box whose type is `ftyp` comes first (ISO/IEC 14496-12 §4.3). */
const startsLikeMp4 = (b: Buffer) => b.length >= 12 && b.subarray(4, 8).toString("latin1") === "ftyp";

interface Probe { streams?: Array<{ codec_type?: string; width?: number; height?: number }>; format?: { duration?: string } }

function ffprobe(bin: string, file: string): Promise<{ ok: true; probe: Probe } | { ok: false; missing: boolean; detail: string }> {
  return new Promise((resolve) => {
    execFile(bin, ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file], { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
        return resolve({ ok: false, missing, detail: missing ? `${bin} is not installed on this server` : String(stderr).trim().split("\n").slice(-1)[0]?.slice(0, 300) ?? "ffprobe failed" });
      }
      try { resolve({ ok: true, probe: JSON.parse(String(stdout)) as Probe }); } catch { resolve({ ok: false, missing: false, detail: "ffprobe answered no JSON" }); }
    });
  });
}

export async function prepareClip(bytes: Buffer, opts: { ffprobe?: string } = {}): Promise<PreparedClip> {
  if (bytes.length === 0) return refuse("unreadable", "The file is empty.");
  if (bytes.length > AD_ASSET_MAX_BYTES) return refuse("too_large", `The clip is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; the store takes ${AD_ASSET_MAX_BYTES / 1024 / 1024} MB.`);
  if (!startsLikeMp4(bytes)) return refuse("unsupported_format", "The file is not an MP4, whatever its name says.");
  const dir = await mkdtemp(join(tmpdir(), "ads-clip-"));
  try {
    const file = join(dir, "clip.mp4");
    await writeFile(file, bytes);
    const read = await ffprobe(opts.ffprobe ?? "ffprobe", file);
    if (!read.ok) return read.missing ? { kind: "unavailable", detail: read.detail } : refuse("unreadable", `The file starts like an MP4 but cannot be read as one: ${read.detail}`);
    const picture = read.probe.streams?.find((s) => s.codec_type === "video");
    const durationMs = Math.round(Number(read.probe.format?.duration) * 1000);
    if (!picture?.width || !picture.height) return refuse("unreadable", "The MP4 holds no picture.");
    if (!Number.isFinite(durationMs) || durationMs <= 0) return refuse("unreadable", "The MP4 has no length.");
    return {
      kind: "ready", bytes,
      ref: {
        sha256: createHash("sha256").update(bytes).digest("hex"), format: "mp4", width: picture.width, height: picture.height, duration_ms: durationMs,
        has_audio: read.probe.streams?.some((s) => s.codec_type === "audio") ?? false, byte_size: bytes.length,
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
