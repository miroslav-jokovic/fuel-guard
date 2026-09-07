/**
 * What a capture records about itself, so Step 5.2 can derive a threshold instead of inventing one
 * (SCANNER-UPGRADE-PLAN.md Step 5.1, D-SCAN10). Pure; the app writes it, the server stores it in
 * `hazmat_documents.capture_metrics` (migration 0326).
 *
 * ── THE GAP THIS CLOSES, WHICH WAS NOT THE ONE THE PLAN EXPECTED ──────────────────────────────
 * Phase 3 shipped "every capture measures blur, glare, shadow, brightness and contrast, and rejects
 * on none of them". It measured them. It did not KEEP them. `QualityReport`'s `na` checks carry no
 * `detail` — correctly, since there is nothing to report about a check that did not run — and under
 * D-SCAN10 every one of those floors is `null`, so every one of those checks is `na` and the five
 * measured numbers were discarded one function after they were computed. Step 5.2 was going to
 * derive thresholds from a distribution nobody was writing.
 *
 * The same was true of `analysisLongEdgePx`: the native module has always returned it, and nothing
 * carried it past the provider. M2 measured the same document at 4283.7 blur variance at 3000 px and
 * 7299.9 at 800 px, so a recorded number without its scale is not interpretable.
 *
 * ── WHAT IS DELIBERATELY NOT IN HERE ──────────────────────────────────────────────────────────
 * **The gate verdict and the OCR evidence.** Both are already columns on the same row — `quality`
 * (0092) and `ocr_evidence` (0133) — written from the same request. Repeating them here would be a
 * copy of a fact that already has a home, which root CLAUDE.md's register calls a workaround with a
 * delay fuse, and on an evidence row it would be two answers to "what did the gate decide".
 *
 * **Anything about the person.** Device CLASS and timings only, per the audit's own rule. No name
 * (`Constants.deviceName` is "Miki's iPhone" — the exact thing this must not collect), no location,
 * no identifier, no image content. A model string and an OS version answer "did the scanner get
 * worse on this device?" and nothing else.
 *
 * **Auto-versus-manual capture**, which §4 Step 5.1 asks for. Neither
 * `VNDocumentCameraViewController` nor `GmsDocumentScanner` reports whether the shutter fired
 * automatically or the driver pressed it — the session is the OS's and it tells us only its result.
 * Absent rather than guessed; it becomes available if and only if Phase 7 builds our own viewfinder.
 */

import type { CapturedPage, ImageMetrics } from "./contracts";

/**
 * ⚠ Bump when a FIELD CHANGES MEANING, not when one is added.
 *
 * Step 5.2 reads rows written over months and has to know which ones are comparable. The known
 * discontinuity already in the data is the one this version exists for: `measure()` ran on the
 * 1568 px derivative until Phase 4b and on the untouched original after it, which is a different
 * quantity through a different resampler after a different number of re-encodes. Version 1 is the
 * post-Phase-4b definition; no row of any earlier definition was ever written, because nothing was
 * written at all.
 */
export const CAPTURE_TELEMETRY_VERSION = 1;

export interface CaptureTelemetry {
  version: number;
  provider: { id: string; version: string };
  /** The signed config that produced every number here (D-SCAN1: the analysis scale is one of them). */
  configVersion: string;
  /** Device CLASS and OS only. Absent until a provider can report them. */
  device?: { platform?: string; model?: string; osVersion?: string };
  /** Absent rather than zero: an untimed capture is not a capture that took no time. */
  timings?: { captureMs?: number; processingMs?: number };
  /** The page as the scanner produced it, BEFORE any downscale of ours. */
  source: { widthPx: number; heightPx: number; bytes?: number; mediaType?: string };
  /** Every measured value, including the ones the gate rendered `na`. This is the whole point. */
  metrics: ImageMetrics;
  /** The scale `metrics` were computed at (D-SCAN1). Absent when the measurement failed. */
  analysisLongEdgePx?: number;
  /**
   * Which attempt at this page this is — 1 on the first try, higher when the driver re-shot after a
   * rejection. §4 Step 5.1 asks for "whether the driver re-shot"; a count answers that and also
   * answers how many times, which is trigger (a) of the Phase 7 decision.
   */
  attempt?: number;
}

/**
 * Build the record for one page.
 *
 * Every optional field is OMITTED rather than nulled when it is unknown, and that is the same rule
 * the gate follows for a metric it could not take: absent means "not known", and nothing in this
 * engine spells "not known" as a number. A `captureMs: 0` in this table would be read by Step 5.2 as
 * an instantaneous capture.
 */
export function buildCaptureTelemetry(page: CapturedPage, extra: { attempt?: number } = {}): CaptureTelemetry {
  const meta = page.metadata;
  const timings = defined({ captureMs: meta.captureMs, processingMs: meta.processingMs });
  const device = defined({ platform: meta.device, model: meta.deviceModel, osVersion: meta.osVersion });
  return {
    version: CAPTURE_TELEMETRY_VERSION,
    provider: { id: meta.providerId, version: meta.providerVersion },
    configVersion: meta.configVersion,
    ...(device ? { device } : {}),
    ...(timings ? { timings } : {}),
    source: {
      widthPx: page.originalOfRecord.width,
      heightPx: page.originalOfRecord.height,
      ...(page.originalOfRecord.bytes === undefined ? {} : { bytes: page.originalOfRecord.bytes }),
      ...(page.originalOfRecord.mediaType === undefined ? {} : { mediaType: page.originalOfRecord.mediaType }),
    },
    metrics: page.metrics,
    ...(meta.analysisLongEdgePx === undefined ? {} : { analysisLongEdgePx: meta.analysisLongEdgePx }),
    ...(extra.attempt === undefined ? {} : { attempt: extra.attempt }),
  };
}

/** The object with its `undefined` entries dropped, or `undefined` if nothing was known at all. */
function defined<T extends Record<string, unknown>>(o: T): Partial<T> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length > 0 ? (out as Partial<T>) : undefined;
}
