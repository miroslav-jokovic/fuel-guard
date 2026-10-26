import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { TimelineEntry } from "../director";
import type { Tutorial } from "../scenario";
import type { NarrationManifest } from "./narration";

/**
 * Turns a recording into what a person watches and reads: `<id>.mp4` with the narration laid on and
 * soft subtitles inside, `captions.srt` / `captions.vtt` beside it, and `instructions.md`.
 *
 * ── CAPTIONS ARE BUILT, NOT TRANSCRIBED ─────────────────────────────────────────────────────────
 * Each caption is the step's own `say`, timed by the timeline the director wrote while filming. No
 * speech recogniser listens to the audio, so a caption can never mishear "DF" as "TF", and the subtitles
 * of a `silent` draft are as exact as those of a voiced cut.
 *
 * ── FFMPEG ONLY ─────────────────────────────────────────────────────────────────────────────────
 * Every line is placed at its step's start with `adelay` and mixed once; the screencast is re-encoded
 * to H.264 at a constant 30 fps (the screencast's frames arrive when the page paints, not on a clock),
 * with a short fade at each end. Chapter cards are Playwright's own (`screencast.showChapter`), filmed
 * in the page, so there is no second compositor to keep in step.
 */

interface Timeline {
  id: string;
  steps: TimelineEntry[];
}

const MIN_CAPTION_MS = 1500;

function stamp(ms: number, sep: "," | "."): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

/** Two lines at most, broken at the space nearest the middle — what a caption reader expects. */
function wrap(text: string): string {
  if (text.length <= 64) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

function cues(steps: TimelineEntry[]): Array<{ start: number; end: number; text: string }> {
  return steps.map((s, i) => {
    const next = steps[i + 1]?.startMs ?? Infinity;
    const end = Math.min(s.startMs + Math.max(s.narrationMs, MIN_CAPTION_MS), next - 50);
    return { start: s.startMs, end, text: wrap(s.say) };
  });
}

export function writeCaptions(outDir: string, steps: TimelineEntry[]): { srt: string; vtt: string } {
  const list = cues(steps);
  const srt = list.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text}\n`).join("\n");
  const vtt = `WEBVTT\n\n${list.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text}\n`).join("\n")}`;
  const files = { srt: path.join(outDir, "captions.srt"), vtt: path.join(outDir, "captions.vtt") };
  fs.writeFileSync(files.srt, srt);
  fs.writeFileSync(files.vtt, vtt);
  return files;
}

/** The handout: the same steps, in the same words, with the still the recording took of each. */
export function writeInstructions(outDir: string, tutorial: Tutorial, steps: TimelineEntry[]): string {
  const lines = [`# ${tutorial.title}`, "", tutorial.summary, "", `Video: [${tutorial.id}.mp4](${tutorial.id}.mp4) · captions: [captions.vtt](captions.vtt)`, ""];
  if (tutorial.prerequisites?.length) {
    lines.push("**Before you start**", "", ...tutorial.prerequisites.map((p) => `- ${p}`), "");
  }
  tutorial.chapters.forEach((chapter, ci) => {
    lines.push(`## ${ci + 1}. ${chapter.title}`, "");
    let n = 0;
    for (const s of steps.filter((x) => x.chapter === ci + 1)) {
      lines.push(`${++n}. ${s.say}`);
      if (s.shot) lines.push("", `   ![${chapter.title}, step ${n}](steps/${s.shot})`, "");
    }
    lines.push("");
  });
  const file = path.join(outDir, "instructions.md");
  fs.writeFileSync(file, lines.join("\n").replace(/\n{3,}/g, "\n\n"));
  return file;
}

function seconds(file: string): number {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
}

export function composeVideo(outDir: string, id: string, steps: TimelineEntry[], narration: NarrationManifest | null, srt: string): string {
  const raw = path.join(outDir, "raw.webm");
  if (!fs.existsSync(raw)) throw new Error(`${raw} is missing: record the tutorial first.`);
  const out = path.join(outDir, `${id}.mp4`);
  const duration = seconds(raw);
  const voiced = narration?.provider !== "silent" ? steps.filter((s) => s.narrationFile) : [];

  const args = ["-y", "-loglevel", "error", "-i", raw];
  for (const s of voiced) args.push("-i", s.narrationFile!);
  args.push("-i", srt);
  const fade = `fade=t=in:st=0:d=0.6,fade=t=out:st=${Math.max(0, duration - 0.9).toFixed(2)}:d=0.9`;
  const filters = [`[0:v]fps=30,format=yuv420p,${fade}[v]`];
  if (voiced.length) {
    voiced.forEach((s, i) => filters.push(`[${i + 1}:a]adelay=${s.startMs}|${s.startMs},aresample=48000[a${i}]`));
    filters.push(`${voiced.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voiced.length}:normalize=0:duration=longest,apad[a]`);
  }
  args.push("-filter_complex", filters.join(";"), "-map", "[v]");
  if (voiced.length) args.push("-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-ac", "2");
  const subIndex = voiced.length + 1;
  args.push(
    "-map", `${subIndex}:s`, "-c:s", "mov_text", "-metadata:s:s:0", "language=eng",
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", "-t", duration.toFixed(2), out,
  );
  execFileSync("ffmpeg", args, { stdio: "inherit" });
  return out;
}

export function produce(outDir: string, tutorial: Tutorial, narration: NarrationManifest | null): { video: string; instructions: string } {
  const timeline = JSON.parse(fs.readFileSync(path.join(outDir, "timeline.json"), "utf8")) as Timeline;
  const { srt } = writeCaptions(outDir, timeline.steps);
  const instructions = writeInstructions(outDir, tutorial, timeline.steps);
  const video = composeVideo(outDir, tutorial.id, timeline.steps, narration, srt);
  return { video, instructions };
}
