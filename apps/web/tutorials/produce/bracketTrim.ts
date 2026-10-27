import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Cuts the "Ready." and "Okay." brackets off a Higgsfield `seed_audio` take, and proves the words
 * left between them are the script.
 *
 * The voice is asked to read `Ready. <line> Okay.` (`narration.ts`) because the model rushes or
 * swallows the first and last word of a bare line; the brackets give it a run-in and a run-out.
 * They are scaffolding, and have to come off cleanly.
 *
 * ── BY WORDS, NOT BY THE SHAPE OF THE SOUND ─────────────────────────────────────────────────────
 * The first version ported the films' trim (`bracket_bounds` in Silvicom-360-Videos'
 * `build-timeline.py`), which finds the brackets from silences alone: the pause after "Ready." is
 * a sentence gap, a short first run is a surviving bracket word (their D-120), a short last run a
 * tick after "Okay." (D-119), a lone short run inside the line a stray word. That is sound for
 * film narration, whose lines open and close on full clauses. Tutorial lines do not. On the first
 * paid run (45 lines, 2026-10-27) a transcript of every cut line found 7 of them damaged:
 * "Now," "Next," "Click it," "Up top:" "For example," and "All trucks" were cut off as if they were
 * "Ready.", and "moving, stopped, parked or offline" lost its last three words as if they were ticks.
 * Switching the edge rules off saved four lines and still lost three, plus an "Okay." kept. Short
 * words at a line's edges are exactly what pause shape cannot tell from a bracket.
 *
 * So `words.py` transcribes the take with word timings, and the cut is placed in the SILENCE that
 * touches the line's first and last word (Whisper's timings are ±0.1 s; silencedetect's are exact).
 * The same transcript is checked against the script, which is the real test the films' stray-word
 * guard approximated.
 */

export type Span = readonly [start: number, end: number];
export interface Word {
  w: string;
  start: number;
  end: number;
}

/** The films' cut padding and internal pause cap (build-timeline.py's PAD_IN/PAD_OUT and CAP). */
const PAD_IN = 0.09;
const PAD_OUT = 0.16;
const PAUSE_CAP = 0.42;
/** How far Whisper's word edges may sit from the true edge of the sound. */
const SLACK = 0.15;

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");

/**
 * Where to cut: after "ready" (found among the first three words — takes have opened "Get ready."
 * and "And ready."), before a closing "okay" (Whisper drops it now and then, and the line then runs
 * to the last word heard). Each cut lands on the silence beside the line's edge word, or halfway
 * between the bracket word and the line when the reader ran them together with no pause at all.
 */
export function lineCut(
  words: readonly Word[],
  silences: readonly Span[],
  duration: number,
): { span: Span; room: Span; heard: string } {
  const ready = words.slice(0, 3).findIndex((x) => norm(x.w) === "ready");
  if (ready < 0) throw new Error(`no "Ready." heard at the start (heard "${words.slice(0, 3).map((x) => x.w).join(" ")}")`);
  const last = words.at(-1);
  const okay = last && ["okay", "ok"].includes(norm(last.w)) ? words.length - 1 : words.length;
  const line = words.slice(ready + 1, okay);
  const first = line[0];
  const final = line.at(-1);
  if (!first || !final) throw new Error("nothing heard between the brackets");
  const before = words[ready] as Word;
  const after = words[okay];

  const lead = silences.filter(([a, b]) => b <= first.start + SLACK && a >= before.end - SLACK);
  const start = lead.length ? Math.max(...lead.map(([, b]) => b)) : (before.end + first.start) / 2;
  const trail = silences.filter(([a]) => a >= final.end - SLACK && a <= (after?.start ?? duration));
  const end = trail.length ? Math.min(...trail.map(([a]) => a)) : after ? (final.end + after.start) / 2 : duration;
  if (end <= start) throw new Error("the cut is empty");
  // `room`: how far padding may reach — the end of "ready" to the start of "okay".
  return { span: [start, end], room: [before.end, after?.start ?? duration], heard: line.map((x) => x.w).join(" ") };
}

/**
 * Numbers are compared out: the script spells them for the voice ("ten forty-two", "D F two oh four
 * one eight") and Whisper writes them as digits ("1042", "DF20418"). What is left must open and
 * close on the script's own words — the test that the cut kept the whole line — and agree on 80% of
 * the rest, which passes a misheard proper noun ("McLeod" as "a cloud") and fails a dropped clause.
 */
const NUMBERISH = new Set(
  "zero oh one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand".split(" "),
);
const comparable = (text: string) =>
  text
    .replace(/-/g, " ")
    .split(/\s+/)
    .map(norm)
    .filter((t) => t.length > 1 && !/\d/.test(t) && !NUMBERISH.has(t));

export function scriptMismatch(script: string, heard: string): string | null {
  const want = comparable(script);
  const got = comparable(heard);
  if (!want.length) return null;
  if (got[0] !== want[0]) return `opens on "${got[0] ?? ""}", the script on "${want[0]}"`;
  if (got.at(-1) !== want.at(-1)) return `closes on "${got.at(-1) ?? ""}", the script on "${want.at(-1)}"`;
  // Longest common subsequence, as a share of the longer side. Row-major (want+1) × (got+1).
  const w = got.length + 1;
  const lcs = new Array<number>((want.length + 1) * w).fill(0);
  const cell = (i: number, j: number) => lcs[i * w + j] ?? 0;
  for (let i = want.length - 1; i >= 0; i--)
    for (let j = got.length - 1; j >= 0; j--)
      lcs[i * w + j] = want[i] === got[j] ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1));
  const share = cell(0, 0) / Math.max(want.length, got.length);
  return share < 0.8 ? `only ${Math.round(share * 100)}% of the words agree` : null;
}

function silencesOf(file: string): { silences: Span[]; duration: number } {
  // silencedetect reports on stderr, which execFileSync does not return.
  const err = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "silencedetect=noise=-50dB:d=0.10", "-f", "null", "-"], {
    encoding: "utf8",
  }).stderr;
  const duration = Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim(),
  );
  const silences: Span[] = [];
  let open: number | null = null;
  for (const m of err.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === "start") open = Number(m[2]);
    else if (open !== null) {
      silences.push([open, Number(m[2])]);
      open = null;
    }
  }
  if (open !== null) silences.push([open, duration]);
  return { silences, duration };
}

/** The take's words, transcribed once and kept beside it (`<take>.words.json`). */
function wordsOf(raw: string): Word[] {
  const cached = raw.replace(/\.wav$/, ".words.json");
  if (!fs.existsSync(cached)) {
    const json = execFileSync("uv", ["run", "--quiet", path.join(import.meta.dirname, "words.py"), raw], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    fs.writeFileSync(cached, json);
  }
  return JSON.parse(fs.readFileSync(cached, "utf8")) as Word[];
}

/**
 * Writes the trimmed line, or throws when the take is not the script. The films' padding, internal
 * pauses capped at 0.42 s, short fades so the cut never clicks, and loudness normalised so every line
 * sits at the same level (trim-one-line.py). Padding never reaches back into a bracket word.
 */
export function trimBracketedTake(raw: string, out: string, script: string): void {
  const { silences, duration } = silencesOf(raw);
  const { span, room, heard } = lineCut(wordsOf(raw), silences, duration);
  const problem = scriptMismatch(script, heard);
  if (problem) throw new Error(`${problem} (heard "${heard}")`);
  const [start, end] = span;
  execFileSync("ffmpeg", [
    "-y", "-v", "error",
    "-ss", Math.max(room[0], start - PAD_IN).toFixed(3), "-to", Math.min(room[1], end + PAD_OUT).toFixed(3), "-i", raw,
    "-af",
    `silenceremove=start_periods=0:stop_periods=-1:stop_duration=0.45:stop_threshold=-50dB:stop_silence=${PAUSE_CAP}:detection=rms,` +
      "afade=t=in:st=0:d=0.03,areverse,afade=t=in:st=0:d=0.06,areverse,loudnorm=I=-16:TP=-1.5:LRA=9",
    "-ar", "48000", "-ac", "1", out,
  ]);
}
