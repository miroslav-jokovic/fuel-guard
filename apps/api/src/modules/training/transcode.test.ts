import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { heightsFor, parseProbe, posterArgs, renditionArgs, transcodeVersion } from "./transcode.js";

/**
 * Making the phone versions (§8.2): the encode's arguments, the probe, and one REAL run of ffmpeg on a
 * generated two-second film — CI's `test-api` has ffmpeg (the motion-ads tests need it too), so this
 * proves the job end to end rather than the arguments alone.
 */

const ORG = "33333333-3333-4333-8333-333333333333";
const V = "77777777-7777-4777-8777-777777777777";
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

describe("the encode", () => {
  it("is H.264 main, mono AAC, index first — the settings measured on film 01", () => {
    const a = renditionArgs("in.mp4", "out.mp4", 360);
    expect(a.join(" ")).toContain("scale=-2:360");
    expect(a.join(" ")).toContain("-crf 26");
    expect(a.join(" ")).toContain("-profile:v main");
    expect(a.join(" ")).toContain("-ac 1");
    expect(a.join(" ")).toContain("-movflags +faststart");
  });

  it("never upscales, and always makes the smallest", () => {
    expect(heightsFor(1080)).toEqual([360, 540, 720]);
    expect(heightsFor(540)).toEqual([360, 540]);
    expect(heightsFor(240)).toEqual([360]);
  });

  it("takes the poster past the title card, never more than 30 s in", () => {
    expect(posterArgs("i", "o", 8000)).toContain("2.00");
    expect(posterArgs("i", "o", 204_400)).toContain("30.00");
  });

  it("reads ffprobe's height and duration, and refuses what is not a video", () => {
    expect(parseProbe(JSON.stringify({ streams: [{ codec_type: "audio" }, { codec_type: "video", height: 1080 }], format: { duration: "204.42" } }))).toEqual({ height: 1080, durationMs: 204_420 });
    expect(parseProbe(JSON.stringify({ streams: [{ codec_type: "audio" }], format: { duration: "10" } }))).toBeNull();
    expect(parseProbe("not json")).toBeNull();
  });
});

describe.skipIf(!HAS_FFMPEG)("a real upload", () => {
  it("becomes renditions and a poster, and the version is ready with its length", async () => {
    const dir = mkdtempSync(join(tmpdir(), "training-test-"));
    try {
      const src = join(dir, "film.mp4");
      const made = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=24:duration=2", "-f", "lavfi", "-i", "sine=duration=2", "-c:v", "libx264", "-c:a", "aac", "-shortest", src]);
      expect(made.status).toBe(0);
      const bytes = readFileSync(src);
      const rec = createSupabaseRecorder({
        tables: { training_versions: [{ id: V, lesson_id: "L", state: "processing", source_path: "o/src.mp4", source_bytes: bytes.length, source_sha256: createHash("sha256").update(bytes).digest("hex") }] },
        storage: { download: () => ({ data: new Blob([bytes]), error: null }) },
      });
      const out = await transcodeVersion(rec.client, ORG, V);
      expect(out.outcome).toBe("ready");
      const ready = rec.writtenRows("training_versions").at(-1) as { state: string; duration_ms: number; renditions: Array<{ height: number; bytes: number }> };
      expect(ready.state).toBe("ready");
      expect(ready.duration_ms).toBeGreaterThanOrEqual(1900);
      expect(ready.renditions.map((r) => r.height)).toEqual([360, 540, 720]);
      expect(rec.storageCalls().filter((c) => c.fn === "upload").map((c) => String(c.args[0]).split("/").pop())).toEqual(["360.mp4", "540.mp4", "720.mp4", "poster.jpg"]);
      expectOrgScoped(rec, ORG);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("records a file that changed on the way as the version's reason, not a crash", async () => {
    const rec = createSupabaseRecorder({
      tables: { training_versions: [{ id: V, lesson_id: "L", state: "processing", source_path: "o/src.mp4", source_bytes: 3, source_sha256: "0".repeat(64) }] },
      storage: { download: () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }) },
    });
    expect(await transcodeVersion(rec.client, ORG, V)).toMatchObject({ outcome: "failed" });
    expect(rec.writtenRows("training_versions")[0]).toMatchObject({ state: "failed", process_error: expect.stringMatching(/arrived different/) });
  });
});
