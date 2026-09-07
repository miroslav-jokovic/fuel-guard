import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodePng } from "../fixtures/png.mjs";

/**
 * The fixture corpus is intact and still covers what it claims to (SCANNER-UPGRADE-PLAN.md, Step 0.3).
 *
 * ── WHAT THIS PROTECTS ────────────────────────────────────────────────────────────────────────
 * The corpus is about to become the only thing holding three implementations of one metric
 * definition to the same numbers — TypeScript, Swift and Kotlin. Two failure modes would make it
 * quietly useless, and neither is visible in a diff:
 *
 *   1. A fixture's PIXELS change (a regenerate with an edited effect, a truncated file, a
 *      well-meaning image-optimiser pass). Every downstream baseline then moves for a reason nobody
 *      connects to the metric code they are actually debugging.
 *   2. A fixture is DELETED or renamed and takes the last example of some condition with it. The
 *      suite stays green, and the corpus silently stops testing motion blur, or dark backgrounds,
 *      or colour marks.
 *
 * `generate.mjs --check` catches (1) for whoever runs it; this catches both, in CI, without anybody
 * having to remember. It decodes the files ON DISK rather than regenerating in memory, because
 * regenerating would compare the generator against itself and pass no matter what the committed PNGs
 * contain.
 */

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));

interface FixtureRecord {
  name: string;
  file: string;
  width: number;
  height: number;
  axes: Record<string, string | boolean>;
  pixelSha256: string;
}

const manifest = JSON.parse(readFileSync(join(FIXTURES, "manifest.json"), "utf8")) as {
  corpusVersion: string;
  fixtures: FixtureRecord[];
};

/** Every axis value the plan's Step 0.3 names, and which fixture(s) must still carry it. */
const REQUIRED_COVERAGE: Record<string, string[]> = {
  sharpness: ["sharp", "soft", "motion"],
  lighting: ["even", "side", "shadow", "uneven"],
  glare: ["none", "patch", "blown"],
  contrast: ["high", "low"],
  orientation: ["portrait", "landscape"],
  density: ["dense", "sparse"],
};

describe("the fixture corpus on disk", () => {
  it("has a readable file for every fixture the manifest declares", () => {
    expect(manifest.fixtures.length).toBeGreaterThanOrEqual(24);
    for (const record of manifest.fixtures) {
      expect(existsSync(join(FIXTURES, record.file)), record.file).toBe(true);
    }
  });

  it("decodes each fixture to the declared dimensions and pixel digest", () => {
    for (const record of manifest.fixtures) {
      const decoded = decodePng(readFileSync(join(FIXTURES, record.file)));
      expect(decoded.width, `${record.name} width`).toBe(record.width);
      expect(decoded.height, `${record.name} height`).toBe(record.height);
      // The digest is over raw RGB, not file bytes — deflate output may differ across zlib versions
      // while every pixel is unchanged, and a check that cries wolf on a Node upgrade gets ignored.
      const digest = createHash("sha256").update(decoded.rgb).digest("hex");
      expect(digest, `${record.name} pixels`).toBe(record.pixelSha256);
    }
  });

  it("keeps every fixture above the resolution floor and the analysis scale", () => {
    // 1200 px is the resolutionMinLongEdgePx floor these pages must clear to be gated at all; 1024 px
    // is the analysis scale (D-SCAN1). Above both means every fixture exercises the real downscale
    // path rather than the "already small enough" branch that skips it — which is the branch a
    // parity test would otherwise never reach.
    for (const record of manifest.fixtures) {
      const longEdge = Math.max(record.width, record.height);
      expect(longEdge, `${record.name} long edge`).toBeGreaterThanOrEqual(1200);
      expect(longEdge, `${record.name} long edge vs analysis scale`).toBeGreaterThan(1024);
    }
  });
});

describe("the fixture corpus still covers every declared condition", () => {
  it.each(Object.entries(REQUIRED_COVERAGE))("covers every %s value", (axis, values) => {
    const present = new Set(manifest.fixtures.map((f) => f.axes[axis]).filter((v) => v !== undefined));
    for (const value of values) {
      expect(present, `no fixture carries ${axis}=${value}`).toContain(value);
    }
  });

  it("keeps a colour-marked page and a dark-background page", () => {
    // Colour: the RGB-to-luminance step is only exercised by pixels that are not already grey, and
    // Phase 6.1's rule (enhancement must not flatten a stamp or a signature) needs something to
    // measure. Dark background: a white page on a truck seat is the case a coverage or brightness
    // metric is most likely to get wrong.
    expect(manifest.fixtures.some((f) => f.axes.colour === true)).toBe(true);
    expect(manifest.fixtures.some((f) => f.axes.background === "dark")).toBe(true);
  });

  it("gives every fixture a distinct name and file", () => {
    const names = new Set(manifest.fixtures.map((f) => f.name));
    const files = new Set(manifest.fixtures.map((f) => f.file));
    expect(names.size).toBe(manifest.fixtures.length);
    expect(files.size).toBe(manifest.fixtures.length);
  });
});
