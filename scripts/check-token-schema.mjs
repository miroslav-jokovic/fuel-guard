#!/usr/bin/env node
/**
 * The vocabulary the two surfaces genuinely share (D-DS3b).
 *
 * ── What was promised, and what turned out to be true ───────────────────────────────────────────
 * D-DS3 said the surfaces would "share the semantic layer, specialise the value layer". Measured
 * 2026-08-23, that is about 40% true: of the driver's 33 roles and web's 61, exactly **14 names
 * appear on both**. The rest are not drift — they are the two products being different. The driver
 * has `operation-current`, `operation-blocked`, `sync-pending`: states a truck app has and a
 * dashboard does not. Web has `elevation-*`, `viz-*`, `link`, `action-primary`: a pointer-driven
 * document UI's vocabulary, meaningless on a phone in a cab.
 *
 * So this gate does not demand the two schemas match. It pins the part that IS shared — the neutral
 * ground every surface needs: a canvas, surfaces above it, ink on them, edges between them. If one
 * surface renames or drops one of those, the shared mental model has quietly forked and this fails.
 *
 * ── Why the list is written out rather than computed ────────────────────────────────────────────
 * An intersection computed from the two files can never fail: drop a role from both and the
 * intersection simply shrinks. A declared list is the only shape that catches anything. The price is
 * that adding a fifteenth shared role means editing this file, which is the point — that is a
 * decision about the design system, not a side effect of editing one app.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** The neutral ground. Every surface needs these, whatever else it also needs. */
const SHARED_CORE = [
  "canvas",
  "surface",
  "surface-subtle",
  "surface-muted",
  "surface-inverse",
  "ink",
  "ink-secondary",
  "ink-muted",
  "ink-subtle",
  "ink-disabled",
  "ink-inverse",
  "edge-subtle",
  "edge",
  "edge-strong",
];

const web = new Set(
  Object.keys(JSON.parse(readFileSync(`${root}packages/tokens/src/roles.light.json`, "utf8")).role),
);

/**
 * The driver's own gate (`apps/driver/scripts/check-driver-theme.mjs`) already proves all four of
 * its themes expose the same roles as `light`, so reading `light` covers all four.
 */
const driverThemes = JSON.parse(
  readFileSync(`${root}apps/driver/src/theme/theme.roles.json`, "utf8"),
);
const driver = new Set(Object.keys(driverThemes.light ?? {}));

const failures = [];
for (const role of SHARED_CORE) {
  const missing = [!web.has(role) && "web", !driver.has(role) && "driver"].filter(Boolean);
  if (missing.length) failures.push(`${role} is missing from ${missing.join(" and ")}`);
}

if (failures.length) {
  console.error("✗ shared token vocabulary broken:");
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    "\n  These roles are the neutral ground both surfaces build on. If one has genuinely stopped\n" +
      "  needing a role, remove it from SHARED_CORE in this file deliberately — do not let the two\n" +
      "  vocabularies fork by accident.",
  );
  process.exit(1);
}

const webOnly = [...web].filter((r) => !driver.has(r)).length;
const driverOnly = [...driver].filter((r) => !web.has(r)).length;
console.log(
  `✓ shared token vocabulary ok — ${SHARED_CORE.length} core roles on both surfaces ` +
    `(${webOnly} web-only, ${driverOnly} driver-only, which is by design)`,
);
