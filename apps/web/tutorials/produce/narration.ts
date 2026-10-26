import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Narration: one audio file per spoken line, made BEFORE the recording so the director can hold each
 * step exactly as long as its line (`director.ts`).
 *
 * ── PROVIDERS, NOT A MODEL ──────────────────────────────────────────────────────────────────────
 * The pipeline calls no language model; the only "AI" stage is text-to-speech, and it is a switch:
 *  - `say` (default): macOS's built-in voice. Free, offline, instant — for drafts and for reviewing a
 *    script before spending anything on it.
 *  - `higgsfield`: the voice the maintenance proposal video used (`output/maintenance-video/gen-vo.sh`,
 *    Silvicom-360-Videos D-35/D-44), same CLI and flags. Needs `higgsfield` signed in; costs credits.
 *  - `silent`: no audio at all; each line's length is estimated from its words. For `check` runs.
 * `TUTORIAL_VOICE=<provider>` picks one, `TUTORIAL_VOICE_NAME` the voice within it.
 *
 * ── CACHED BY WHAT WAS SAID ─────────────────────────────────────────────────────────────────────
 * A line's file is keyed by provider, voice and text. Editing one line of one tutorial re-voices that
 * line and nothing else, which is what makes regenerating after a dashboard change cheap.
 */

export interface NarrationLine {
  file: string | null;
  ms: number;
}

export interface NarrationManifest {
  provider: string;
  voice: string;
  lines: Record<string, NarrationLine & { text: string }>;
}

const CACHE = path.resolve(import.meta.dirname, "../.cache/narration");
/** About 150 words a minute, the pace the `say` voice speaks at with `-r 165`. */
const MS_PER_WORD = 400;

export const lineKey = (text: string): string => crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);

/** The line's real length when it has been voiced, an estimate from its words when not. */
export function narrationFor(manifest: NarrationManifest | null, text: string): NarrationLine {
  const hit = manifest?.lines[lineKey(text)];
  if (hit) return { file: hit.file, ms: hit.ms };
  return { file: null, ms: text.split(/\s+/).filter(Boolean).length * MS_PER_WORD + 300 };
}

function durationMs(file: string): number {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Math.round(Number(out.trim()) * 1000);
}

type Synth = (text: string, voice: string, wav: string) => void;

const PROVIDERS: Record<string, { voice: string; synth: Synth | null }> = {
  say: {
    voice: "Samantha",
    synth: (text, voice, wav) => {
      const aiff = `${wav}.aiff`;
      execFileSync("say", ["-v", voice, "-r", "165", "-o", aiff, text]);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ar", "48000", "-ac", "1", wav]);
      fs.rmSync(aiff);
    },
  },
  higgsfield: {
    voice: "e2a2d2e6-9ed2-59cd-82af-feaa27f8a678",
    synth: (text, voice, wav) => {
      // gen-vo.sh's recipe: the brackets give the model a run-in and a run-out it then trims cleanly.
      const out = execFileSync("higgsfield", [
        "generate", "create", "seed_audio", "--prompt", `Ready. ${text} Okay.`, "--voice_id", voice, "--voice_type", "preset",
        "--format", "wav", "--sample_rate", "48000", "--speech_rate", "-1", "--wait", "--wait-timeout", "10m",
      ], { encoding: "utf8" });
      const url = out.match(/https:\/\/\S+/g)?.pop();
      if (!url) throw new Error(`higgsfield returned no audio for: ${text}`);
      execFileSync("curl", ["-sL", url, "-o", wav]);
    },
  },
  silent: { voice: "none", synth: null },
};

export function voiceLines(texts: string[]): NarrationManifest {
  const provider = process.env.TUTORIAL_VOICE ?? "say";
  const spec = PROVIDERS[provider];
  if (!spec) throw new Error(`TUTORIAL_VOICE=${provider} is not one of: ${Object.keys(PROVIDERS).join(", ")}`);
  const voice = process.env.TUTORIAL_VOICE_NAME ?? spec.voice;
  const manifest: NarrationManifest = { provider, voice, lines: {} };
  if (!spec.synth) return manifest;
  const dir = path.join(CACHE, provider, voice.replace(/[^\w.-]/g, "_"));
  fs.mkdirSync(dir, { recursive: true });
  for (const text of new Set(texts)) {
    const key = lineKey(text);
    const wav = path.join(dir, `${key}.wav`);
    if (!fs.existsSync(wav)) spec.synth(text, voice, wav);
    manifest.lines[key] = { text, file: wav, ms: durationMs(wav) };
  }
  return manifest;
}

export function readManifest(file: string): NarrationManifest | null {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as NarrationManifest) : null;
}
