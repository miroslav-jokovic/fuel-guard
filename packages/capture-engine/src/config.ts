/**
 * Versioned capture configuration + safe loading (DCE §4 + §8).
 *
 * P1 — measurable, configurable, testable; NO magic numbers. Every gate threshold lives here, is
 * tunable on real truck-cab data without an app release, and is stamped on every capture + run.
 *
 * P-safety — a bad config can never WEAKEN the gate (§8): the app ships a bundled signed default and
 * always has a valid config offline; a remote override is Ed25519 signature-verified and version-
 * monotonic before it is trusted; on any failure we fall to last-known-good, then the bundled default —
 * never to "no gate".
 *
 * Reconciliation note (owner decision — HazmatGuard is the source of truth): the gate thresholds below
 * are aligned to the SERVER usability gate that already ships and is unit-tested
 * (`apps/api/.../hazmatExtraction/image.ts` DEFAULT_USABILITY: long edge ≥ 1200, Laplacian var ≥ 100,
 * glare ≤ 0.06), NOT the DCE §4 draft numbers (1600/120). Client and server must agree, and the server
 * gate is the authoritative backstop, so its numbers win.
 *
 * ── ⚠ WHY THE `web` PLATFORM (A7) ADDS NO NUMBERS OF ITS OWN ───────────────────────────────────
 * APPLICATION-SYSTEM-PLAN's A7 says the web platform gets "its own thresholds ... chosen from measured
 * samples rather than copied from Android, because borrowing would be an assumption". Building it
 * showed the instruction cannot be followed as written, and — more usefully — should not be:
 *
 *   · There are no measured samples, and none can be obtained without shipping the thing first. An
 *     invented number is exactly the assumption the rule exists to forbid, whether it is invented by
 *     copying Android or invented from nothing.
 *   · The web provider measures ONE metric, `longEdgePx`, exactly like the Expo JS fallback. Copying
 *     Android's blur or glare floors would be inert: no blur metric is ever produced, so the check is
 *     `na` and the threshold is never read. A "web-specific blur threshold" would be a number that
 *     does nothing, which is worse than no number at all.
 *   · The one threshold that DOES apply — the resolution floor — must not diverge. It is pinned to the
 *     server's authoritative gate by the paragraph above; a client floor above the server's rejects
 *     photographs the server would have accepted, and one below lets through what the server then
 *     refuses after the driver has paid for the upload.
 *
 * So `web` is a platform token and nothing more, and that is the finding rather than the shortcut. If
 * measured re-shoot rates later justify a web-specific floor, it belongs here as a signed config
 * override — which is what this file is for — and not as a constant somebody guessed today.
 */

/**
 * A threshold that may be in SHADOW MODE (D-SCAN10).
 *
 * `null` means "measure it, record it, gate on nothing". It is not the same as a missing key and it
 * is emphatically not the same as `0`: a `0` floor passes every image ever taken while looking, in a
 * config dump, exactly like a threshold somebody chose. `null` is the only value that says out loud
 * that no number has been derived yet, and the gate renders it as `na` — which §5 already defines as
 * "never a silent pass", the same treatment an unmeasured metric gets.
 *
 * A threshold reaches `null` by being RETIRED rather than replaced: Step 5.2 derives each one from
 * the recorded distribution over the corpus and real captures, and only then does it become a number
 * again, in a signed config version. Until then, nothing in this repository is entitled to invent one
 * — which is the rule this file's own header states and which the shipped 100 and 0.06 broke.
 */
export type ShadowThreshold = number | null;

export interface CaptureConfigGates {
  /**
   * Variance-of-Laplacian focus floor.
   *
   * `null` since 2026-09-07 (plan Step 3.3). The shipped 100 was never calibrated — `image.ts`
   * deferred it to "H11", and H11 never ran — and it is now aimed at a DIFFERENT QUANTITY besides:
   * D-SCAN3's Laplacian is signed and unclamped where sharp's was half-rectified, and D-SCAN1 pins
   * the scale, which alone moved the same image between 4283.7 and 7299.9. Carrying the old number
   * across that change would have been the most expensive kind of mistake — one that looks like
   * continuity. Re-derived in Step 5.2.
   */
  blurLaplacianVarMin: ShadowThreshold;
  /** Fraction of near-white specular (glare) pixels allowed. `null` — shadow mode, see above. */
  glareClippedFractionMax: ShadowThreshold;
  /** Max luminance range attributable to shadow. `null` — shadow mode; never enforced by anything. */
  shadowRangeMax: ShadowThreshold;
  /**
   * Document area / frame area floor (system-scanner crop reports ~1).
   *
   * NOT in shadow mode, and deliberately: it is still enforcing because `coverageFraction` is not yet
   * measured by anybody — `nativeSystemScannerProvider` ASSERTS 1, which Step 5.3 removes. When that
   * assertion goes, this joins the list above until Step 5.2 derives it.
   */
  coverageMinFraction: number;
  /** Acceptable mean brightness band, 0..1. `null` — shadow mode, see `blurLaplacianVarMin`. */
  brightnessMeanRange: [number, number] | null;
  /** RMS contrast floor, 0..1. `null` — shadow mode, see `blurLaplacianVarMin`. */
  contrastRmsMin: ShadowThreshold;
  /**
   * Hard resolution floor (long edge px). Source of truth: 1200 (PLAN M6 DoD / server gate).
   *
   * The one image threshold that is NOT in shadow mode, because it is the one that is scale-free: it
   * asks how many pixels the camera captured, which means the same thing whatever any later stage
   * does. Every other floor above was a number about a pipeline, and the pipeline changed.
   */
  resolutionMinLongEdgePx: number;
  /** Overall accept score floor, 0..1. Computed over APPLICABLE checks only, so `na` never dilutes it. */
  overallAcceptScoreMin: number;
}

export interface OcrLegibilityConfig {
  enabled: boolean;
  ocrMode: "fast" | "accurate";
  minRecognizedChars: number;
  minRecognizedWords: number;
  /**
   * Text-area floor. Typed as a shadow threshold because F7 replaces the quantity underneath it —
   * `textCoverageFraction` SUMS overlapping boxes today and will union them — and a floor calibrated
   * against a sum cannot survive that. It drops to `null` in the step that lands F7 on both
   * platforms, not before: nulling it earlier would relax a live gate for no reason yet.
   */
  textCoverageFractionMin: ShadowThreshold;
  /** Median glyph height floor — the core legibility signal (portable across both platforms). */
  minMedianCharHeightPx: number;
  /**
   * Coverage floor in the smallest-height quartile — does the fine print survive? Same story as
   * `textCoverageFractionMin`: F7 replaces `Σ(line heights)/imageHeight`, which grows with line
   * count and is not a fraction of anything, with a real union-over-area coverage.
   */
  smallTextBandCoverageMin: ShadowThreshold;
  /**
   * Confidence is SECONDARY only (both platforms' word-confidence is unreliable — DCE §12 #3):
   * it can add caution, never rescue. `use: "off"` ignores it entirely.
   */
  confidenceSignal: {
    use: "secondary" | "off";
    meanMin: number;
    platformOverrides: {
      ios?: { meanMin?: number };
      android?: { meanMin?: number };
      /** Present for totality; inert — the web provider runs no OCR, so there is no confidence to tune. */
      web?: { meanMin?: number };
    };
  };
}

export interface EnhanceProfile {
  longEdgePx: number;
  format: "webp" | "jpeg";
  quality: number;
  conservative: boolean;
}

export interface CaptureConfig {
  /** Format: `capture-YYYY.MM.N` (monotonic — see compareConfigVersion). */
  configVersion: string;
  /**
   * The fixed resolution every quality metric is computed at (D-SCAN1).
   *
   * It lives in the signed config rather than as a constant because it is the single number that
   * gives every OTHER number its meaning: the same image scored 4283.7 for blur at 3000 px and
   * 7299.9 at 800 px (measured 2026-09-06), so a threshold quoted without a scale is not a
   * threshold. Versioned and signed alongside the floors, so a recorded measurement can always be
   * interpreted against the scale it was taken at.
   *
   * 1024 is derived, not chosen: it is the largest power of two below `resolutionMinLongEdgePx`
   * (1200), which means anything that clears the resolution floor is always DOWNSCALED here and
   * never upscaled. Upscaling would make the metric a measurement of the interpolator.
   */
  analysis: { longEdgePx: number };
  gates: CaptureConfigGates;
  ocrLegibility: OcrLegibilityConfig;
  enhance: { modelFacing: EnhanceProfile };
  delivery: { minConfigVersionMonotonic: boolean; signatureRequired: boolean };
}

/** The bundled signed default — the app always has a valid gate offline (truck cabs). */
export const BUNDLED_DEFAULT_CONFIG: CaptureConfig = {
  configVersion: "capture-2026.08.0",
  analysis: { longEdgePx: 1024 },
  gates: {
    // ⚠ Five thresholds went `null` on 2026-09-07 (plan Step 3.3, D-SCAN10), and the ORDER matters:
    // they are retired in the merge BEFORE the one that makes the providers produce these metrics.
    // Until Phase 3 nothing set `blurVariance` at all (audit finding F6), so every one of these
    // checks has always been `na` and the numbers below were never once read. The moment a provider
    // starts producing them, an uncalibrated floor becomes a live gate — so the floors go first, and
    // this file's own rule against inventing numbers is kept rather than quietly broken by a
    // producer landing on top of them.
    blurLaplacianVarMin: null,
    glareClippedFractionMax: null,
    shadowRangeMax: null,
    coverageMinFraction: 0.6,
    brightnessMeanRange: null,
    contrastRmsMin: null,
    resolutionMinLongEdgePx: 1200,
    overallAcceptScoreMin: 0.75,
  },
  ocrLegibility: {
    enabled: true,
    ocrMode: "accurate",
    minRecognizedChars: 80,
    minRecognizedWords: 20,
    textCoverageFractionMin: 0.08,
    minMedianCharHeightPx: 16,
    smallTextBandCoverageMin: 0.02,
    confidenceSignal: { use: "secondary", meanMin: 0.5, platformOverrides: { ios: {}, android: {}, web: {} } },
  },
  enhance: {
    // Model-facing derivative: 1568 px long edge, WebP q80, conservative (PLAN §12.3 / server normalizer).
    modelFacing: { longEdgePx: 1568, format: "webp", quality: 80, conservative: true },
  },
  delivery: { minConfigVersionMonotonic: true, signatureRequired: true },
};

/** Parsed `capture-YYYY.MM.N`. */
export interface ConfigVersion {
  year: number;
  month: number;
  seq: number;
}

export function parseConfigVersion(v: string): ConfigVersion | null {
  const m = /^capture-(\d{4})\.(\d{2})\.(\d+)$/.exec(v);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const seq = Number(m[3]);
  if (month < 1 || month > 12) return null;
  return { year, month, seq };
}

/** -1 if a<b, 0 if equal, 1 if a>b; unparseable versions sort as older than any parseable one. */
export function compareConfigVersion(a: string, b: string): number {
  const pa = parseConfigVersion(a);
  const pb = parseConfigVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.year !== pb.year) return pa.year < pb.year ? -1 : 1;
  if (pa.month !== pb.month) return pa.month < pb.month ? -1 : 1;
  if (pa.seq !== pb.seq) return pa.seq < pb.seq ? -1 : 1;
  return 0;
}

/**
 * Verifies a detached signature over the canonical config bytes. Injected by the app (the pure package
 * never imports crypto): the app binds the pinned Ed25519 public key into the verifier instance and
 * does the byte encoding, so this stays lib-clean and portable.
 */
export interface SignatureVerifier {
  verify(message: string, signatureBase64: string): boolean | Promise<boolean>;
}

/** A remote config as fetched (untrusted) — the JSON plus a detached base64 signature over it. */
export interface RemoteConfigEnvelope {
  config: unknown;
  signatureBase64: string;
}

export interface LoadConfigArgs {
  bundled?: CaptureConfig;
  /** Previously-trusted config persisted by the app (fall-to here before the bundled default). */
  lastKnownGood?: CaptureConfig | null;
  /** Fetched at app start (never at capture time). Omit to just use last-known-good/bundled. */
  remote?: RemoteConfigEnvelope | null;
  verifier: SignatureVerifier;
}

export interface LoadConfigResult {
  config: CaptureConfig;
  source: "remote" | "last_known_good" | "bundled";
  /** Populated when a remote override was present but rejected — for telemetry, never fatal. */
  rejectedRemoteReason?: "bad_signature" | "not_monotonic" | "invalid_shape";
}

/**
 * Deterministic stringify with sorted object keys — the canonical byte basis for the signature so the
 * app and the signer agree regardless of key order. Pure; no TextEncoder/Buffer dependency.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map((v) => canonicalStringify(v)).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k])).join(",") + "}";
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * A shadow threshold: a finite number, or an EXPLICIT `null` (D-SCAN10).
 *
 * ⚠ The asymmetry between `null` and a missing key is the whole point and is load-bearing. A remote
 * config that OMITS a threshold is still rejected — `undefined` is not `null` — so a signed override
 * cannot switch a gate off by leaving a key out, which would be a silent weakening and is precisely
 * what §8's "a bad config can never WEAKEN the gate" forbids. Retiring a threshold has to be written
 * down as `null`, deliberately, where a reviewer of the config diff can see it.
 */
function isShadowThreshold(v: unknown): v is number | null {
  return v === null || isNum(v);
}

/**
 * Structural validation of an untrusted remote config (parse-not-trust, D24). Returns the typed config
 * or null; a null NEVER weakens the gate (the caller keeps last-known-good/bundled).
 */
export function validateConfig(u: unknown): CaptureConfig | null {
  if (!u || typeof u !== "object") return null;
  const c = u as Record<string, unknown>;
  if (typeof c.configVersion !== "string" || !parseConfigVersion(c.configVersion)) return null;

  const a = c.analysis as Record<string, unknown> | undefined;
  if (!a || !isNum(a.longEdgePx) || a.longEdgePx <= 0) return null;

  const g = c.gates as Record<string, unknown> | undefined;
  if (!g) return null;
  const range = g.brightnessMeanRange;
  const rangeOk = range === null || (Array.isArray(range) && range.length === 2 && isNum(range[0]) && isNum(range[1]));
  if (
    !isShadowThreshold(g.blurLaplacianVarMin) || !isShadowThreshold(g.glareClippedFractionMax) ||
    !isShadowThreshold(g.shadowRangeMax) || !isShadowThreshold(g.contrastRmsMin) || !rangeOk ||
    // Not shadow thresholds: coverage is still enforcing (its metric is asserted, not measured), and
    // resolution and the score floor are the two that never retire.
    !isNum(g.coverageMinFraction) || !isNum(g.resolutionMinLongEdgePx) || !isNum(g.overallAcceptScoreMin)
  ) {
    return null;
  }

  const o = c.ocrLegibility as Record<string, unknown> | undefined;
  if (!o || typeof o.enabled !== "boolean" || (o.ocrMode !== "fast" && o.ocrMode !== "accurate")) return null;
  if (
    !isNum(o.minRecognizedChars) || !isNum(o.minRecognizedWords) || !isNum(o.minMedianCharHeightPx) ||
    !isShadowThreshold(o.textCoverageFractionMin) || !isShadowThreshold(o.smallTextBandCoverageMin)
  ) {
    return null;
  }
  const cs = o.confidenceSignal as Record<string, unknown> | undefined;
  if (!cs || (cs.use !== "secondary" && cs.use !== "off") || !isNum(cs.meanMin)) return null;

  const e = c.enhance as Record<string, unknown> | undefined;
  const mf = e?.modelFacing as Record<string, unknown> | undefined;
  if (!mf || !isNum(mf.longEdgePx) || (mf.format !== "webp" && mf.format !== "jpeg") || !isNum(mf.quality) || typeof mf.conservative !== "boolean") {
    return null;
  }

  const d = c.delivery as Record<string, unknown> | undefined;
  if (!d || typeof d.minConfigVersionMonotonic !== "boolean" || typeof d.signatureRequired !== "boolean") return null;

  // Shape is valid — safe to trust the structure (values were range-free by design; gates are numbers).
  return u as CaptureConfig;
}

/**
 * Load the active config (DCE §8). Order: verify+accept a monotonic, well-formed, signed remote
 * override → else last-known-good → else bundled default. Never returns "no gate".
 */
export async function loadConfig(args: LoadConfigArgs): Promise<LoadConfigResult> {
  const bundled = args.bundled ?? BUNDLED_DEFAULT_CONFIG;
  const base = args.lastKnownGood ?? bundled;
  const baseSource: LoadConfigResult["source"] = args.lastKnownGood ? "last_known_good" : "bundled";

  if (!args.remote) return { config: base, source: baseSource };

  const shaped = validateConfig(args.remote.config);
  if (!shaped) return { config: base, source: baseSource, rejectedRemoteReason: "invalid_shape" };

  if (base.delivery.signatureRequired) {
    const message = canonicalStringify(args.remote.config);
    const ok = await args.verifier.verify(message, args.remote.signatureBase64);
    if (!ok) return { config: base, source: baseSource, rejectedRemoteReason: "bad_signature" };
  }

  if (base.delivery.minConfigVersionMonotonic && compareConfigVersion(shaped.configVersion, base.configVersion) < 0) {
    return { config: base, source: baseSource, rejectedRemoteReason: "not_monotonic" };
  }

  return { config: shaped, source: "remote" };
}
