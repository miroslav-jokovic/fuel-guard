#!/usr/bin/env node
/**
 * The parity baseline: what the metric definition answers for every fixture in the corpus
 * (SCANNER-UPGRADE-PLAN.md Step 2.1, D-SCAN9).
 *
 * ── WHAT THIS FILE IS FOR ─────────────────────────────────────────────────────────────────────
 * `src/metrics.ts` is the implementation of record, and the server calls it directly — so
 * client/server parity is structural. iOS and Android cannot call it; they must reimplement it, and
 * "reimplement it correctly" is not a thing anybody can verify by reading two files side by side.
 * `expected.json` is how they are held to it: the Swift and Kotlin test suites read the same PNGs and
 * must produce these numbers, within the tolerances recorded alongside them.
 *
 * ── HOW TO REGENERATE, AND WHEN NOT TO ────────────────────────────────────────────────────────
 *   node fixtures/expected.mjs
 *
 * It imports the TypeScript reference directly, which needs a Node that strips types (22.18+ or 26;
 * this repo requires >= 22). CI never runs it — `tests/expected.test.ts` recomputes the same values
 * through vitest, which transforms TypeScript itself and therefore needs no flag or version.
 *
 * ⚠ Regenerating is a DEFINITION CHANGE, not a refresh. Every number here is what some native
 * implementation is being held to, and every threshold derived in Phase 5.2 will be expressed in
 * these units. If this file moves, say in the commit which metric changed and why — a diff full of
 * silently shifted numbers is indistinguishable from a bug that happens to be committed.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./png.mjs";
import { BUNDLED_DEFAULT_CONFIG } from "../src/config.ts";
import { computeMetrics } from "../src/metrics.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * How far a native reimplementation may sit from the reference.
 *
 * ⚠ These are a STARTING POINT derived from integer-versus-floating-point rounding across three
 * languages, and they are NOT a measurement — the plan records that as its own open question (§6 Q3).
 * If the first Swift or Kotlin implementation misses them, the correct response is to find out why
 * and record it, never to widen the tolerance until a run goes green. A tolerance loosened to make a
 * test pass is a test that has stopped saying anything.
 */
const TOLERANCE = {
  blurVarianceRelative: 0.02,
  fractionAbsolute: 0.002,
  note: "blur compares relatively (its magnitude spans four orders); the 0..1 metrics compare absolutely.",
};

export function computeExpected() {
  const manifest = JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8"));
  const analysisLongEdgePx = BUNDLED_DEFAULT_CONFIG.analysis.longEdgePx;

  const fixtures = manifest.fixtures.map((record) => {
    const { width, height, rgb } = decodePng(readFileSync(join(HERE, record.file)));
    const m = computeMetrics(rgb, width, height, analysisLongEdgePx);
    return {
      name: record.name,
      // Repeated from the corpus manifest on purpose: a native test reads THIS file, and making it
      // open a second one to find out which pixels it is measuring invites the two drifting apart.
      pixelSha256: record.pixelSha256,
      width,
      height,
      metrics: {
        longEdgePx: m.longEdgePx,
        analysisLongEdgePx: m.analysisLongEdgePx,
        blurVariance: round(m.blurVariance, 4),
        glareFraction: round(m.glareFraction, 6),
        brightnessMean: round(m.brightnessMean, 6),
        contrastRms: round(m.contrastRms, 6),
        shadowRange: round(m.shadowRange, 6),
      },
    };
  });

  return {
    // Bumped whenever the metric DEFINITION changes, so a native suite pinned to an older baseline
    // fails loudly instead of comparing against arithmetic that no longer exists.
    metricsVersion: "scanner-metrics-1",
    analysisLongEdgePx,
    corpusVersion: manifest.corpusVersion,
    tolerance: TOLERANCE,
    fixtures,
  };
}

/** Fixed decimal places, so the committed file is stable rather than carrying float noise. */
function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

if (process.argv[1] && process.argv[1].endsWith("expected.mjs")) {
  const expected = computeExpected();
  const json = JSON.stringify(expected, null, 2) + "\n";
  writeFileSync(join(HERE, "expected.json"), json);
  const digest = createHash("sha256").update(json).digest("hex").slice(0, 12);
  console.log(`✓ wrote expected.json — ${expected.fixtures.length} fixtures, ${expected.metricsVersion}, sha256:${digest}`);
}
