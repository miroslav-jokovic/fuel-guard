/**
 * Weak-signal rules for the driver's training page (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS §8.2, D-TR4).
 * Pure, so each is tested without a browser.
 */

/** What the browser says about the connection (`navigator.connection`, where it exists — Chrome, Android). */
export interface ConnectionHint {
  effectiveType?: string;
  /** Megabits per second, the browser's estimate. */
  downlink?: number;
  saveData?: boolean;
}

export type DataMode = "low" | "normal";

/**
 * Which rendition to play. Measured on film 01 (2026-11-24): 360p is 84 kbps and still readable, 540p
 * 115 kbps, 720p 170 kbps. So:
 *   · "Low data" picked by the driver, Data Saver on, or 2G/3G → the smallest.
 *   · A fast 4G (≥ 5 Mbps) → the sharpest.
 *   · Otherwise, including a browser that says nothing (Safari) → the middle one: 115 kbps plays on
 *     anything better than an edge of coverage.
 */
export function pickHeight(available: readonly number[], mode: DataMode, hint: ConnectionHint | null): number | null {
  const hs = [...available].sort((a, b) => a - b);
  if (hs.length === 0) return null;
  const smallest = hs[0]!;
  const largest = hs[hs.length - 1]!;
  if (mode === "low" || hint?.saveData) return smallest;
  const t = hint?.effectiveType;
  if (t === "slow-2g" || t === "2g" || t === "3g") return smallest;
  if (t === "4g" && (hint?.downlink ?? 0) >= 5) return largest;
  return hs.find((h) => h >= 540) ?? largest;
}

/** One played span waiting to be sent. */
export interface QueuedSpan {
  versionId: string;
  fromMs: number;
  toMs: number;
  positionMs: number;
}

/**
 * Join spans of one film that follow on from each other (a gap under 2 s) into one, so a stretch played
 * with no signal goes up as ONE report when signal returns. The server accepts a span no longer than the
 * time since its previous report; one long span after a long silence passes, ten short ones a millisecond
 * apart would not.
 */
export function mergeQueued(spans: readonly QueuedSpan[]): QueuedSpan[] {
  const out: QueuedSpan[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && last.versionId === s.versionId && s.fromMs >= last.fromMs && s.fromMs <= last.toMs + 2000) {
      last.toMs = Math.max(last.toMs, s.toMs);
      last.positionMs = s.positionMs;
    } else out.push({ ...s });
  }
  return out;
}

/**
 * Where a first watch may seek to: back anywhere, forward only into what was already watched (plus a
 * 2 s slack for a tap that lands a little ahead). A rewatch after a failed quiz may also jump straight
 * to the start of a chapter it must watch again.
 */
export function allowedSeek(target: number, watched: ReadonlyArray<[number, number]>, playedTo: number, rewatchStarts: readonly number[]): boolean {
  if (target <= playedTo + 2000) return true;
  if (rewatchStarts.some((s) => Math.abs(s - target) < 1000)) return true;
  return watched.some(([a, b]) => target >= a && target <= b + 2000);
}

/** "3:24" from milliseconds. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "2.1 MB" from bytes. */
export const megabytes = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`;
